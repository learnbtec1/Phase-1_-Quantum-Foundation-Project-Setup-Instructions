# -*- coding: utf-8 -*-
"""
TTS-with-timing endpoint: POST /api/v1/tts-with-timing
Synthesize speech with word-level timing for lip-sync and viseme events.

Priority chain:
  • Arabic + provider/primary habibi: Habibi-TTS first, then auto cloud chain if it fails.
  • Default (TTS_PRIMARY_PROVIDER=edge): edge → Azure → Kokoro → last-chance edge → Habibi → gTTS (gated).
  • gTTS Arabic optional “catastrophe” gate: TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES (>0).
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
import struct
import time
from collections import deque
from threading import Lock
from typing import Optional, List, Dict, Any, Tuple

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.kokoro_tts import is_available, synthesize_with_timing
from app.services.tts_service import (
    DEFAULT_EDGE_TTS_PROSODY as _DEFAULT_PROSODY,
    EDGE_TTS_EMOTION_PROSODY as _EMOTION_PROSODY,
    _locked_jordanian_male_voice,
    is_azure_tts_auth_failure,
    synthesize_edge_tts_mp3,
)
from app.services.conversation_store import get_store as _get_store

# 🚀 Import Local Habibi-TTS Service (Graceful fallback if module is missing)
try:
    from app.core.tts_habibi import synthesize_habibi_tts
except ImportError:
    synthesize_habibi_tts = None

# Module-level ConversationStore singleton
try:
    _store = _get_store()
except Exception as _store_exc:  # pragma: no cover
    import logging as _log
    _log.getLogger(__name__).warning("ConversationStore init failed: %s", _store_exc)
    _store = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _classify_tts_exception(exc: BaseException) -> tuple[str, str]:
    name = type(exc).__name__
    msg = (str(exc) or "").strip() or "(no message)"
    low = msg.lower()
    if isinstance(exc, asyncio.TimeoutError) or isinstance(exc, TimeoutError):
        return "timeout", f"{name}: {msg}"
    if isinstance(exc, asyncio.CancelledError):
        return "cancelled", f"{name}: {msg}"
    if isinstance(exc, (ConnectionError, BrokenPipeError)):
        return "connection", f"{name}: {msg}"
    if isinstance(exc, OSError):
        err_no = getattr(exc, "errno", None)
        if err_no is not None:
            if err_no in (110, 111, 101, 113, 99):
                return "connection", f"{name}[errno={err_no}]: {msg}"
        if "getaddrinfo" in low or "name or service not known" in low or "nodename nor servname" in low:
            return "dns", f"{name}: {msg}"
    if "401" in msg or "403" in msg or "unauthor" in low or "authentication" in low or "access denied" in low:
        return "auth", f"{name}: {msg}"
    if "certificate" in low or "ssl" in low or "tls" in low:
        return "tls", f"{name}: {msg}"
    if isinstance(exc, ValueError):
        return "value", f"{name}: {msg}"
    return "error", f"{name}: {msg}"


def _effective_allow_gtts_arabic() -> bool:
    if bool(getattr(settings, "TTS_ALLOW_GTTS_ARABIC_FALLBACK", False)):
        return True
    raw = (os.getenv("TTS_ALLOW_GTTS_ARABIC_FALLBACK") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


_AR_SCRIPT_RE = re.compile(r"[\u0600-\u06FF]")
_ALLOWED_TTS_PROVIDERS = frozenset({"azure", "edge", "auto", "kokoro", "gtts", "habibi"})


def _is_arabic_script(t: str) -> bool:
    return bool(_AR_SCRIPT_RE.search(t or ""))


def _resolve_tts_provider(payload_provider: Optional[str], text: str) -> str:
    """
    Sovereign rule: Arabic + habibi from payload, TTS_PROVIDER, or TTS_PRIMARY_PROVIDER → habibi.
    """
    raw = (payload_provider or "").strip().lower()
    env_p = (os.getenv("TTS_PROVIDER") or "").strip().lower()
    prim = str(getattr(settings, "TTS_PRIMARY_PROVIDER", "edge") or "edge").lower().strip()

    if _is_arabic_script(text):
        if raw == "habibi" or env_p == "habibi" or prim == "habibi":
            return "habibi"

    if raw in _ALLOWED_TTS_PROVIDERS:
        if raw == "habibi" and not _is_arabic_script(text):
            return "auto"
        return raw
    if env_p in _ALLOWED_TTS_PROVIDERS:
        if env_p == "habibi" and not _is_arabic_script(text):
            return "auto"
        return env_p
    if prim in _ALLOWED_TTS_PROVIDERS:
        if prim == "habibi" and not _is_arabic_script(text):
            return "auto"
        return prim
    if prim == "azure":
        return "azure"
    return "auto"


# ── Consecutive Arabic TTS failures (for gTTS “catastrophe” gate) ────────────
_GTTS_STREAK_LOCK = Lock()
_arabic_tts_consecutive_failures: int = 0


def _ar_tts_failure_streak_reset() -> None:
    global _arabic_tts_consecutive_failures
    with _GTTS_STREAK_LOCK:
        _arabic_tts_consecutive_failures = 0


def _ar_tts_failure_streak_value() -> int:
    with _GTTS_STREAK_LOCK:
        return _arabic_tts_consecutive_failures


def _ar_tts_failure_streak_bump() -> int:
    global _arabic_tts_consecutive_failures
    with _GTTS_STREAK_LOCK:
        _arabic_tts_consecutive_failures = min(_arabic_tts_consecutive_failures + 1, 10_000)
        return _arabic_tts_consecutive_failures


def _finalize_tts_success(resp: TTSResponse) -> TTSResponse:
    _ar_tts_failure_streak_reset()
    return resp


def _gtts_arabic_min_streak_required() -> int:
    raw = os.getenv("TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES", "").strip()
    if raw:
        try:
            return max(0, min(int(raw, 10), 1000))
        except ValueError:
            pass
    return max(0, min(int(getattr(settings, "TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES", 0) or 0), 1000))


# ─────────────────────────────────────────────────────────────────────────────
# Circuit-breaker — Azure TTS
# ─────────────────────────────────────────────────────────────────────────────
_CB_LOCK            = Lock()
_cb_failures:   int = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD   = 5      
_CB_COOLDOWN    = 20.0   


def _azure_cb_ok() -> bool:
    return time.monotonic() >= _cb_open_until


def _azure_cb_record_failure() -> None:
    global _cb_failures, _cb_open_until
    with _CB_LOCK:
        _cb_failures += 1
        if _cb_failures >= _CB_THRESHOLD:
            _cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(
                "Azure TTS circuit OPENED — %d consecutive failures, cooldown %.0fs",
                _cb_failures, _CB_COOLDOWN,
            )


def _azure_cb_record_success() -> None:
    global _cb_failures, _cb_open_until
    with _CB_LOCK:
        if _cb_failures:
            logger.info("Azure TTS circuit CLOSED after %d failure(s)", _cb_failures)
        _cb_failures   = 0
        _cb_open_until = 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Rate-limiter
# ─────────────────────────────────────────────────────────────────────────────
_RL_LOCK  = Lock()
_rl_store: Dict[str, deque] = {}
_RL_WINDOW = 1.0   
_RL_MAX    = 3     


def _rate_limit_ok(ip: str) -> bool:
    now = time.monotonic()
    with _RL_LOCK:
        q = _rl_store.setdefault(ip, deque())
        while q and (now - q[0]) > _RL_WINDOW:
            q.popleft()
        if len(q) >= _RL_MAX:
            return False
        q.append(now)
        return True


# ─────────────────────────────────────────────────────────────────────────────
# Text chunking
# ─────────────────────────────────────────────────────────────────────────────
_MAX_CHUNK = 800
_SENT_SPLIT = re.compile(r'(?<=[.!?؟،,;،\u060c])\s+')


def _chunk_text(text: str) -> List[str]:
    if len(text) <= _MAX_CHUNK:
        return [text]
    parts   = _SENT_SPLIT.split(text)
    chunks: List[str] = []
    current = ""
    for part in parts:
        if len(current) + len(part) + 1 <= _MAX_CHUNK:
            current = (current + " " + part).strip() if current else part
        else:
            if current:
                chunks.append(current)
            for i in range(0, len(part), _MAX_CHUNK):
                seg = part[i : i + _MAX_CHUNK]
                if i + _MAX_CHUNK < len(part):
                    chunks.append(seg)
                else:
                    current = seg
    if current:
        chunks.append(current)
    return chunks or [text]


# ─────────────────────────────────────────────────────────────────────────────
# WAV helpers
# ─────────────────────────────────────────────────────────────────────────────

def _wav_duration_ms(wav_bytes: bytes) -> float:
    pcm_bytes = max(0, len(wav_bytes) - 44)
    return pcm_bytes / (24_000 * 2) * 1_000


def _merge_wav_chunks(wav_list: List[bytes]) -> bytes:
    pcm = b"".join(w[44:] for w in wav_list)
    data_size = len(pcm)
    header = bytearray(44)
    header[0:4]  = b'RIFF'
    struct.pack_into('<I', header, 4,  36 + data_size)
    header[8:12]  = b'WAVE'
    header[12:16] = b'fmt '
    struct.pack_into('<I', header, 16, 16)
    struct.pack_into('<H', header, 20, 1)       
    struct.pack_into('<H', header, 22, 1)       
    struct.pack_into('<I', header, 24, 24_000)  
    struct.pack_into('<I', header, 28, 48_000)  
    struct.pack_into('<H', header, 32, 2)       
    struct.pack_into('<H', header, 34, 16)      
    header[36:40] = b'data'
    struct.pack_into('<I', header, 40, data_size)
    return bytes(header) + pcm


# ─────────────────────────────────────────────────────────────────────────────
# ffmpeg MP3 → WAV converter
# ─────────────────────────────────────────────────────────────────────────────

def _mp3_to_wav_ffmpeg(mp3_bytes: bytes) -> Optional[bytes]:
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("ffmpeg"):
        return None
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fin:
        fin.write(mp3_bytes)
        fin_path = fin.name
    fout_path = fin_path.replace(".mp3", ".wav")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", fin_path,
                "-ar", "24000", "-ac", "1", "-sample_fmt", "s16",
                fout_path,
            ],
            check=True,
            capture_output=True,
            timeout=10,
        )
        with open(fout_path, "rb") as f:
            return f.read()
    except Exception:
        return None
    finally:
        try:
            os.unlink(fin_path)
        except OSError:
            pass
        try:
            os.unlink(fout_path)
        except OSError:
            pass

router = APIRouter()

# ── Jordanian SSML helpers ─────────────────────
_RE_EN_TOKEN  = re.compile(r'([A-Za-z][A-Za-z0-9]*(?:[/-][A-Za-z0-9]+)*)')
_RE_ACRONYM   = re.compile(r'^[A-Z][A-Z0-9]{1,}$')
_RE_SENT_BOUN = re.compile(r'([.،؟!؟\n]+)\s*')

_AZURE_EMOTION_PROSODY: Dict[str, tuple] = {
    'thinking':    ('0.9', '82%',  '+1%'),
    'sad':         ('1.0', '84%',  '-2%'),
    'concerned':   ('1.0', '88%',  '+0%'),
    'neutral':     ('1.0', '90%',  '+2%'),
    'attentive':   ('1.1', '93%',  '+2%'),
    'curious':     ('1.1', '93%',  '+2%'),
    'friendly':    ('1.2', '92%',  '+2%'),
    'strict':      ('1.3', '89%',  '+0%'),
    'proud':       ('1.3', '97%',  '+2%'),
    'happy':       ('1.4', '98%',  '+3%'),
    'encouraging': ('1.5', '100%', '+3%'),
    'excited':     ('1.8', '102%', '+4%'),
    'surprised':   ('1.6', '101%', '+4%'),
    'celebrate':   ('2.0', '103%', '+5%'),
    'celebration': ('2.0', '103%', '+5%'),
}


def _xml_escape_tts(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&apos;')


def _render_tts_segment(kind: str, content: str) -> str:
    safe = _xml_escape_tts(content)
    if kind == 'ar':
        return safe
    if _RE_ACRONYM.match(content):
        return f'<lang xml:lang="en-GB"><say-as interpret-as="spell-out">{safe}</say-as></lang>'
    return f'<lang xml:lang="en-GB">{safe}</lang>'


def _build_azure_ssml(text: str, voice: str, emotion: str = 'neutral') -> str:
    lang = "-".join(voice.split("-")[:2]) if "-" in voice else "ar-JO"
    styledegree, rate_pct, pitch = _AZURE_EMOTION_PROSODY.get(
        (emotion or 'neutral').lower(),
        ('1.0', '95%', '+2%'),
    )

    tokens = _RE_SENT_BOUN.split(text)
    parts: list = []
    i = 0
    while i < len(tokens):
        chunk = tokens[i].strip()
        i += 1
        punct = tokens[i].strip() if i < len(tokens) else ''
        if punct:
            i += 1
        if not chunk and not punct:
            continue
        segs = []
        last = 0
        for m in _RE_EN_TOKEN.finditer(chunk):
            if m.start() > last:
                segs.append(_render_tts_segment('ar', chunk[last:m.start()]))
            segs.append(_render_tts_segment('en', m.group()))
            last = m.end()
        if last < len(chunk):
            segs.append(_render_tts_segment('ar', chunk[last:]))
        inner = ''.join(segs)
        is_q = bool(punct) and ('؟' in punct or '?' in punct)
        if inner:
            if is_q:
                parts.append(f'<prosody pitch="+8%">{inner}{_xml_escape_tts(punct)}</prosody>')
            else:
                parts.append(inner + (_xml_escape_tts(punct) if punct else ''))
        if punct and i < len(tokens):
            pause_ms = 320 if ('.' in punct or '\n' in punct) else 200
            parts.append(f'<break time="{pause_ms}ms"/>')

    body = '\n'.join(parts)
    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="{lang}">'
        f'<voice name="{voice}" xml:lang="{lang}">'
        f'<mstts:express-as style="friendly" styledegree="{styledegree}" xml:lang="{lang}">'
        f'<prosody rate="{rate_pct}" pitch="{pitch}">'
        f'{body}'
        f'</prosody>'
        f'</mstts:express-as>'
        f'</voice>'
        f'</speak>'
    )


def _synthesize_azure_sync(
    text: str,
    key: str,
    region: str,
    voice: str,
    emotion: str = 'neutral',
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    import azure.cognitiveservices.speech as speechsdk
    voice = _locked_jordanian_male_voice(voice)
    speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
    )
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
    visemes: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []

    def _on_viseme(evt: speechsdk.SpeechSynthesisVisemeEventArgs) -> None:
        visemes.append({
            "offset_ms": evt.audio_offset / 10_000,
            "viseme_id": evt.viseme_id,
        })

    def _on_word(evt: speechsdk.SpeechSynthesisWordBoundaryEventArgs) -> None:
        start_ms = evt.audio_offset / 10_000
        end_ms = start_ms + (evt.duration / 10_000)
        words.append({
            "word": evt.text,
            "start_time": start_ms,
            "end_time": end_ms,
        })

    synthesizer.viseme_received.connect(_on_viseme)
    synthesizer.synthesis_word_boundary.connect(_on_word)

    ssml = _build_azure_ssml(text, voice, emotion=emotion)
    result = synthesizer.speak_ssml_async(ssml).get()

    synthesizer.viseme_received.disconnect_all()
    synthesizer.synthesis_word_boundary.disconnect_all()

    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        if result.reason == speechsdk.ResultReason.Canceled:
            details = speechsdk.SpeechSynthesisCancellationDetails(result)
            raise RuntimeError(f"Azure TTS canceled: {details.reason.name} / {details.error_details}")
        raise RuntimeError(f"Azure TTS failed: reason={result.reason}")

    wav_bytes = result.audio_data
    timing_approx = False
    if not words and wav_bytes:
        pcm_bytes = max(0, len(wav_bytes) - 44)
        total_ms = pcm_bytes / (24_000 * 2) * 1_000
        word_list = [w for w in text.split() if w.strip()]
        if word_list and total_ms > 0:
            step = total_ms / len(word_list)
            words = [
                {"word": w, "start_time": round(i * step, 2), "end_time": round((i + 1) * step, 2)}
                for i, w in enumerate(word_list)
            ]
            timing_approx = True

    return wav_bytes, words, visemes, timing_approx


async def _synthesize_azure(
    text: str, key: str, region: str, voice: str, emotion: str = 'neutral',
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _synthesize_azure_sync, text, key, region, voice, emotion)


async def _edge_mp3_to_tts_response(
    mp3_bytes: bytes,
    word_timings: List[Dict[str, Any]],
    viseme_events: List[Dict[str, Any]],
    *,
    t_start: float,
    text: str,
    background_tasks: BackgroundTasks,
    voice_label: str,
) -> TTSResponse:
    wav_from_ffmpeg = await asyncio.get_event_loop().run_in_executor(
        None, _mp3_to_wav_ffmpeg, mp3_bytes
    )
    if wav_from_ffmpeg:
        b64 = base64.b64encode(wav_from_ffmpeg).decode("ascii")
        ms = int((time.monotonic() - t_start) * 1000)
        logger.info(
            "TTS provider=%-8s format=%-3s timing=%-6s latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
            "edge-tts", "wav", "real", ms, len(wav_from_ffmpeg) / 1024, len(word_timings), len(viseme_events),
        )
        _resp = TTSResponse(
            audio_base64=b64, audio_wav_base64=b64, audio_mp3_base64=None,
            word_timings=word_timings, viseme_events=viseme_events,
            sample_rate=24000, format="wav", timing_mode="real",
            provider="edge-tts", voice=voice_label,
        )
    else:
        b64 = base64.b64encode(mp3_bytes).decode("ascii")
        ms = int((time.monotonic() - t_start) * 1000)
        logger.info(
            "TTS provider=%-8s format=%-3s timing=%-6s latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
            "edge-tts", "mp3", "real", ms, len(mp3_bytes) / 1024, len(word_timings), len(viseme_events),
        )
        _resp = TTSResponse(
            audio_base64=b64, audio_wav_base64=None, audio_mp3_base64=b64,
            word_timings=word_timings, viseme_events=viseme_events,
            sample_rate=24000, format="mp3", timing_mode="real",
            provider="edge-tts", voice=voice_label,
        )
        
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response,
            text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
            _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
            int((time.monotonic() - t_start) * 1000),
        )
    return _resp


def _edge_tts_attempts() -> int:
    raw = os.getenv("EDGE_TTS_ATTEMPTS", "3")
    try: return max(1, min(int(str(raw).strip(), 10), 8))
    except ValueError: return 3


def _edge_tts_timeout_sec() -> float:
    raw = os.getenv("EDGE_TTS_TIMEOUT_SEC", "35")
    try: return max(15.0, min(float(str(raw).strip()), 120.0))
    except ValueError: return 35.0


async def _try_synthesize_edge_tts_response(
    text: str, tts_rate: str, tts_pitch: str, ar_voice_name: str, t_start: float,
    background_tasks: BackgroundTasks, failure_notes: Optional[List[str]] = None,
) -> Optional[TTSResponse]:
    attempts = _edge_tts_attempts()
    timeout_sec = _edge_tts_timeout_sec()
    for attempt in range(attempts):
        try:
            mp3_bytes, word_timings, viseme_events = await asyncio.wait_for(
                synthesize_edge_tts_mp3(text, rate=tts_rate, pitch=tts_pitch, voice=ar_voice_name),
                timeout=timeout_sec,
            )
            return await _edge_mp3_to_tts_response(
                mp3_bytes, word_timings, viseme_events, t_start=t_start, text=text,
                background_tasks=background_tasks, voice_label=ar_voice_name,
            )
        except Exception as e:
            kind, detail = _classify_tts_exception(e)
            logger.error("[TTS][edge-tts] attempt %d/%d failed — kind=%s type=%s detail=%s",
                         attempt + 1, attempts, kind, type(e).__name__, detail)
            if failure_notes is not None:
                failure_notes.append(f"edge-tts:{kind}:{detail}")
            if attempt + 1 < attempts:
                await asyncio.sleep(0.35 * (attempt + 1))
    return None


def _synthesize_gtts_sync(text: str, lang: str = "ar") -> bytes:
    try: from gtts import gTTS
    except ImportError as e:
        raise RuntimeError("gTTS package not installed (pip install gtts)") from e
    buf = io.BytesIO()
    try: gTTS(text=text, lang=lang, slow=False).write_to_fp(buf)
    except Exception as e:
        kind, detail = _classify_tts_exception(e)
        logger.error("[TTS][gtts] synthesis failed — kind=%s lang=%s type=%s detail=%s", kind, lang, type(e).__name__, detail)
        raise
    return buf.getvalue()


async def _gtts_mp3_to_response(
    mp3_bytes: bytes, text: str, t_start: float, background_tasks: BackgroundTasks,
) -> TTSResponse:
    try:
        word_timings = _estimate_word_timings(text)
        wav_from_ffmpeg = await asyncio.get_event_loop().run_in_executor(None, _mp3_to_wav_ffmpeg, mp3_bytes)
    except Exception as e:
        kind, detail = _classify_tts_exception(e)
        logger.error("[TTS][gtts] post-process failed — kind=%s type=%s detail=%s", kind, type(e).__name__, detail)
        raise
        
    b64 = base64.b64encode(wav_from_ffmpeg if wav_from_ffmpeg else mp3_bytes).decode("ascii")
    ms = int((time.monotonic() - t_start) * 1000)
    fmt = "wav" if wav_from_ffmpeg else "mp3"
    
    logger.info("TTS provider=%-8s format=%-3s timing=%-6s latency_ms=%d words=%d visemes=0",
                "gtts", fmt, "approx", ms, len(word_timings))
                
    _resp = TTSResponse(
        audio_base64=b64,
        audio_wav_base64=b64 if wav_from_ffmpeg else None,
        audio_mp3_base64=None if wav_from_ffmpeg else b64,
        word_timings=word_timings, viseme_events=[], sample_rate=24000,
        format=fmt, timing_mode="approx", provider="gtts",
    )
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response, text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
            _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events, ms,
        )
    return _resp


def _estimate_word_timings(text: str, ms_per_word: float = 350.0) -> List[Dict[str, Any]]:
    words = text.split()
    return [{"word": w, "start_time": i * ms_per_word, "end_time": (i + 1) * ms_per_word} for i, w in enumerate(words)]


class TTSRequest(BaseModel):
    text:     str            = Field(..., min_length=1, max_length=2000)
    voice:    Optional[str]  = Field(default="am_michael")
    speed:    Optional[float]= Field(default=1.0, ge=0.25, le=4.0)
    emotion:  Optional[str]  = Field(default="neutral")
    pitch:    Optional[str]  = Field(default=None)   
    ar_voice: Optional[str]  = Field(default=None)   
    provider: Optional[str]  = Field(default=None)   
    language: Optional[str]  = Field(default=None)   
    format:   Optional[str]  = Field(default="wav")
    sample_rate: Optional[int] = Field(default=24000)
    with_timing: Optional[bool] = Field(default=True)


class TTSResponse(BaseModel):
    audio_base64:     str
    audio_wav_base64: Optional[str] = None
    audio_mp3_base64: Optional[str] = None
    word_timings:   List[Dict[str, Any]] = []
    viseme_events:  List[Dict[str, Any]] = []
    sample_rate:  int = 24000
    format:       str = "wav"          
    timing_mode:  str = "approx"         
    provider:     Optional[str] = None   
    voice:        Optional[str] = None   


def _build_habibi_tts_response(
    wav_bytes: bytes,
    text: str,
    t_start: float,
    background_tasks: BackgroundTasks,
    obs_log,
) -> TTSResponse:
    pcm_bytes = max(0, len(wav_bytes) - 44)
    total_ms = pcm_bytes / (24_000 * 2) * 1_000
    word_list = [w for w in text.split() if w.strip()]
    wt: List[Dict[str, Any]] = []
    if word_list and total_ms > 0:
        step = total_ms / len(word_list)
        wt = [
            {"word": w, "start_time": round(i * step, 2), "end_time": round((i + 1) * step, 2)}
            for i, w in enumerate(word_list)
        ]
    obs_log("habibi", "wav", "approx", len(wav_bytes), len(wt), 0)
    _resp = TTSResponse(
        audio_base64=base64.b64encode(wav_bytes).decode("ascii"),
        audio_wav_base64=base64.b64encode(wav_bytes).decode("ascii"),
        audio_mp3_base64=None,
        word_timings=wt,
        viseme_events=[],
        sample_rate=24000,
        format="wav",
        timing_mode="approx",
        provider="habibi",
        voice="ar-JO-HabibiLocal",
    )
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response,
            text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
            _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
            int((time.monotonic() - t_start) * 1000),
        )
    return _resp


async def _run_habibi_executor(text: str) -> Optional[bytes]:
    if synthesize_habibi_tts is None:
        return None
    loop = asyncio.get_event_loop()
    try:
        raw_timeout = float(os.getenv("HABIBI_ASYNC_TIMEOUT_SEC", "180"))
    except ValueError:
        raw_timeout = 180.0
    outer = max(30.0, min(raw_timeout, 600.0))
    try:
        out = await asyncio.wait_for(
            loop.run_in_executor(None, synthesize_habibi_tts, text),
            timeout=outer,
        )
        if not out:
            return None
        return out
    except asyncio.TimeoutError:
        logger.error("[TTS][habibi] executor wait_for timed out (%.0fs)", outer)
        return None


async def _synthesize_azure_chunked(
    text: str, key: str, region: str, voice: str, emotion: str = 'neutral',
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    chunks = _chunk_text(text)
    if len(chunks) == 1:
        return await _synthesize_azure(text, key, region, voice, emotion=emotion)

    wav_list: List[bytes]           = []
    all_words: List[Dict[str, Any]] = []
    all_vis:   List[Dict[str, Any]] = []
    any_approx = False
    offset_ms  = 0.0

    for chunk in chunks:
        wav, words, vis, approx = await _synthesize_azure(chunk, key, region, voice, emotion=emotion)
        wav_list.append(wav)
        for w in words:
            all_words.append({**w, "start_time": w["start_time"] + offset_ms, "end_time": w["end_time"] + offset_ms})
        for v in vis:
            all_vis.append({**v, "offset_ms": v["offset_ms"] + offset_ms})
        if approx: any_approx = True
        offset_ms += _wav_duration_ms(wav)

    return _merge_wav_chunks(wav_list), all_words, all_vis, any_approx


@router.post("/tts-reset-circuit")
async def tts_reset_circuit():
    _azure_cb_record_success()
    _ar_tts_failure_streak_reset()
    return {"ok": True, "message": "Azure TTS circuit breaker + Arabic gTTS failure streak reset"}


@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(payload: TTSRequest, request: Request, background_tasks: BackgroundTasks):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    client_ip = (request.client.host if request.client else "unknown")
    if not _rate_limit_ok(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded (3 req/s per client)")

    t_start = time.monotonic()
    failure_notes: List[str] = []

    prosody = _EMOTION_PROSODY.get((payload.emotion or 'neutral').lower(), _DEFAULT_PROSODY)
    tts_rate  = prosody['rate']
    tts_pitch = payload.pitch if payload.pitch else prosody['pitch']

    _ar_voice_req = (payload.ar_voice or "").strip().lower()
    if _ar_voice_req == "female":
        logger.warning("tts-with-timing: ar_voice=female ignored — Cogni locked to male Jordanian TTS")
    ar_voice_name = _locked_jordanian_male_voice(payload.ar_voice or settings.TTS_ARABIC_VOICE)

    _provider = _resolve_tts_provider(payload.provider, text)
    _azure_key    = settings.AZURE_SPEECH_KEY
    _azure_region = settings.AZURE_SPEECH_REGION
    _azure_voice = (payload.voice if payload.voice and payload.voice not in ("am_michael",) else os.getenv("TTS_VOICE", settings.TTS_ARABIC_VOICE))
    _azure_voice = _locked_jordanian_male_voice(_azure_voice)
    _azure_ok = bool(_azure_key and _azure_region)

    def _obs_log(provider: str, fmt: str, mode: str, wav_b: int, words_n: int, vis_n: int) -> None:
        ms = int((time.monotonic() - t_start) * 1000)
        logger.info("TTS provider=%-8s format=%-3s timing=%-6s latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
                    provider, fmt, mode, ms, wav_b / 1024, words_n, vis_n)

    habibi_primary_attempted = False
    if _provider == "habibi" and _is_arabic_script(text):
        habibi_primary_attempted = True
        logger.info("[TTS] Sovereign priority: Habibi-TTS first (Arabic + habibi provider/primary).")
        wav_h = await _run_habibi_executor(text)
        if wav_h:
            _hb = _build_habibi_tts_response(wav_h, text, t_start, background_tasks, _obs_log)
            return _finalize_tts_success(_hb)
        failure_notes.append("habibi:primary:unavailable_or_failed")
        _provider = "auto"

    # ── 1) edge-tts primary
    if _provider in ("auto", "edge"):
        _edge_first = await _try_synthesize_edge_tts_response(
            text, tts_rate, tts_pitch, ar_voice_name, t_start, background_tasks, failure_notes,
        )
        if _edge_first is not None:
            return _finalize_tts_success(_edge_first)

    # ── 2) Azure Speech SDK
    if _azure_ok and _provider in ("azure", "auto", "edge") and _azure_cb_ok():
        try:
            wav_bytes, word_timings, viseme_events, timing_approx = \
                await _synthesize_azure_chunked(text=text, key=_azure_key, region=_azure_region, voice=_azure_voice, emotion=(payload.emotion or 'neutral'))
            _azure_cb_record_success()
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            t_mode = "approx" if timing_approx else "native"
            _obs_log("azure", "wav", t_mode, len(wav_bytes), len(word_timings), len(viseme_events))
            _resp = TTSResponse(
                audio_base64=b64, audio_wav_base64=b64, audio_mp3_base64=None,
                word_timings=word_timings, viseme_events=viseme_events,
                sample_rate=24000, format="wav", timing_mode=t_mode, provider="azure", voice=_azure_voice,
            )
            if _store is not None:
                background_tasks.add_task(_store.append_from_response, text, _resp.provider, _resp.timing_mode, _resp.sample_rate, _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events, int((time.monotonic() - t_start) * 1000))
            return _finalize_tts_success(_resp)
        except Exception as e:
            _azure_cb_record_failure()
            _ak, _ad = _classify_tts_exception(e)
            failure_notes.append(f"azure:{_ak}:{_ad}")
            logger.error("[TTS][azure] synthesis failed — kind=%s type=%s detail=%s", _ak, type(e).__name__, _ad)

            err_s = str(e).lower()
            _auth = is_azure_tts_auth_failure(e)
            _hard = bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False))

            if _auth:
                logger.warning("Azure auth error — falling back (%s)", e)
            elif "429" in err_s or "too many requests" in err_s or "rate limit" in err_s:
                if getattr(settings, "TTS_AZURE_429_FALLBACK_EDGE", True) and not _hard:
                    logger.warning("Azure rate limited — falling back to edge-tts")
                elif _hard:
                    raise HTTPException(status_code=503, detail="Azure Speech rate limited.") from e
            elif _hard:
                raise HTTPException(status_code=503, detail=f"Azure TTS failed; fallbacks disabled: {e!s}") from e

    elif _azure_ok and not _azure_cb_ok():
        if bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
            raise HTTPException(status_code=503, detail="Azure TTS circuit open; edge/gTTS fallback disabled.")

    # ── 2b) Azure-only fallback to edge
    if _provider == "azure" and not bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
        _edge_fb = await _try_synthesize_edge_tts_response(
            text, tts_rate, tts_pitch, ar_voice_name, t_start, background_tasks, failure_notes,
        )
        if _edge_fb is not None:
            return _finalize_tts_success(_edge_fb)

    # ── 3) Kokoro (non-Arabic)
    if is_available() and _provider not in ("edge", "gtts", "habibi"):
        try:
            result = await synthesize_with_timing(text=text, voice=payload.voice or "am_michael", speed=payload.speed or 1.0)
            if result is not None:
                audio_bytes, wt = result
                b64 = base64.b64encode(audio_bytes).decode("ascii")
                _obs_log("kokoro", "pcm", "real", len(audio_bytes), len(wt), 0)
                _resp = TTSResponse(
                    audio_base64=b64, audio_wav_base64=None, audio_mp3_base64=None,
                    word_timings=wt, viseme_events=[], sample_rate=24000,
                    format="pcm", timing_mode="real", provider="kokoro",
                )
                if _store is not None:
                    background_tasks.add_task(_store.append_from_response, text, _resp.provider, _resp.timing_mode, _resp.sample_rate, _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events, int((time.monotonic() - t_start) * 1000))
                return _finalize_tts_success(_resp)
        except Exception as e:
            logger.error("[TTS][kokoro] failed: %s", e)

    # ── 4) Last-chance edge
    if _provider in ("auto", "edge", "azure", "kokoro") and not bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
        _edge_last = await _try_synthesize_edge_tts_response(
            text, tts_rate, tts_pitch, ar_voice_name, t_start, background_tasks, failure_notes,
        )
        if _edge_last is not None:
            return _finalize_tts_success(_edge_last)

    # ── 4.5) Habibi after cloud exhaustion (skip if already tried as primary)
    if _is_arabic_script(text) and synthesize_habibi_tts is not None and not habibi_primary_attempted:
        logger.warning("[TTS] Cloud engines exhausted — trying Habibi-TTS (sovereign fallback).")
        wav_fb = await _run_habibi_executor(text)
        if wav_fb:
            _hb2 = _build_habibi_tts_response(wav_fb, text, t_start, background_tasks, _obs_log)
            return _finalize_tts_success(_hb2)
        failure_notes.append("habibi:fallback:none")

    # ── 5) gTTS Arabic (gated by optional consecutive-failure streak)
    if _is_arabic_script(text):
        _gtts_ar_on = _effective_allow_gtts_arabic()
        min_fail = _gtts_arabic_min_streak_required()
        cur = _ar_tts_failure_streak_value()

        if _gtts_ar_on and min_fail > 0 and cur < min_fail:
            ns = _ar_tts_failure_streak_bump()
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Arabic TTS failed; gTTS catastrophe gate active (need {min_fail} consecutive failures, "
                    f"now {ns}). Set TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES=0 to disable. "
                    f"Failures: {'; '.join(failure_notes) if failure_notes else '(none)'}"
                )[:1200],
            )

        if _gtts_ar_on:
            logger.warning("Arabic gTTS fallback — MSA (TTS_ALLOW_GTTS_ARABIC_FALLBACK)")
            try:
                loop = asyncio.get_event_loop()
                mp3_ar = await asyncio.wait_for(
                    loop.run_in_executor(None, _synthesize_gtts_sync, text, "ar"),
                    timeout=20.0,
                )
                return _finalize_tts_success(
                    await _gtts_mp3_to_response(mp3_ar, text, t_start, background_tasks),
                )
            except Exception as _gae:
                _gk, _gd = _classify_tts_exception(_gae)
                failure_notes.append(f"gtts-arabic:{_gk}:{_gd}")
                logger.error("[TTS][gtts-arabic] failed: %s", _gd)

        ns = _ar_tts_failure_streak_bump()
        _hint = (
            f"Arabic TTS failed (consecutive_failure_streak={ns}). "
            f"edge/Azure/Habibi/gTTS. Failures: {'; '.join(failure_notes) if failure_notes else '(none)'}"
        )
        raise HTTPException(status_code=503, detail=_hint[:1200])

    # ── 6) gTTS Latin last resort ──
    try:
        loop = asyncio.get_event_loop()
        mp3_bytes = await asyncio.wait_for(
            loop.run_in_executor(None, _synthesize_gtts_sync, text, "en"),
            timeout=20.0,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail="TTS unavailable: all engines failed.") from e

    return _finalize_tts_success(
        await _gtts_mp3_to_response(mp3_bytes, text, t_start, background_tasks),
    )