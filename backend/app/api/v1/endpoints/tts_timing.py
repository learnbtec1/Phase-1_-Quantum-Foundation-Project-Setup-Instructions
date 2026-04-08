# -*- coding: utf-8 -*-
"""
TTS-with-timing endpoint: POST /api/v1/tts-with-timing
Synthesize speech with word-level timing for lip-sync and viseme events.

Priority chain (default TTS_PRIMARY_PROVIDER=edge):
  1. edge-tts (Microsoft Edge online, ar-JO-TaimNeural + fallbacks) — REAL word-boundary + viseme events, no Azure key
  2. Azure Speech SDK — NATIVE viseme + word timings when credentials work (or when TTS_PRIMARY_PROVIDER=azure)
  3. Kokoro TTS (local, PCM) — best for non-Arabic
  4. gTTS — last resort for **non-Arabic** text only (Arabic skips gTTS for dialect consistency)

Hardening (v2):
  - Circuit-breaker on Azure (3 failures → 60 s cooldown)
  - In-memory rate-limit: 3 req/s per client IP
  - Text chunking: ≤ 800 chars/chunk with merged WAV + timing offsets
  - ffmpeg MP3→WAV conversion available when edge-tts is active fallback
  - Unified response schema: audio_wav_base64 / audio_mp3_base64 always present
  - timing_mode: "native" | "real" | "approx"  ("approx" covers estimated/duration-based)
  - Structured observability log per request
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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, get_teacher_user
from app.api.v1.dependencies.phase2_gates import gate_tts_user
from app.core.config import settings
from app.models.db_models import User
from app.services.kokoro_tts import is_available, synthesize_with_timing
from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts
from app.services.tts_service import (
    DEFAULT_EDGE_TTS_PROSODY as _DEFAULT_PROSODY,
    EDGE_TTS_EMOTION_PROSODY as _EMOTION_PROSODY,
    _locked_jordanian_male_voice,
    _prepare_tts_text,
    _xml_escape,
    is_azure_tts_auth_failure,
    synthesize_edge_tts_mp3,
)
from app.services.conversation_store import get_store as _get_store

# Module-level ConversationStore singleton (lazy — harmless if import fails)
try:
    _store = _get_store()
except Exception as _store_exc:  # pragma: no cover
    import logging as _log
    _log.getLogger(__name__).warning("ConversationStore init failed: %s", _store_exc)
    _store = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Circuit-breaker — Azure TTS
# ─────────────────────────────────────────────────────────────────────────────
_CB_LOCK            = Lock()
_cb_failures:   int = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD   = 5      # consecutive failures before opening (raised from 3)
_CB_COOLDOWN    = 20.0   # seconds to stay open (lowered from 60 so recovery is faster)


def _azure_cb_ok() -> bool:
    """Return True when the circuit is closed (Azure calls allowed)."""
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
# Rate-limiter — sliding window (3 req/s per IP, no extra dependency)
# ─────────────────────────────────────────────────────────────────────────────
_RL_LOCK  = Lock()
_rl_store: Dict[str, deque] = {}
_RL_WINDOW = 1.0   # seconds
_RL_MAX    = 3     # requests per window


def _rate_limit_ok(ip: str) -> bool:
    """Return True when the request is within the allowed rate."""
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
# Text chunking — split at sentence boundaries, max 800 chars/chunk
# ─────────────────────────────────────────────────────────────────────────────
_MAX_CHUNK = 800
_SENT_SPLIT = re.compile(r'(?<=[.!?؟،,;،\u060c])\s+')


def _chunk_text(text: str) -> List[str]:
    """Split text into ≤ _MAX_CHUNK-char chunks on sentence boundaries."""
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
            # Hard-split parts that exceed the chunk size on their own
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
# WAV helpers — merge + duration
# ─────────────────────────────────────────────────────────────────────────────

def _wav_duration_ms(wav_bytes: bytes) -> float:
    """Return duration of a 24 kHz 16-bit mono WAV in milliseconds."""
    pcm_bytes = max(0, len(wav_bytes) - 44)
    return pcm_bytes / (24_000 * 2) * 1_000


def _merge_wav_chunks(wav_list: List[bytes]) -> bytes:
    """Concatenate multiple 24 kHz 16-bit mono WAV blobs into one WAV blob."""
    pcm = b"".join(w[44:] for w in wav_list)
    data_size = len(pcm)
    header = bytearray(44)
    header[0:4]  = b'RIFF'
    struct.pack_into('<I', header, 4,  36 + data_size)
    header[8:12]  = b'WAVE'
    header[12:16] = b'fmt '
    struct.pack_into('<I', header, 16, 16)
    struct.pack_into('<H', header, 20, 1)       # PCM
    struct.pack_into('<H', header, 22, 1)       # mono
    struct.pack_into('<I', header, 24, 24_000)  # sample rate
    struct.pack_into('<I', header, 28, 48_000)  # byte rate
    struct.pack_into('<H', header, 32, 2)       # block align
    struct.pack_into('<H', header, 34, 16)      # bits per sample
    header[36:40] = b'data'
    struct.pack_into('<I', header, 40, data_size)
    return bytes(header) + pcm


# ─────────────────────────────────────────────────────────────────────────────
# ffmpeg MP3 → WAV converter (secondary fallback, best-effort)
# ─────────────────────────────────────────────────────────────────────────────

def _mp3_to_wav_ffmpeg(mp3_bytes: bytes) -> Optional[bytes]:
    """Convert MP3 bytes → 24 kHz 16-bit mono WAV using ffmpeg subprocess.

    Returns *None* when ffmpeg is not available or conversion fails — the
    caller should then fall back to returning the original MP3 data.
    """
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

# ── Lightweight counters for ops (GET /api/v1/tts-observability) ─────────────
_OBS_LOCK = Lock()
_tts_obs_counters: Dict[str, int] = {
    "requests_total": 0,
    "success_edge": 0,
    "success_azure": 0,
    "success_kokoro": 0,
    "success_gtts": 0,
    "errors_rate_limited": 0,
}


def _tts_obs_inc(key: str) -> None:
    with _OBS_LOCK:
        _tts_obs_counters[key] = _tts_obs_counters.get(key, 0) + 1


@router.get("/tts-observability")
async def tts_observability(_auth: User = Depends(get_current_user)):
    """TTS path counters + Azure circuit state (no secrets). Poll for dashboards/alerts."""
    with _OBS_LOCK:
        snap = dict(_tts_obs_counters)
    with _CB_LOCK:
        cb = {
            "failures": _cb_failures,
            "open_until_monotonic": _cb_open_until,
            "circuit_closed": _azure_cb_ok(),
        }
    return {"ok": True, "counters": snap, "azure_circuit": cb}


# ─────────────────────────────────────────────────────────────────────────────
# Azure Speech SDK — Priority 1: native WAV 24k + native viseme/word timings
# ─────────────────────────────────────────────────────────────────────────────

# ── Jordanian SSML helpers (shared with WebSocket path) ─────────────────────
_RE_EN_TOKEN  = re.compile(r'([A-Za-z][A-Za-z0-9]*(?:[/-][A-Za-z0-9]+)*)')
_RE_ACRONYM   = re.compile(r'^[A-Z][A-Z0-9]{1,}$')
_RE_SENT_BOUN = re.compile(r'([.،؟!؟\n]+)\s*')

# Emotion → (styledegree, rate_pct, pitch)
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



def _render_tts_segment(kind: str, content: str) -> str:
    safe = _xml_escape(content)
    if kind == 'ar':
        return safe
    if _RE_ACRONYM.match(content):
        return f'<lang xml:lang="en-GB"><say-as interpret-as="spell-out">{safe}</say-as></lang>'
    return f'<lang xml:lang="en-GB">{safe}</lang>'


def _build_azure_ssml(text: str, voice: str, emotion: str = 'neutral') -> str:
    """
    Build production-quality Jordanian SSML for Azure Neural TTS.
    - mstts:express-as style="friendly" (natural JO persona, never falls back to MSA style)
    - Emotion-aware rate/styledegree/pitch
    - English acronyms (PESTLE, SWOT…) spelled letter-by-letter in en-GB
    - Other English words rendered in en-GB phonetics
    - Sentence-boundary breath pauses (200-320 ms)
    """
    cleaned, _slots = _prepare_tts_text((text or "").strip())
    if not cleaned:
        cleaned = "."
    text = cleaned

    # Derive xml:lang from the voice name (e.g. ar-JO-TaimNeural → ar-JO)
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
        # Build inner markup for this clause
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
                parts.append(f'<prosody pitch="+8%">{inner}{_xml_escape(punct)}</prosody>')
            else:
                parts.append(inner + (_xml_escape(punct) if punct else ''))
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
    """Synchronous Azure TTS call.

    Returns ``(wav_bytes, word_timings, viseme_events, timing_is_approx)``.
    ``timing_is_approx=True`` when native word-boundary events did not fire and
    duration-proportional estimates were used instead.

    Uses speak_ssml_async (not speak_text_async) so that synthesis_word_boundary
    events fire correctly for Arabic neural voices.
    """
    import azure.cognitiveservices.speech as speechsdk

    voice = _locked_jordanian_male_voice(voice)

    speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
    )

    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config, audio_config=None
    )

    visemes: List[Dict[str, Any]] = []
    words: List[Dict[str, Any]] = []

    def _on_viseme(evt: speechsdk.SpeechSynthesisVisemeEventArgs) -> None:
        # audio_offset is in 100-nanosecond units → convert to ms
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

    # SSML input is required for synthesis_word_boundary to fire on Arabic voices
    ssml = _build_azure_ssml(text, voice, emotion=emotion)
    result = synthesizer.speak_ssml_async(ssml).get()

    synthesizer.viseme_received.disconnect_all()
    synthesizer.synthesis_word_boundary.disconnect_all()

    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        if result.reason == speechsdk.ResultReason.Canceled:
            details = speechsdk.SpeechSynthesisCancellationDetails(result)
            raise RuntimeError(
                f"Azure TTS canceled: {details.reason.name} / {details.error_details}"
            )
        raise RuntimeError(f"Azure TTS failed: reason={result.reason}")

    wav_bytes = result.audio_data

    # ar-SA-HamedNeural (and some other neural voices) never fires
    # synthesis_word_boundary events. Fall back to duration-proportional estimates
    # using the actual WAV length so timing is accurate.
    timing_approx = False
    if not words and wav_bytes:
        # WAV header = 44 bytes; PCM at 24 kHz, 16-bit mono = 2 bytes/sample
        pcm_bytes = max(0, len(wav_bytes) - 44)
        total_ms = pcm_bytes / (24_000 * 2) * 1_000
        word_list = [w for w in text.split() if w.strip()]
        if word_list and total_ms > 0:
            step = total_ms / len(word_list)
            words = [
                {
                    "word": w,
                    "start_time": round(i * step, 2),
                    "end_time": round((i + 1) * step, 2),
                }
                for i, w in enumerate(word_list)
            ]
            timing_approx = True

    return wav_bytes, words, visemes, timing_approx


async def _synthesize_azure(
    text: str,
    key: str,
    region: str,
    voice: str,
    emotion: str = 'neutral',
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    """Async wrapper — runs the blocking SDK call in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _synthesize_azure_sync, text, key, region, voice, emotion
    )


# ── Edge → TTSResponse (shared by primary edge path and Azure fallback) ─────
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
            "TTS provider=%-8s format=%-3s timing=%-6s "
            "latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
            "edge-tts", "wav", "real",
            ms, len(wav_from_ffmpeg) / 1024, len(word_timings), len(viseme_events),
        )
        _resp = TTSResponse(
            audio_base64=b64,
            audio_wav_base64=b64,
            audio_mp3_base64=None,
            word_timings=word_timings,
            viseme_events=viseme_events,
            sample_rate=24000,
            format="wav",
            timing_mode="real",
            provider="edge-tts",
            voice=voice_label,
        )
        if _store is not None:
            background_tasks.add_task(
                _store.append_from_response,
                text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
                _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
                int((time.monotonic() - t_start) * 1000),
            )
        _tts_obs_inc("success_edge")
        return _resp
    b64 = base64.b64encode(mp3_bytes).decode("ascii")
    ms = int((time.monotonic() - t_start) * 1000)
    logger.info(
        "TTS provider=%-8s format=%-3s timing=%-6s "
        "latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
        "edge-tts", "mp3", "real",
        ms, len(mp3_bytes) / 1024, len(word_timings), len(viseme_events),
    )
    _resp = TTSResponse(
        audio_base64=b64,
        audio_wav_base64=None,
        audio_mp3_base64=b64,
        word_timings=word_timings,
        viseme_events=viseme_events,
        sample_rate=24000,
        format="mp3",
        timing_mode="real",
        provider="edge-tts",
        voice=voice_label,
    )
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response,
            text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
            _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
            int((time.monotonic() - t_start) * 1000),
        )
    _tts_obs_inc("success_edge")
    return _resp


async def _try_synthesize_edge_tts_response(
    text: str,
    tts_rate: str,
    tts_pitch: str,
    ar_voice_name: str,
    t_start: float,
    background_tasks: BackgroundTasks,
) -> Optional[TTSResponse]:
    try:
        mp3_bytes, word_timings, viseme_events = await asyncio.wait_for(
            synthesize_edge_tts_mp3(
                text,
                rate=tts_rate,
                pitch=tts_pitch,
                voice=ar_voice_name,
            ),
            timeout=25.0,
        )
    except Exception as e:
        logger.warning("[tutor] edge-tts failed: %s", e)
        return None
    return await _edge_mp3_to_tts_response(
        mp3_bytes,
        word_timings,
        viseme_events,
        t_start=t_start,
        text=text,
        background_tasks=background_tasks,
        voice_label=ar_voice_name,
    )


# ── gTTS last-resort fallback ─────────────────────────────────────────────────
def _synthesize_gtts_sync(text: str) -> bytes:
    from gtts import gTTS
    buf = io.BytesIO()
    gTTS(text=text, lang="ar", slow=False).write_to_fp(buf)
    return buf.getvalue()


def _estimate_word_timings(text: str, ms_per_word: float = 350.0) -> List[Dict[str, Any]]:
    words = text.split()
    return [
        {"word": w, "start_time": i * ms_per_word, "end_time": (i + 1) * ms_per_word}
        for i, w in enumerate(words)
    ]


# ── Pydantic models ────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text:     str            = Field(..., min_length=1, max_length=2000)
    voice:    Optional[str]  = Field(default="am_michael")
    speed:    Optional[float]= Field(default=1.0, ge=0.25, le=4.0)
    emotion:  Optional[str]  = Field(default="neutral")
    pitch:    Optional[str]  = Field(default=None)   # explicit Hz override e.g. "+5Hz"
    ar_voice: Optional[str]  = Field(default=None)   # voice override: "male" | "female" | full voice name
    # Allow callers to force a specific provider for this request
    provider: Optional[str]  = Field(default=None)   # "azure" | "edge" | "kokoro"
    language: Optional[str]  = Field(default=None)   # e.g. "ar-SA"
    format:   Optional[str]  = Field(default="wav")
    sample_rate: Optional[int] = Field(default=24000)
    with_timing: Optional[bool] = Field(default=True)


class TTSResponse(BaseModel):
    # ── Audio payloads ─────────────────────────────────────────────────────────
    # audio_base64 is always populated (backwards compatibility).
    # audio_wav_base64  populated when format="wav" (Azure / ffmpeg paths).
    # audio_mp3_base64  populated when format="mp3" (edge-tts / gTTS paths).
    # One of the two format-specific fields is always non-null.
    audio_base64:     str
    audio_wav_base64: Optional[str] = None
    audio_mp3_base64: Optional[str] = None
    # ── Timing data (always present, may be empty list) ────────────────────────
    word_timings:   List[Dict[str, Any]] = []
    viseme_events:  List[Dict[str, Any]] = []
    # ── Metadata ───────────────────────────────────────────────────────────────
    sample_rate:  int = 24000
    format:       str = "wav"            # "wav" | "mp3" | "pcm"
    timing_mode:  str = "approx"         # "native" (Azure events) | "real" (edge-tts) | "approx" (estimated/duration)
    provider:     Optional[str] = None   # "azure" | "edge-tts" | "kokoro" | "gtts"
    voice:        Optional[str] = None   # e.g. "ar-JO-TaimNeural" (male) or "ar-JO-SanaNeural" (female)


# ── Multi-chunk Azure synthesis ────────────────────────────────────────────────

async def _synthesize_azure_chunked(
    text: str,
    key: str,
    region: str,
    voice: str,
    emotion: str = 'neutral',
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    """Synthesize text that may exceed _MAX_CHUNK chars.

    Splits into chunks, synthesizes each, then merges WAV bytes with
    properly offset word/viseme timings.
    """
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
            all_words.append({**w, "start_time": w["start_time"] + offset_ms,
                                    "end_time":   w["end_time"]   + offset_ms})
        for v in vis:
            all_vis.append({**v, "offset_ms": v["offset_ms"] + offset_ms})
        if approx:
            any_approx = True
        offset_ms += _wav_duration_ms(wav)

    return _merge_wav_chunks(wav_list), all_words, all_vis, any_approx


# ── Circuit-breaker reset endpoint ───────────────────────────────────────────
@router.post("/tts-reset-circuit")
async def tts_reset_circuit(_auth: User = Depends(get_teacher_user)):
    """Reset the Azure TTS circuit breaker (useful after a transient failure)."""
    _azure_cb_record_success()
    return {"ok": True, "message": "Azure TTS circuit breaker reset"}


# ── Main endpoint ──────────────────────────────────────────────────────────────
@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(
    payload: TTSRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: User = Depends(gate_tts_user),
):
    """
    Synthesize text to speech with word-level timing and viseme events for lip-sync.

    Priority: edge-tts (default) → Azure SDK → Kokoro → last-chance edge (auto) → gTTS (non-Arabic only)

    Hardening:
      - Rate-limited: 3 req/s per authenticated user id (burst) + hourly cap in gate_tts_user
      - Texts > 800 chars are auto-chunked with merged timings
      - Azure circuit-breaker: opens after 3 consecutive failures, recovers after 60 s
      - Observability: structured log per request (latency, size, visemes, words, provider)
    """
    text = (payload.text or "").strip()
    text = maybe_correct_egyptian_for_tts(text, context="tts_with_timing")
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # ── Burst rate limit (per user id; hourly quota enforced in gate_tts_user) ─
    if not _rate_limit_ok(str(user.id)):
        _tts_obs_inc("errors_rate_limited")
        raise HTTPException(status_code=429, detail="Rate limit exceeded (3 req/s per user)")

    _tts_obs_inc("requests_total")
    t_start = time.monotonic()

    # Resolve prosody from emotion (or use explicit pitch override)
    prosody = _EMOTION_PROSODY.get(
        (payload.emotion or 'neutral').lower(),
        _DEFAULT_PROSODY,
    )
    tts_rate  = prosody['rate']
    tts_pitch = payload.pitch if payload.pitch else prosody['pitch']

    # Cogni: always male Jordanian neural (ar-JO-TaimNeural); ignore female / alternate requests
    _ar_voice_req = (payload.ar_voice or "").strip().lower()
    if _ar_voice_req == "female":
        logger.warning("tts-with-timing: ar_voice=female ignored — Cogni locked to male Jordanian TTS")
    ar_voice_name = _locked_jordanian_male_voice(payload.ar_voice or settings.TTS_ARABIC_VOICE)

    # Determine requested provider (payload > env TTS_PROVIDER, default auto → edge-first in code below)
    _provider = (payload.provider or os.getenv("TTS_PROVIDER", "auto")).lower().strip()
    _azure_key    = settings.AZURE_SPEECH_KEY
    _azure_region = settings.AZURE_SPEECH_REGION
    _azure_voice = (
        payload.voice if payload.voice and payload.voice not in ("am_michael",)
        else os.getenv("TTS_VOICE", settings.TTS_ARABIC_VOICE)
    )
    _azure_voice = _locked_jordanian_male_voice(_azure_voice)
    _azure_ok = bool(_azure_key and _azure_region)

    def _obs_log(provider: str, fmt: str, mode: str,
                 wav_b: int, words_n: int, vis_n: int) -> None:
        ms = int((time.monotonic() - t_start) * 1000)
        logger.info(
            "TTS provider=%-8s format=%-3s timing=%-6s "
            "latency_ms=%d wav_kb=%.1f words=%d visemes=%d",
            provider, fmt, mode,
            ms, wav_b / 1024, words_n, vis_n,
        )

    # ── 1) edge-tts primary for auto/edge (same neural voice names; no Azure subscription)
    if _provider in ("auto", "edge"):
        _edge_first = await _try_synthesize_edge_tts_response(
            text,
            tts_rate,
            tts_pitch,
            ar_voice_name,
            t_start,
            background_tasks,
        )
        if _edge_first is not None:
            return _edge_first

    # ── 2) Azure Speech SDK (native WAV 24k + native viseme/word timings) ────
    if _azure_ok and _provider in ("azure", "auto", "edge") and _azure_cb_ok():
        try:
            wav_bytes, word_timings, viseme_events, timing_approx = \
                await _synthesize_azure_chunked(
                    text=text,
                    key=_azure_key,
                    region=_azure_region,
                    voice=_azure_voice,
                    emotion=(payload.emotion or 'neutral'),
                )
            _azure_cb_record_success()
            b64 = base64.b64encode(wav_bytes).decode("ascii")
            t_mode = "approx" if timing_approx else "native"
            _obs_log("azure", "wav", t_mode, len(wav_bytes),
                     len(word_timings), len(viseme_events))
            _resp = TTSResponse(
                audio_base64=b64,
                audio_wav_base64=b64,
                audio_mp3_base64=None,
                word_timings=word_timings,
                viseme_events=viseme_events,
                sample_rate=24000,
                format="wav",
                timing_mode=t_mode,
                provider="azure",
                voice=_azure_voice,
            )
            if _store is not None:
                background_tasks.add_task(
                    _store.append_from_response,
                    text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
                    _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
                    int((time.monotonic() - t_start) * 1000),
                )
            _tts_obs_inc("success_azure")
            return _resp
        except Exception as e:
            _azure_cb_record_failure()
            err_s = str(e).lower()
            _auth = is_azure_tts_auth_failure(e)
            _hard = bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False))

            if _auth:
                logger.warning(
                    "Azure TTS authentication/authorization error — falling back to edge-tts/gTTS (%s)",
                    e,
                )
            elif "429" in err_s or "too many requests" in err_s or "rate limit" in err_s:
                _fb429 = bool(getattr(settings, "TTS_AZURE_429_FALLBACK_EDGE", False))
                if _fb429 and not _hard:
                    logger.warning(
                        "Azure TTS rate limited — TTS_AZURE_429_FALLBACK_EDGE=1, falling back to edge-tts"
                    )
                elif _hard:
                    logger.warning(
                        "Azure TTS rate limited — HTTP 503 (TTS_DISABLE_NON_AZURE_FALLBACK=true)"
                    )
                    raise HTTPException(
                        status_code=503,
                        detail="Azure Speech rate limited. Retry after a few seconds; avatar WebSocket uses the same Azure voice only.",
                    ) from e
                else:
                    logger.warning(
                        "Azure TTS rate limited — falling back to edge-tts (TTS_AZURE_429_FALLBACK_EDGE unset)"
                    )
            elif _hard:
                logger.warning(
                    "Azure TTS failed and TTS_DISABLE_NON_AZURE_FALLBACK is set — no edge/gTTS fallback (%s)",
                    e,
                )
                raise HTTPException(
                    status_code=503,
                    detail=f"Azure TTS failed; secondary engines disabled: {e!s}",
                ) from e
            else:
                logger.warning("Azure TTS failed (%s), falling back to next engine", e)
    elif _azure_ok and not _azure_cb_ok():
        _hard_cb = bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False))
        if _hard_cb:
            raise HTTPException(
                status_code=503,
                detail="Azure TTS circuit open; edge/gTTS fallback disabled.",
            )
        logger.info("Azure TTS circuit OPEN — skipping, using fallback")

    # ── 2b) Request was Azure-only: try edge if fallbacks are allowed (circuit open, soft errors, etc.)
    if _provider == "azure" and not bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
        _edge_fb = await _try_synthesize_edge_tts_response(
            text,
            tts_rate,
            tts_pitch,
            ar_voice_name,
            t_start,
            background_tasks,
        )
        if _edge_fb is not None:
            return _edge_fb

    # ── 3) Kokoro (non-Arabic local model) ────────────────────────────────────
    if is_available() and _provider not in ("edge", "gtts"):
        result = await synthesize_with_timing(
            text=text,
            voice=payload.voice or "am_michael",
            speed=payload.speed or 1.0,
        )
        if result is not None:
            audio_bytes, wt = result
            b64 = base64.b64encode(audio_bytes).decode("ascii")
            _obs_log("kokoro", "pcm", "real", len(audio_bytes), len(wt), 0)
            _resp = TTSResponse(
                audio_base64=b64,
                audio_wav_base64=None,
                audio_mp3_base64=None,
                word_timings=wt,
                viseme_events=[],
                sample_rate=24000,
                format="pcm",
                timing_mode="real",
                provider="kokoro",
            )
            if _store is not None:
                background_tasks.add_task(
                    _store.append_from_response,
                    text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
                    _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
                    int((time.monotonic() - t_start) * 1000),
                )
            _tts_obs_inc("success_kokoro")
            return _resp
        logger.info("Kokoro returned None (Arabic text) — trying edge-tts again if allowed")

    # ── 4) Last-chance edge for auto/edge (first edge failed, Azure/Kokoro did not return audio)
    if _provider in ("auto", "edge") and not bool(getattr(settings, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
        _edge_last = await _try_synthesize_edge_tts_response(
            text,
            tts_rate,
            tts_pitch,
            ar_voice_name,
            t_start,
            background_tasks,
        )
        if _edge_last is not None:
            return _edge_last

    # Arabic must not use gTTS: wrong prosody/accent vs ar-JO neural chain; Cogni policy = Jordanian only.
    if re.search(r"[\u0600-\u06FF]", text):
        raise HTTPException(
            status_code=503,
            detail="Arabic TTS failed: edge-tts and Azure unavailable. Check network or set AZURE_SPEECH_*; ensure TTS_DISABLE_NON_AZURE_FALLBACK=false.",
        )

    # ── 5) gTTS last resort (approx timings, no visemes) — Latin/non-Arabic only ─
    try:
        loop = asyncio.get_event_loop()
        mp3_bytes = await asyncio.wait_for(
            loop.run_in_executor(None, _synthesize_gtts_sync, text),
            timeout=20.0,  # gTTS makes blocking HTTP calls; cap at 20 s
        )
    except asyncio.TimeoutError as e:
        logger.exception("gTTS fallback timed out after 20 s")
        raise HTTPException(
            status_code=503,
            detail="TTS unavailable: all engines failed (gTTS timeout)",
        ) from e
    except Exception as e:
        logger.exception("gTTS fallback also failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"TTS unavailable: all engines failed ({e!s})",
        )

    word_timings = _estimate_word_timings(text)
    # Try to give a WAV even from gTTS
    wav_from_ffmpeg = await asyncio.get_event_loop().run_in_executor(
        None, _mp3_to_wav_ffmpeg, mp3_bytes
    )
    if wav_from_ffmpeg:
        b64 = base64.b64encode(wav_from_ffmpeg).decode("ascii")
        _obs_log("gtts", "wav", "approx", len(wav_from_ffmpeg), len(word_timings), 0)
        _resp = TTSResponse(
            audio_base64=b64,
            audio_wav_base64=b64,
            audio_mp3_base64=None,
            word_timings=word_timings,
            viseme_events=[],
            sample_rate=24000,
            format="wav",
            timing_mode="approx",
            provider="gtts",
        )
        if _store is not None:
            background_tasks.add_task(
                _store.append_from_response,
                text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
                _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
                int((time.monotonic() - t_start) * 1000),
            )
        _tts_obs_inc("success_gtts")
        return _resp
    b64 = base64.b64encode(mp3_bytes).decode("ascii")
    _obs_log("gtts", "mp3", "approx", len(mp3_bytes), len(word_timings), 0)
    _resp = TTSResponse(
        audio_base64=b64,
        audio_wav_base64=None,
        audio_mp3_base64=b64,
        word_timings=word_timings,
        viseme_events=[],
        sample_rate=24000,
        format="mp3",
        timing_mode="approx",
        provider="gtts",
    )
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response,
            text, _resp.provider, _resp.timing_mode, _resp.sample_rate,
            _resp.audio_wav_base64, _resp.word_timings, _resp.viseme_events,
            int((time.monotonic() - t_start) * 1000),
        )
    _tts_obs_inc("success_gtts")
    return _resp
