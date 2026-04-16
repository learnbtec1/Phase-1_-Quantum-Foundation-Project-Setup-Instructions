# -*- coding: utf-8 -*-
"""
Microsoft Edge TTS (edge-tts) — Jordanian Arabic neural voices, no API key.
Returns MP3 bytes. Viseme/word timelines are not provided; callers may attach
stub timelines for clients that expect non-empty arrays.

Install:
    pip install edge-tts
"""
from __future__ import annotations

import asyncio
import logging
import os
import re as _re
import tempfile
import uuid
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape as _xml_sax_escape

try:
    import edge_tts  # noqa: F401

    _EDGE_TTS_AVAILABLE = True
except ImportError:
    edge_tts = None  # type: ignore[assignment]
    _EDGE_TTS_AVAILABLE = False
    logging.warning(
        "[EdgeTTS] edge-tts not installed. Run: pip install edge-tts"
    )

logger = logging.getLogger(__name__)

_ARABIC_SCRIPT_RE = _re.compile(r"[\u0600-\u06FF]")


async def synthesize_elevenlabs_async(text: str) -> bytes:
    """
    ElevenLabs Multilingual v2, MP3 44.1kHz @ 128kbps (mp3_44100_128).
    Requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID when TTS_PROVIDER=elevenlabs.
    """
    import httpx

    api_key = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    voice_id = (os.getenv("ELEVENLABS_VOICE_ID") or "").strip()
    if not api_key or not voice_id:
        raise RuntimeError(
            "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set when using ElevenLabs TTS"
        )
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    params = {"output_format": "mp3_44100_128"}
    body: Dict[str, Any] = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
    }
    if _ARABIC_SCRIPT_RE.search(text):
        body["language_code"] = "ar"
    timeout = float(os.getenv("ELEVENLABS_TTS_TIMEOUT_SEC", "120"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            url,
            params=params,
            json=body,
            headers={"xi-api-key": api_key},
        )
    if r.status_code >= 400:
        raise RuntimeError(
            f"ElevenLabs HTTP {r.status_code}: {(r.text or '')[:800]}",
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
    """Neural voice id (e.g. ar-JO-TaimNeural). Override with EDGE_TTS_VOICE."""
    v = (os.getenv("EDGE_TTS_VOICE") or os.getenv("TTS_ARABIC_VOICE") or "ar-JO-TaimNeural").strip()
    return v or "ar-JO-TaimNeural"


def _locked_jordanian_male_voice(requested: Optional[str]) -> str:
    """
    Cogni policy: locked male Jordanian neural when TTS_FORCE_JORDANIAN is True.
    Synthesis uses edge_tts_voice_name() by default.
    """
    try:
        from app.core.config import settings as _cfg

        locked = str(getattr(_cfg, "COGNI_ARABIC_TTS_VOICE_LOCKED", "ar-JO-TaimNeural") or "ar-JO-TaimNeural")
        force_jo = bool(getattr(_cfg, "TTS_FORCE_JORDANIAN", True))
    except Exception:
        locked = "ar-JO-TaimNeural"
        force_jo = True
    r = (requested or "").strip()
    if not force_jo:
        return r or locked
    if r and "ar-JO" not in r:
        logger.warning(
            "[TTS] Non-Jordanian voice %r rejected — using locked Jordanian %s",
            r,
            locked,
        )
        r = ""
    eff = r or locked
    if eff != locked:
        logger.warning("[TTS] Voice %r overridden — Cogni uses locked male Jordanian %s", eff, locked)
    return locked


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
        raise RuntimeError("edge-tts is not installed. Run: pip install edge-tts")
    import edge_tts as _edge

    t = (text or "").strip()
    if not t:
        raise ValueError("TTS text cannot be empty")
    v = (voice or edge_tts_voice_name()).strip() or "ar-JO-TaimNeural"

    fd, path = tempfile.mkstemp(suffix=".mp3", prefix="cogni_edge_")
    os.close(fd)
    try:
        communicate = _edge.Communicate(t, v)
        await communicate.save(path)
        with open(path, "rb") as f:
            raw = f.read()
        if not raw:
            raise RuntimeError("Edge TTS returned empty audio bytes")
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
    communicate = _edge.Communicate(t, voice)
    await communicate.save(output_path)
    return output_path


def stub_viseme_timeline_for_text(text: str) -> List[Dict[str, Any]]:
    """Synthetic viseme markers for clients that require a non-empty timeline."""
    n = len((text or "").strip())
    dur_ms = min(180_000, max(800, n * 45 + 600))
    out: List[Dict[str, Any]] = []
    t = 0
    while t < dur_ms:
        out.append({"t": t, "id": 4})
        t += 140
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

        voice = _locked_jordanian_male_voice(voice_name or self._default_voice)

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
