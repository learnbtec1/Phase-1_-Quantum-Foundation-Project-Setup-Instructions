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
import struct
from typing import Optional

try:
    from app.services.settings import STT_MIN_MS, STT_MAX_MB, STT_MIME_OK
except Exception:
    STT_MIN_MS  = 400
    STT_MAX_MB  = 8
    STT_MIME_OK = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]

logger = logging.getLogger(__name__)


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
    print(f"{label} [STT_START] size={len(audio_bytes)} bytes mime={mime_type!r}", flush=True)

    # Validate before touching the model
    validate_audio(audio_bytes, mime_type)

    if not _init_whisper():
        raise STTError("model_unavailable", "Whisper نموذج STT غير متاح — ثبت faster-whisper")

    try:
        import numpy as np

        pcm_bytes, detected_sr = _extract_pcm(audio_bytes)
        if len(pcm_bytes) < 640:  # < 20 ms of audio at 16 kHz → skip
            logger.info("%s [STT_ERROR] audio_too_short bytes=%d", label, len(pcm_bytes))
            print(f"{label} [STT_ERROR] audio_too_short pcm={len(pcm_bytes)} bytes", flush=True)
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
            print(f"{label} [STT_ERROR] duration_too_short {duration_ms}ms < min {STT_MIN_MS}ms", flush=True)
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
                    # Arabic-tuned initial prompt:
                    initial_prompt="هذا حديث عربي يتعلق بـ BTEC.",
                )
                result = " ".join(s.text.strip() for s in segments if s.text.strip())
                logger.debug(
                    "[STT] faster-whisper: lang=%s prob=%.2f text=%r",
                    info.language, info.language_probability, result[:80],
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
            logger.info("%s [STT_ERROR] hallucination_filtered text=%r", label, text)
            print(f"{label} [STT_ERROR] hallucination_filtered text={text!r}", flush=True)
            raise STTError("no_speech_detected", "لم أسمع شيئاً — حاول مرة أخرى")

        duration_s = duration_ms / 1000.0
        logger.info(
            "%s [STT_SUCCESS] model=%s duration=%.1fs text=%r",
            label, _loaded_model_size, duration_s, text[:80],
        )
        print(f"{label} [STT_SUCCESS] model={_loaded_model_size} duration={duration_s:.1f}s text={text[:120]!r}", flush=True)
        return text

    except STTError:
        raise  # re-raise without wrapping
    except Exception as exc:
        logger.exception("%s [STT_ERROR] unexpected: %s", label, exc)
        print(f"{label} [STT_ERROR] unexpected: {exc}", flush=True)
        raise STTError("transcription_error", f"STT خطأ غير متوقع: {exc}")
