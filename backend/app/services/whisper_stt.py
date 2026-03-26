# -*- coding: utf-8 -*-
"""
Whisper STT service — Speech-to-Text using faster-whisper.

Model priority  : small → base → tiny  (best Arabic accuracy first)
Audio input     : raw 16-bit mono PCM  *or*  WAV container (auto-detected)
Language        : Arabic (ar) — forced; beam_size=5 for best accuracy
Hallucinations  : A hard deny-list removes common Whisper phantom outputs
                  that appear on silence / noise-only segments.
Async-safe      : transcription runs in a thread-pool executor so it never
                  blocks the FastAPI event loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
import struct
import sys
import tempfile
from typing import Optional

# Force UTF-8 on stdout/stderr at import time (Windows cp1252 fallback guard).
# logger.debug() with Arabic text raises UnicodeEncodeError when the logging
# StreamHandler writes to a cp1252 console, which then gets caught by the generic
# except-block and returned to the browser as a confusing charmap error message.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def _patch_logging_handlers() -> None:
    """Reconfigure ALL StreamHandlers on ALL loggers to UTF-8.

    Called once at import and again from the FastAPI lifespan after uvicorn
    completes its own logging setup.

    WHY iterating root is NOT enough:
      uvicorn does NOT add its handlers to logging.root — it adds them to the
      named loggers 'uvicorn', 'uvicorn.access', and 'uvicorn.error'.
      Those handlers run with the Windows cp1252 default and raise
      UnicodeEncodeError when any log message contains Arabic text.
    """
    # Walk root + every named logger registered in the manager dict.
    _loggers_to_patch: list[logging.Logger] = [logging.root]
    for _lg in logging.root.manager.loggerDict.values():
        if isinstance(_lg, logging.Logger):
            _loggers_to_patch.append(_lg)

    for _log in _loggers_to_patch:
        for _lh in _log.handlers:
            if hasattr(_lh, 'stream') and hasattr(_lh.stream, 'reconfigure'):
                try:
                    _lh.stream.reconfigure(encoding='utf-8', errors='replace')
                except Exception:
                    pass

_patch_logging_handlers()  # patch whatever exists now

try:
    from app.services.settings import STT_MIN_MS, STT_MAX_MB, STT_MIME_OK
except Exception:
    STT_MIN_MS  = 400
    STT_MAX_MB  = 8
    STT_MIME_OK = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]

logger = logging.getLogger(__name__)

# When local Whisper is unavailable or all STT paths fail, this user message is
# sent through the same LLM pipeline as typed text so the client can verify E2E.
STT_PIPELINE_FALLBACK_USER_AR = (
    "أنا أسمعك ولكن الترجمة الصوتية غير مفعلة حالياً."
)


def _safe_log(text: object, maxlen: int = 80) -> str:
    """Return an ASCII-safe representation of text for logging.

    Prevents 'charmap' UnicodeEncodeError when a logging StreamHandler
    writes to a cp1252 / latin-1 Windows console.  Uses Python's built-in
    ``ascii()`` which escapes every non-ASCII character as \\uXXXX.
    """
    return ascii(str(text)[:maxlen])


class STTError(Exception):
    """Raised by validate_audio() or transcribe_audio() on recoverable STT failures."""
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code   = code
        self.detail = detail


def _is_allowed_mime(mime: str | None) -> bool:
    """Return True if the MIME type is in the configured allow-list."""
    if not mime:
        return True  # no MIME provided — allow (legacy path)
    return mime.strip().lower().split(";")[0].strip() in STT_MIME_OK


def validate_audio(audio_bytes: bytes, mime_type: str | None = None) -> None:
    """Raise STTError if the audio payload fails sanity checks."""
    if not audio_bytes:
        raise STTError("empty_payload", "الملف الصوتي فارغ")

    size_mb = len(audio_bytes) / (1024 * 1024)
    if size_mb > STT_MAX_MB:
        raise STTError(
            "payload_too_large",
            f"حجم التسجيل {size_mb:.1f} MB يتجاوز الحد المسموح {STT_MAX_MB} MB",
        )

    if not _is_allowed_mime(mime_type):
        raise STTError(
            "invalid_mime",
            f"نوع الملف {mime_type!r} غير مدعوم. الأنواع المسموحة: {', '.join(STT_MIME_OK)}",
        )

# ── Singleton model ───────────────────────────────────────────────────────────
_whisper_available: bool = False
_processor = None
_loaded_model_size: str = ""

# Arabic Whisper hallucinations on silence / noise — deny-list
_HALLUCINATION_DENY: frozenset[str] = frozenset({
    "", ".", "..", "...", "…",
    "thank you", "thanks for watching", "you",
    "شكراً", "شكرا", "شكراً لك", "شكراً لكم",
    "سبحان الله", "الله أكبر",
    # Common English phantom outputs on Arabic noise
    "music", "silence", "[music]", "[noise]", "(music)",
})


def _is_hallucination(text: str) -> bool:
    """Return True if the text looks like a Whisper hallucination."""
    t = text.strip().lower()
    if not t or len(t) < 2:
        return True
    if t in _HALLUCINATION_DENY:
        return True
    # Repeated character / symbol artifacts
    if len(set(t.replace(" ", ""))) <= 2 and len(t) < 6:
        return True
    return False


def _init_whisper() -> bool:
    """
    Lazy-initialize the faster-whisper model.
    Tries 'small' first (best Arabic quality), falls back to 'base' then 'tiny'.
    Returns True once a model is loaded.
    """
    global _whisper_available, _processor, _loaded_model_size
    if _whisper_available:
        return True

    for model_size in ("small", "base", "tiny"):
        try:
            from faster_whisper import WhisperModel
            _processor = WhisperModel(model_size, device="cpu", compute_type="int8")
            _whisper_available = True
            _loaded_model_size = model_size
            logger.info(
                "faster-whisper loaded: model=%s device=cpu compute_type=int8",
                model_size,
            )
            return True
        except ImportError:
            logger.error(
                "faster-whisper is not installed. "
                "Run: pip install faster-whisper"
            )
            return False
        except Exception as exc:
            logger.warning("faster-whisper '%s' failed: %s — trying next", model_size, exc)

    logger.critical(
        "Could not load any Whisper model. "
        "STT will be unavailable until faster-whisper is correctly installed."
    )
    return False


def is_available() -> bool:
    """Check if Whisper STT is operational (triggers lazy init)."""
    return _init_whisper()


# ── WAV / compressed-audio decoder ──────────────────────────────────────────

def _extract_pcm_via_av(audio_bytes: bytes) -> tuple[bytes, int]:
    """Decode any compressed container (webm, ogg, opus, mp4 …) to s16 PCM.

    Uses PyAV (libavcodec) which ships with the ``av`` package.
    Returns (pcm_bytes_s16_mono, sample_rate).
    """
    import av  # type: ignore  # noqa: PLC0415  (local import — fast-whisper users may not have av)
    import io

    buf = io.BytesIO(audio_bytes)
    chunks: list[bytes] = []
    detected_sr = 16000

    with av.open(buf, mode="r") as container:
        audio_streams = [s for s in container.streams if s.type == "audio"]
        if not audio_streams:
            raise ValueError("av: no audio stream found in container")
        detected_sr = audio_streams[0].codec_context.sample_rate or 16000
        for frame in container.decode(audio=0):
            reframed = frame.reformat(format="s16", layout="mono", rate=16000)
            chunks.append(bytes(reframed.planes[0]))

    if not chunks:
        raise ValueError("av: no audio frames decoded")

    return b"".join(chunks), 16000


def _extract_pcm(audio_bytes: bytes) -> tuple[bytes, int]:
    """
    Extract raw 16-bit signed PCM from input bytes.
    Accepts:
      • RIFF/WAV container   → strips header, reads sample rate from fmt chunk
      • WebM/Opus/Ogg/MP4    → decoded via PyAV (libavcodec)
      • Raw PCM bytes        → returned as-is with assumed 16000 Hz
    Returns (pcm_bytes, sample_rate).
    """
    if len(audio_bytes) >= 12 and audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        offset = 12
        sr = 16000
        pcm_start = 44  # safe default

        while offset + 8 <= len(audio_bytes):
            chunk_id = audio_bytes[offset:offset + 4]
            chunk_sz = struct.unpack_from("<I", audio_bytes, offset + 4)[0]

            if chunk_id == b"fmt ":
                try:
                    sr = struct.unpack_from("<I", audio_bytes, offset + 12)[0]
                except struct.error:
                    pass

            elif chunk_id == b"data":
                data_end = min(offset + 8 + chunk_sz, len(audio_bytes))
                return audio_bytes[offset + 8: data_end], sr

            offset += 8 + chunk_sz
            if chunk_sz == 0:
                break  # malformed — stop

        # Fallback: skip standard 44-byte header
        return audio_bytes[44:], sr

    # Try PyAV for compressed containers (webm / opus / ogg / mp4 …)
    try:
        return _extract_pcm_via_av(audio_bytes)
    except Exception as _av_err:
        logger.debug("[STT] PyAV decode failed (%s) — treating as raw PCM", _av_err)

    # Raw PCM (no container — last resort)
    return audio_bytes, 16000


# ── Transcription ─────────────────────────────────────────────────────────────

async def transcribe_audio(
    audio_bytes: bytes,
    sample_rate: int = 16000,
    mime_type: str | None = None,
    req_id: str = "",
) -> str:
    """
    Async entry-point: transcribe audio bytes to Arabic text.

    Raises STTError on validation failure or when no speech is detected.
    Returns the transcribed text string on success.
    """
    label = f"[STT req={req_id}]" if req_id else "[STT]"
    logger.info("%s [STT_START] size=%d mime=%s", label, len(audio_bytes), mime_type)

    # Validate before touching the model
    validate_audio(audio_bytes, mime_type)

    if not _init_whisper():
        raise STTError("model_unavailable", "Whisper نموذج STT غير متاح — ثبت faster-whisper")

    # Ignore empty or very short audio (must raise — bare return broke the WS pipeline)
    if not audio_bytes or len(audio_bytes) < 1000:
        raise STTError("audio_too_short", "لم أسمع شيئاً — حاول مرة أخرى")

    try:
        import numpy as np

        pcm_bytes, detected_sr = _extract_pcm(audio_bytes)
        if len(pcm_bytes) < 3200:  # < 100 ms of audio at 16 kHz → skip (avoids noise/click false positives)
            logger.info("%s [STT_ERROR] audio_too_short bytes=%d", label, len(pcm_bytes))
            raise STTError("audio_too_short", "لم أسمع شيئاً — حاول مرة أخرى")

        # int16 requires an even-length buffer (2 bytes per sample).
        # Truncate any trailing odd byte to avoid "buffer size must be a
        # multiple of element size" from np.frombuffer.
        if len(pcm_bytes) % 2 != 0:
            pcm_bytes = pcm_bytes[:-1]

        audio_array: np.ndarray = (
            np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        )

        # Duration sanity check — Whisper needs at least 0.4 s (STT_MIN_MS)
        duration_ms = int(len(audio_array) / max(detected_sr, 1) * 1000)
        if duration_ms < STT_MIN_MS:
            logger.info("%s [STT_ERROR] duration_too_short ms=%d", label, duration_ms)
            raise STTError("audio_too_short", f"مدة الصوت {duration_ms} ms أقل من الحد الأدنى ({STT_MIN_MS} ms)")

        def _run_transcription() -> str:
            """Blocking transcription — runs in executor."""
            global _processor
            # faster-whisper API
            try:
                segments, info = _processor.transcribe(
                    audio_array,
                    language="ar",
                    beam_size=5,
                    best_of=5,
                    # Suppress hallucinations on noise/silence:
                    no_speech_threshold=0.6,
                    condition_on_previous_text=False,
                    # VAD filter removes non-speech frames before Whisper processing
                    # — dramatically reduces hallucinations on silence/background noise.
                    vad_filter=True,
                    # Greedy decoding: faster + more deterministic for academic Arabic.
                    temperature=0.0,
                    # Academic Arabic BTEC context: improves vocabulary accuracy
                    # and prevents confusion between similar-sounding terms.
                    initial_prompt="هذا حوار أكاديمي باللغة العربية الفصحى حول BTEC ومعايير Pass وMerit وDistinction وتحليل PESTLE وSWOT واستراتيجية الأعمال.",
                )
                result = " ".join(s.text.strip() for s in segments if s.text.strip())
                # Use ascii=True-style repr to avoid UnicodeEncodeError when logging
                # Arabic text through a cp1252 Windows console handler.
                logger.debug(
                    "[STT] faster-whisper: lang=%s prob=%.2f text=%s",
                    info.language, info.language_probability, _safe_log(result),
                )
                return result

            except (TypeError, AttributeError):
                # openai-whisper fallback (different API)
                r = _processor.transcribe(audio_array, fp16=False, language="ar")
                if isinstance(r, dict):
                    return r.get("text") or ""
                return str(r or "")

        loop = asyncio.get_event_loop()
        raw_text: str = await loop.run_in_executor(None, _run_transcription)
        text = (raw_text or "").strip()

        if _is_hallucination(text):
            logger.info("%s [STT_ERROR] hallucination_filtered text=%s", label, _safe_log(text))
            raise STTError("no_speech_detected", "لم أسمع شيئاً — حاول مرة أخرى")

        duration_s = duration_ms / 1000.0
        logger.info(
            "%s [STT_SUCCESS] model=%s duration=%.1fs text=%s",
            label, _loaded_model_size, duration_s, _safe_log(text),
        )
        return text

    except STTError:
        raise  # re-raise without wrapping
    except Exception as exc:
        # Use _safe_log so a UnicodeEncodeError in the logger itself never
        # obscures the real exception message (the charmap bug we fixed).
        try:
            logger.exception("%s [STT_ERROR] unexpected: %s", label, _safe_log(exc))
        except Exception:
            pass  # logging must never kill the pipeline
        _exc_safe = str(exc).encode('utf-8', errors='replace').decode('utf-8')
        raise STTError("transcription_error", f"STT خطأ غير متوقع: {_exc_safe}")


async def transcribe_openai_whisper_api(
    audio_bytes: bytes,
    req_id: str = "",
) -> str | None:
    """
    Optional cloud STT when local faster-whisper is missing or fails.
    Set OPENAI_API_KEY in the environment. Returns None if unavailable or on error.
    """
    label = f"[STT-OpenAI req={req_id}]" if req_id else "[STT-OpenAI]"
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.debug("%s skipped — OPENAI_API_KEY not set", label)
        return None
    suffix = ".webm"
    if len(audio_bytes) >= 12 and audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        suffix = ".wav"
    path: str | None = None
    try:
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(audio_bytes)
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
        with open(path, "rb") as audio_file:
            resp = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="ar",
            )
        text = (getattr(resp, "text", None) or "").strip()
        if text:
            logger.info("%s OK text=%s", label, _safe_log(text))
        return text or None
    except Exception as exc:
        logger.warning("%s failed: %s", label, _safe_log(exc))
        return None
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
