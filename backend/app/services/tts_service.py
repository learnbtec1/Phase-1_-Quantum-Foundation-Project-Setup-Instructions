# -*- coding: utf-8 -*-
"""
Microsoft Edge TTS (edge-tts) — Arabic neural synthesis, no API key.

Voice is locked to ``EDGE_TTS_VOICE_LOCKED_GLOBAL`` for all callers.

Install:
    pip install edge-tts
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re as _re
import tempfile
import uuid
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape as _xml_sax_escape

# Import once at load: drives Edge fallback in tts_timing / agent_ws when EL fails or TTS_PROVIDER=edge.
try:
    import edge_tts  # noqa: F401

    _EDGE_TTS_AVAILABLE = True
except ImportError:
    edge_tts = None  # type: ignore[assignment]
    _EDGE_TTS_AVAILABLE = False
    logging.warning(
        "[EdgeTTS] edge-tts not installed. Run: pip install edge-tts"
    )
    print("[EDGE ERROR] edge_tts not installed (import failed)", flush=True)
logger = logging.getLogger(__name__)


# Single Edge neural voice for all HTTP/WS TTS — env and request bodies must not switch it at runtime.


EDGE_TTS_VOICE_LOCKED_GLOBAL = "ar-SA-ZariyahNeural"


def _elevenlabs_error_message_from_body(status: int, raw: str) -> str:
    """Parse ElevenLabs JSON error body into a single line for logs (detail.message, detail, or raw)."""
    if not (raw or "").strip():
        return f"HTTP {status} (empty body)"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return (raw or "")[:1200]
    detail = data.get("detail")
    if isinstance(detail, dict):
        msg = detail.get("message") or detail.get("error") or detail.get("status")
        if msg:
            return str(msg)
        return json.dumps(detail, ensure_ascii=False)[:1200]
    if isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, dict) and first.get("msg"):
            return str(first.get("msg"))
        return str(detail)[:1200]
    if detail is not None:
        return str(detail)[:1200]
    for key in ("message", "error", "error_message"):
        if data.get(key):
            return str(data[key])[:1200]
    return (raw or "")[:1200]


def log_critical_if_elevenlabs_misconfigured() -> None:
    """
    Phase 23 — one-shot startup check: when ElevenLabs is the configured provider,
    missing key/voice must surface as CRITICAL in logs (Docker-friendly).
    """
    try:
        from app.core.config import settings as _s

        prov = (os.getenv("TTS_PROVIDER") or getattr(_s, "TTS_PROVIDER", "") or "").strip().lower()
    except Exception:
        prov = (os.getenv("TTS_PROVIDER") or "").strip().lower()
    if prov != "elevenlabs":
        return
    if not _elevenlabs_api_key():
        logger.critical(
            "[ELEVENLABS] TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is empty at runtime — "
            "TTS will fail. Set ELEVENLABS_API_KEY in the environment (e.g. docker-compose `.env`).",
        )
    if not _elevenlabs_voice_id():
        logger.critical(
            "[ELEVENLABS] TTS_PROVIDER=elevenlabs but ELEVENLABS_VOICE_ID is empty at runtime — "
            "TTS will fail. Set ELEVENLABS_VOICE_ID (ElevenLabs voice id).",
        )


def _elevenlabs_api_key() -> str:
    """Prefer process env (Docker / shell); fall back to pydantic Settings (.env via load_dotenv)."""
    v = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    if v:
        return v
    try:
        from app.core.config import settings

        return (settings.ELEVENLABS_API_KEY or "").strip()
    except Exception:
        return ""


def _elevenlabs_voice_id() -> str:
    """Same resolution order as API key."""
    v = (os.getenv("ELEVENLABS_VOICE_ID") or "").strip()
    if v:
        return v
    try:
        from app.core.config import settings

        return (settings.ELEVENLABS_VOICE_ID or "").strip()
    except Exception:
        return ""


def _elevenlabs_stdout_error_body(status: int, raw: str) -> None:
    """Emit full ElevenLabs error JSON to STDOUT for docker logs / operators."""
    text = (raw or "").strip()
    out = text
    if text:
        try:
            out = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass
    print(f"[ElevenLabs ERROR] HTTP {status}\n{out}", flush=True)


async def synthesize_elevenlabs_async(text: str) -> bytes:
    """
    ElevenLabs Multilingual v2, MP3 44.1kHz @ 128kbps (mp3_44100_128).
    Requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID when TTS_PROVIDER=elevenlabs.
    """
    import httpx

    if not (os.getenv("ELEVENLABS_API_KEY") or "").strip():
        print("ELEVENLABS_API_KEY=MISSING_KEY", flush=True)
    api_key = _elevenlabs_api_key()
    voice_id = _elevenlabs_voice_id()
    if not api_key or not voice_id:
        missing: List[str] = []
        if not api_key:
            missing.append("ELEVENLABS_API_KEY")
        if not voice_id:
            missing.append("ELEVENLABS_VOICE_ID")
        raise RuntimeError(
            "ElevenLabs env not set — missing: "
            + ", ".join(missing)
            + " (required when TTS_PROVIDER=elevenlabs)",
        )
    # Phase 22 — `/stream` + minimal headers (avoid conflicting UA / extra headers vs binary MP3 response).
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    params = {"output_format": "mp3_44100_128"}
    body: Dict[str, Any] = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    timeout = float(os.getenv("ELEVENLABS_TTS_TIMEOUT_SEC", "120"))
    el_headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }
    log_payload = {
        "model_id": body["model_id"],
        "voice_settings": body["voice_settings"],
        "text_preview": ((text or "")[:200] + "…") if len(text or "") > 200 else (text or ""),
        "text_len": len(text or ""),
    }
    logger.info("ElevenLabs TTS JSON payload (pre-request): %s", json.dumps(log_payload, ensure_ascii=False))
    logger.info(
        "ElevenLabs TTS request | stream | voice_id_prefix=%s | text_len=%d",
        voice_id[:12] + ("…" if len(voice_id) > 12 else ""),
        len(text or ""),
    )
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                url,
                params=params,
                json=body,
                headers=el_headers,
            )
    except httpx.RequestError as exc:
        logger.critical("ElevenLabs TTS transport failure | err=%s", exc, exc_info=True)
        print(f"[ElevenLabs ERROR] transport {type(exc).__name__}: {exc}", flush=True)
        raise RuntimeError(f"ElevenLabs request failed: {exc}") from exc

    if r.status_code != 200:
        raw = r.text or ""
        print(f"DEBUG_ELEVENLABS: {raw}", flush=True)
        _elevenlabs_stdout_error_body(r.status_code, raw)
        extracted = _elevenlabs_error_message_from_body(r.status_code, raw)
        logger.critical(
            "ElevenLabs TTS rejected | status=%s | voice_id=%s | api_message=%s | raw_body=%s",
            r.status_code,
            voice_id,
            extracted,
            (raw[:2000] if raw else ""),
        )
        raise RuntimeError(
            f"ElevenLabs HTTP {r.status_code}: {extracted}",
        )
    data = r.content
    if not data or len(data) < 32:
        raise RuntimeError("ElevenLabs returned empty or invalid audio")
    return data


def is_edge_tts_failure(exc: BaseException) -> bool:
    """True for likely rate-limit / auth / network issues from Edge online service."""
    s = str(exc).lower()
    if "401" in s or "403" in s or "429" in s:
        return True
    if any(
        x in s
        for x in (
            "unauthorized",
            "forbidden",
            "too many",
            "rate",
            "timeout",
            "connection",
            "no audio",
            "invalid",
        )
    ):
        return True
    return False


# Backward-compatible names for diagnostics / legacy imports
is_google_tts_auth_failure = is_edge_tts_failure
is_azure_tts_auth_failure = is_edge_tts_failure


def edge_tts_voice_name() -> str:
    """Locked female Gulf neural voice (see ``EDGE_TTS_VOICE_LOCKED_GLOBAL``)."""
    return EDGE_TTS_VOICE_LOCKED_GLOBAL


def _locked_edge_voice_for_sdk(_requested: Optional[str]) -> str:
    """SDK path ignores ``voice_name`` / defaults — keeps one global Edge identity."""
    return EDGE_TTS_VOICE_LOCKED_GLOBAL


_SENT_BOUNDARY = _re.compile(r'([.،؟!؟\n]+)\s*')
_EN_TOKEN = _re.compile(r'([A-Za-z][A-Za-z0-9]*(?:[/-][A-Za-z0-9]+)*)')


def _is_all_ascii(s: str) -> bool:
    return bool(s) and all(ord(c) < 128 for c in s)


_ACRONYM_RE = _re.compile(r'^[A-Z][A-Z0-9]{1,}$')
_INVALID_XML_CHAR_RE = _re.compile("[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]")


def _xml_escape(s: str) -> str:
    if not s:
        return ""
    return _xml_sax_escape(s, {'"': '&quot;', "'": '&apos;'})


def _strip_invalid_xml_chars(s: str) -> str:
    if not s:
        return ""
    return _INVALID_XML_CHAR_RE.sub("", s)


def _split_segments(text: str) -> list[tuple[str, str]]:
    segments: list[tuple[str, str]] = []
    last = 0
    for m in _EN_TOKEN.finditer(text):
        if m.start() > last:
            segments.append(('ar', text[last:m.start()]))
        en_run = m.group()
        if len(en_run.strip()) > 3 and _is_all_ascii(en_run):
            segments.append(('en', en_run))
        else:
            if segments and segments[-1][0] == 'ar':
                segments[-1] = ('ar', segments[-1][1] + en_run)
            else:
                segments.append(('ar', en_run))
        last = m.end()
    if last < len(text):
        tail = text[last:]
        if segments and segments[-1][0] == 'ar':
            segments[-1] = ('ar', segments[-1][1] + tail)
        else:
            segments.append(('ar', tail))
    return segments


def _render_segment(kind: str, content: str) -> str:
    safe = _xml_escape(content)
    if kind == 'ar':
        return safe
    if _ACRONYM_RE.match(content):
        return (
            f'<lang xml:lang="en-GB">'
            f'<say-as interpret-as="spell-out">{safe}</say-as>'
            f'</lang>'
        )
    return f'<lang xml:lang="en-GB">{safe}</lang>'


def _plain_chunk_to_ssml(chunk: str) -> str:
    return ''.join(_render_segment(k, v) for k, v in _split_segments(chunk))


_SLOT_MARK = "\uffffSLOT{}\uffff"


def _extract_ssml_placeholders(text: str) -> tuple[str, list[str]]:
    slots: list[str] = []
    t = text

    def _grab(pat: _re.Pattern[str]) -> None:
        nonlocal t

        def _sub(m: _re.Match[str]) -> str:
            slots.append(m.group(0))
            return _SLOT_MARK.format(len(slots) - 1)

        t = pat.sub(_sub, t)

    for pat in (
        _re.compile(r"<break\b[^>]*/\s*>", _re.I),
        _re.compile(r"<prosody\b[^>]*>.*?</prosody>", _re.I | _re.S),
        _re.compile(r"<say-as\b[^>]*>.*?</say-as>", _re.I | _re.S),
        _re.compile(r"<lang\b[^>]*>.*?</lang>", _re.I | _re.S),
        _re.compile(r"<phoneme\b[^>]*>.*?</phoneme>", _re.I | _re.S),
        _re.compile(r"<emphasis\b[^>]*>.*?</emphasis>", _re.I | _re.S),
    ):
        _grab(pat)
    return t, slots


_SLOT_REF = _re.compile(r"\uffffSLOT(\d+)\uffff")


def _chunk_to_ssml_with_slots(chunk: str, slots: list[str]) -> str:
    if not slots:
        return _plain_chunk_to_ssml(chunk)
    out: list[str] = []
    pos = 0
    for m in _SLOT_REF.finditer(chunk):
        head = chunk[pos:m.start()]
        if head.strip():
            out.append(_plain_chunk_to_ssml(head))
        idx = int(m.group(1))
        if 0 <= idx < len(slots):
            out.append(slots[idx])
        pos = m.end()
    tail = chunk[pos:]
    if tail.strip():
        out.append(_plain_chunk_to_ssml(tail))
    return "".join(out)


def _clean_tts_text(text: str) -> str:
    text = _re.sub(r'\[[^\]]{0,300}\]', '', text)
    text = _re.sub(r'\*{1,2}[^*]{0,400}\*{1,2}', '', text)
    text = _re.sub(r'_{2}[^_]{0,200}_{2}', '', text)
    text = _re.sub(r'(?i)\bcogni\b', 'كوجني', text)
    text = _re.sub(r'(?i)\beduverse\b', 'إيدوفيرس', text)
    text = _re.sub(r'(?i)\basas\b', 'أساس', text)
    text = _re.sub(r'(?m)^#{1,6}\s+', '', text)
    text = _re.sub(r'`{1,3}[^`]{0,2000}`{1,3}', '', text)
    text = _re.sub(r'\*{2,}', '', text)
    text = _re.sub(r'[ \t]{2,}', ' ', text)
    text = _re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _prepare_tts_text(raw: str) -> tuple[str, list[str]]:
    t, slots = _extract_ssml_placeholders((raw or "").strip())
    t = _clean_tts_text(t)
    t = _strip_invalid_xml_chars(t)
    slots = [_strip_invalid_xml_chars(s) for s in slots]
    return t, slots


def approx_viseme_cues_from_word_cues(
    word_cues: List[Dict[str, Any]],
    dialogue: str,
) -> List[Dict[str, Any]]:
    if not word_cues:
        return []
    sorted_w = sorted(word_cues, key=lambda x: int(x.get("t", 0) or 0))
    if not sorted_w:
        return []
    d = (dialogue or "").strip()
    est_end = int(sorted_w[-1].get("t", 0) or 0) + max(
        250, min(8000, len(d) * 42 if d else 600)
    )
    cues: List[Dict[str, Any]] = []
    for i, w in enumerate(sorted_w):
        t = int(max(0, w.get("t", 0) or 0))
        next_t = int(sorted_w[i + 1].get("t", 0) or 0) if i + 1 < len(sorted_w) else est_end
        span = max(80, next_t - t)
        cues.append({"t": t, "id": 4})
        mid = t + min(140, max(50, span // 3))
        cues.append({"t": mid, "id": 12})
        tail = min(next_t - 15, mid + min(90, span // 2))
        if tail > mid:
            cues.append({"t": tail, "id": 0})
    return cues


async def synthesize_edge_tts_async(text: str, voice: Optional[str] = None) -> bytes:
    """
    Native async Edge TTS — ``await Communicate.save()`` then read MP3 bytes.
    Prefer this from FastAPI/ASGI handlers instead of ``asyncio.run`` or thread executors.
    """
    if not _EDGE_TTS_AVAILABLE:
        print("[EDGE ERROR] edge_tts not installed", flush=True)
        raise RuntimeError("edge-tts is not installed. Run: pip install edge-tts")
    import edge_tts as _edge

    t = (text or "").strip()
    if not t:
        raise ValueError("TTS text cannot be empty")
    v_in = (voice or "").strip()
    if v_in and v_in != EDGE_TTS_VOICE_LOCKED_GLOBAL:
        print("[VOICE OVERRIDE DETECTED]", v_in, flush=True)
    v = EDGE_TTS_VOICE_LOCKED_GLOBAL
    print("[VOICE FINAL]", v, flush=True)
    print(f"[EDGE DEBUG] text_len={len(t)} voice={v!r}", flush=True)

    fd, path = tempfile.mkstemp(suffix=".mp3", prefix="cogni_edge_")
    os.close(fd)
    try:
        _proxy = (os.getenv("EDGE_TTS_PROXY") or "").strip() or None
        communicate = _edge.Communicate(t, v, proxy=_proxy)
        try:
            await communicate.save(path)
        except Exception as exc:
            detail = str(exc)
            logger.error(
                "[EdgeTTS] Communicate.save failed | voice=%s | proxy=%s | err=%s",
                v,
                "set" if _proxy else "none",
                detail[:800],
            )
            low = detail.lower()
            if (
                "403" in detail
                or "invalid response status" in low
                or "wsserverhandshake" in type(exc).__name__.lower()
            ):
                raise RuntimeError(
                    "[edge_forbidden] Microsoft Edge TTS rejected the WebSocket handshake (often HTTP 403). "
                    "Cloud/datacenter IPs are frequently blocked — set EDGE_TTS_PROXY to a reachable HTTP(S) proxy, "
                    "or retry from a residential network / different region. Detail: "
                    + detail[:400]
                ) from exc
            raise RuntimeError(f"[edge_error] Edge TTS failed: {detail[:500]}") from exc
        with open(path, "rb") as f:
            raw = f.read()
        print(f"[EDGE DEBUG] audio_bytes_len={len(raw) if raw else 0}", flush=True)
        if not raw:
            print("[EDGE ERROR] EMPTY AUDIO RETURNED len=0", flush=True)
            raise RuntimeError("EDGE returned empty audio")
        try:
            _cfg_raw = os.getenv("EDGE_TTS_MIN_AUDIO_BYTES", "1200")
            _cfg = int(_cfg_raw)
        except (TypeError, ValueError):
            _cfg = 1200
        _configured = max(512, min(8_000_000, _cfg))
        _min_mp3 = max(1000, _configured)
        if len(raw) < _min_mp3:
            print(f"[EDGE ERROR] EMPTY AUDIO RETURNED len={len(raw)} min_floor={_min_mp3}", flush=True)
            raise RuntimeError("EDGE returned empty audio")
        return raw
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def generate_cogni_voice(
    text: str,
    output_filename: Optional[str] = None,
) -> str:
    """
    Write MP3 under the system temp directory (e.g. ``/tmp`` in Linux containers).
    Returns the path for ``FileResponse``; remove the file after send (e.g. ``BackgroundTasks``).
    If ``output_filename`` is omitted, a unique name is used to avoid concurrent overwrites.
    """
    if not _EDGE_TTS_AVAILABLE:
        raise RuntimeError("edge-tts is not installed. Run: pip install edge-tts")
    import edge_tts as _edge

    t = (text or "").strip()
    if not t:
        raise ValueError("TTS text cannot be empty")
    voice = edge_tts_voice_name()
    raw = (output_filename or f"cogni_{uuid.uuid4().hex}.mp3").strip()
    base = os.path.basename(raw) or f"cogni_{uuid.uuid4().hex}.mp3"
    if not base.lower().endswith(".mp3"):
        base = f"{base}.mp3"
    output_path = os.path.join(tempfile.gettempdir(), base)
    _proxy = (os.getenv("EDGE_TTS_PROXY") or "").strip() or None
    communicate = _edge.Communicate(t, voice, proxy=_proxy)
    await communicate.save(output_path)
    return output_path


def estimate_mp3_duration_ms(mp3_bytes: bytes) -> int:
    """Rough audio length from MP3 payload size (~128 kbps effective; clamped)."""
    if not mp3_bytes or len(mp3_bytes) < 32:
        return 800
    n = len(mp3_bytes)
    est = int(n * 1000 / 16000)
    return min(180_000, max(400, est))


def stub_viseme_timeline_for_text(
    text: str,
    duration_ms: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Synthetic viseme markers for clients that require a non-empty timeline.

    Uses ``offset_ms`` + ``viseme_id`` so the BFF/client parser never confuses ms with seconds.
    When ``duration_ms`` is set (e.g. from MP3 byte size), the stub matches clip length better.
    """
    nchars = len((text or "").strip())
    text_guess_ms = min(180_000, max(800, nchars * 45 + 600))
    if duration_ms is not None:
        measured = min(180_000, max(400, int(duration_ms)))
        # Prefer measured MP3 length; keep a floor so ultra-fast encodes still get a usable cue count.
        dur_ms = max(measured, min(text_guess_ms, int(measured * 1.25)))
    else:
        dur_ms = text_guess_ms
    out: List[Dict[str, Any]] = []
    t = 0
    step_ms = 140
    # Rotate Azure-style viseme ids so the mouth visibly moves (not frozen on one shape).
    ids = (4, 6, 8, 12, 15, 7, 5, 9, 11, 13)
    i = 0
    while t < dur_ms:
        out.append({"offset_ms": t, "viseme_id": ids[i % len(ids)]})
        t += step_ms
        i += 1
    return out


def synthesize_edge_tts(text: str, voice: Optional[str] = None) -> bytes:
    """
    Synchronous Edge TTS — wraps ``synthesize_edge_tts_async`` via ``asyncio.run``.
    Use from thread executors or non-async code only (not from a running event loop).
    """
    return asyncio.run(synthesize_edge_tts_async(text, voice))


class EdgeTTSService:
    """Microsoft Edge online TTS — returns MP3, empty viseme/word lists, provider id ``edge``."""

    def __init__(
        self,
        speech_key: Optional[str] = None,
        speech_region: Optional[str] = None,
        default_voice: Optional[str] = None,
        prosody_rate: float = 1.05,
        request_timeout: float = 15.0,
    ) -> None:
        self._key = speech_key
        self._region = speech_region
        self._prosody_rate = prosody_rate
        self._timeout = request_timeout
        self._default_voice = default_voice or edge_tts_voice_name()
        self._available = _EDGE_TTS_AVAILABLE

    async def synthesize(
        self,
        text: str,
        voice_name: Optional[str] = None,
        timeout: Optional[float] = None,
        emotion: str = 'neutral',
        persona_level: str = 'pass',
        client_voice_rate: float = 1.0,
        client_pitch_scale: float = 1.0,
        usage_user_id: Optional[uuid.UUID] = None,
    ) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], str]:
        raw_in = (text or "").strip()
        try:
            from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts

            text_for_tts = maybe_correct_egyptian_for_tts(raw_in, context="edge_tts_synthesize")
        except Exception:
            text_for_tts = raw_in
        cleaned, _slots = _prepare_tts_text(text_for_tts)
        if not cleaned:
            raise ValueError("TTS text cannot be empty after cleanup")

        if not _EDGE_TTS_AVAILABLE:
            raise RuntimeError("edge-tts is not installed. Run: pip install edge-tts")

        voice = _locked_edge_voice_for_sdk(voice_name or self._default_voice)

        timeout_val = timeout if timeout is not None else self._timeout

        mp3_b = await asyncio.wait_for(
            synthesize_edge_tts_async(cleaned, voice),
            timeout=timeout_val,
        )
        if usage_user_id:
            try:
                from app.services.usage_service import log_tts_usage

                log_tts_usage(usage_user_id, len(cleaned))
            except Exception:
                pass
        return mp3_b, [], [], "edge"

    async def reload_credentials(self) -> None:
        """Edge TTS uses no local credential file."""
        return None


# Legacy aliases
GoogleTTSService = EdgeTTSService
AzureTTSService = EdgeTTSService
_SDK_AVAILABLE = _EDGE_TTS_AVAILABLE
_GOOGLE_TTS_AVAILABLE = _EDGE_TTS_AVAILABLE

# Backward-compatible name for tts_timing / main
synthesize_google_tts = synthesize_edge_tts


def google_tts_voice_name() -> str:
    """Deprecated: use edge_tts_voice_name()."""
    return edge_tts_voice_name()


def synthesize(text: str) -> str:
    """Synchronous smoke test (requires edge-tts + outbound network)."""
    try:
        from app.archive.tts_data_dirs import ensure_tts_data_dirs

        ensure_tts_data_dirs()
    except Exception as e:
        return f"TTS smoke: data dirs error: {type(e).__name__}: {e}"
    if not _EDGE_TTS_AVAILABLE:
        return "TTS smoke: edge-tts not installed"
    t = (text or "").strip()
    if not t:
        return "TTS smoke: empty text"

    async def _once() -> Tuple[bytes, int, int]:
        svc = EdgeTTSService()
        mp3_b, v_cues, w_cues, _ = await svc.synthesize(t, voice_name=edge_tts_voice_name())
        return mp3_b, len(w_cues), len(v_cues)

    try:
        mp3_b, nw, nv = asyncio.run(_once())
        return (
            f"ok edge | text_len={len(t)} | audio_bytes={len(mp3_b)} | words={nw} | visemes={nv}"
        )
    except Exception as e:
        return f"TTS smoke failed: {type(e).__name__}: {e}"
