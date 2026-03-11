# -*- coding: utf-8 -*-
"""
TTS-with-timing endpoint: POST /api/v1/tts-with-timing
Synthesize speech with word-level timing for lip-sync and viseme events.

Priority chain:
  1. Kokoro TTS (local, PCM) — best for non-Arabic
  2. edge-tts streaming (ar-JO-TaimNeural) — REAL word-boundary timing + viseme events
  3. gTTS Arabic — last resort (estimated timings only)
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Tuple

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.services.kokoro_tts import is_available, synthesize_with_timing

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Arabic character → Azure-compatible viseme ID ────────────────────────────
# IDs follow Microsoft's viseme spec (0=silence, 1-21 = phoneme groups).
# Each Arabic letter maps to the closest English phoneme group.
_ARABIC_VISEME: Dict[str, int] = {
    'ا': 2,  'أ': 2,  'إ': 2,  'آ': 2,   # aleph  → open (ɑ)
    'ب': 21, 'پ': 21,                      # ba/pa  → p/b/m
    'ت': 19, 'ط': 19,                      # ta/tta → d/t/n
    'ث': 17,                                # tha    → ð/θ
    'ج': 16,                                # jeem   → ʃ/dʒ
    'ح': 12, 'ه': 12,                      # ha     → h
    'خ': 20, 'غ': 20, 'ق': 20, 'ك': 20,  # kha/qa → k/g
    'د': 19, 'ض': 19,                      # dal    → d
    'ذ': 17, 'ظ': 17,                      # dhal   → ð
    'ر': 13,                                # ra     → ɹ
    'ز': 15, 'س': 15, 'ص': 15,            # za/sa  → s/z
    'ش': 16,                                # shin   → ʃ
    'ع': 2,                                 # ain    → open vowel
    'ف': 18,                                # fa     → f/v
    'ل': 14,                                # lam    → l
    'م': 21,                                # mim    → p/b/m
    'ن': 19,                                # nun    → d/t/n
    'و': 7,                                 # waw    → w/u (rounded)
    'ي': 6,  'ى': 6,                       # ya     → j/i
    'ة': 19,                                # ta marbuta → t
    'ء': 1,                                 # hamza  → slight opening
}

def _word_first_viseme(word: str) -> int:
    """Return the viseme ID for the first meaningful character of a word."""
    for ch in word:
        if ch in _ARABIC_VISEME:
            return _ARABIC_VISEME[ch]
        # Latin / digits — rough mapping
        if ch.isalpha():
            return 1  # neutral opening
    return 0  # silence / punctuation


# ════════════════════════════════════════════════════════════════════════════
# تعريفات اللهجة الأردنية — Jordanian Arabic Dialect Voice Profile
# ════════════════════════════════════════════════════════════════════════════
#
# الصوت الذكوري  : ar-JO-TaimNeural   → شخصية د. حمزة
# الصوت الأنثوي : ar-JO-SanaNeural   → شخصية فورينا
#
# خصائص اللهجة الأردنية في edge-tts:
#   • rate  : إزاحة النسبة المئوية عن الإيقاع الطبيعي للصوت  (e.g. '+5%', '-10%')
#   • pitch : إزاحة طبقة الصوت بوحدة Hz  (e.g. '+4Hz', '-6Hz')
#
# جدول المشاعر الستة للمدرّس (tutor emotions) + مشاعر موسّعة:
#   neutral     — رزين هادئ         → إيقاع طبيعي
#   friendly    — ودود دافئ          → أسرع قليلاً + طبقة أعلى
#   thinking    — متأمّل متمهّل       → أبطأ + طبقة أخفض
#   encouraging — تشجيعي حماسي       → أسرع + طبقة أعلى
#   strict      — حازم رسمي          → أبطأ + طبقة أخفض
#   celebrate   — احتفالي فرحاني     → أسرع بكثير + طبقة أعلى بكثير
# ════════════════════════════════════════════════════════════════════════════

# الأصوات الأردنية — مصدرها الإعدادات (قابلة للتغيير عبر .env)
EDGE_TTS_ARABIC_MALE   = settings.TTS_ARABIC_VOICE          # ar-JO-TaimNeural
EDGE_TTS_ARABIC_FEMALE = settings.TTS_ARABIC_VOICE_FEMALE   # ar-JO-SanaNeural

# ── بروفايل اللهجة الأردنية: المشاعر الستة الأساسية + مشاعر موسّعة ──────────
# rate/pitch مُعايَرة خصيصاً لصوت ar-JO-TaimNeural لأفضل طبيعية في العربية الأردنية
_EMOTION_PROSODY: Dict[str, Dict[str, str]] = {
    # ── المشاعر الستة الأساسية للمدرّس (tutor core emotions) ──
    'neutral':          {'rate': '+0%',  'pitch': '+0Hz'},   # هادئ — النغمة الطبيعية للهجة
    'friendly':         {'rate': '+4%',  'pitch': '+5Hz'},   # ودود — دفء أردني مميّز
    'thinking':         {'rate': '-14%', 'pitch': '-5Hz'},   # تفكير — متأمّل، مع توقف طبيعي
    'encouraging':      {'rate': '+10%', 'pitch': '+7Hz'},   # تشجيع — حماسي وواضح
    'strict':           {'rate': '-8%',  'pitch': '-8Hz'},   # حازم — سلطة أستاذية هادئة
    'celebrate':        {'rate': '+18%', 'pitch': '+12Hz'},  # احتفال — فرح أردني تعبيري
    # ── مشاعر موسّعة (للتوافق مع استجابات LLM الأخرى) ──────
    'celebrating':      {'rate': '+18%', 'pitch': '+12Hz'},
    'excited':          {'rate': '+12%', 'pitch': '+9Hz'},
    'happy':            {'rate': '+6%',  'pitch': '+5Hz'},
    'proud':            {'rate': '+5%',  'pitch': '+4Hz'},
    'surprised':        {'rate': '+6%',  'pitch': '+8Hz'},
    'curious':          {'rate': '+3%',  'pitch': '+3Hz'},
    'attentive':        {'rate': '+1%',  'pitch': '+2Hz'},
    'empathetic':       {'rate': '-10%', 'pitch': '-4Hz'},
    'concerned':        {'rate': '-10%', 'pitch': '-5Hz'},
    'sad':              {'rate': '-14%', 'pitch': '-9Hz'},
    'anxious':          {'rate': '-6%',  'pitch': '-3Hz'},
    'strictevaluation': {'rate': '-8%',  'pitch': '-8Hz'},
}
# الإيقاع الافتراضي عند مجيء مشاعر غير معروفة → طبيعي هادئ
_DEFAULT_PROSODY: Dict[str, str] = {'rate': '+0%', 'pitch': '+0Hz'}


async def _synthesize_edge_tts(
    text: str,
    rate: str = '+0%',
    pitch: str = '+0Hz',
    voice: Optional[str] = None,
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Synthesize via edge-tts streaming with optional prosody.
    Returns (mp3_bytes, word_timings, viseme_events).
    word_timings:   [{word, start_time, end_time}]   (times in ms)
    viseme_events:  [{offset_ms, viseme_id}]
    """
    import edge_tts  # already in requirements.txt

    _voice = voice or EDGE_TTS_ARABIC_MALE
    # boundary='WordBoundary' is REQUIRED to receive per-word timing events.
    # The default 'SentenceBoundary' only emits sentence-level events and
    # produces 0 word timings — which breaks lip-sync viseme scheduling.
    communicate = edge_tts.Communicate(
        text, _voice,
        rate=rate, pitch=pitch,
        boundary='WordBoundary',
    )
    audio_chunks: List[bytes] = []
    word_bounds: List[Dict[str, Any]] = []

    async for chunk in communicate.stream():
        ctype = chunk.get("type")
        if ctype == "audio":
            audio_chunks.append(chunk["data"])
        elif ctype in ("WordBoundary", "SentenceBoundary"):
            # offset/duration are in 100-nanosecond units → convert to ms
            offset_ms  = chunk.get("offset",   0) / 10_000
            dur_ms     = chunk.get("duration", 0) / 10_000
            word_bounds.append({
                "word":       chunk.get("text", ""),
                "start_time": offset_ms,
                "end_time":   offset_ms + dur_ms,
            })

    if not audio_chunks:
        raise RuntimeError("edge-tts returned no audio")

    mp3_bytes = b"".join(audio_chunks)

    # Build viseme events: one opening event per word + one silence at word end
    viseme_events: List[Dict[str, Any]] = []
    for wb in word_bounds:
        word    = wb["word"]
        open_ms = max(0.0, wb["start_time"] - 30)   # 30ms lead-in
        vid     = _word_first_viseme(word)
        if vid != 0:
            viseme_events.append({"offset_ms": open_ms,      "viseme_id": vid})
        # Close mouth at word end
        viseme_events.append(    {"offset_ms": wb["end_time"], "viseme_id": 0})

    return mp3_bytes, word_bounds, viseme_events


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
    text:    str           = Field(..., max_length=5000)
    voice:   Optional[str] = Field(default="am_michael")
    speed:   Optional[float] = Field(default=1.0, ge=0.25, le=4.0)
    emotion: Optional[str] = Field(default="neutral")
    pitch:   Optional[str] = Field(default=None)   # explicit Hz override e.g. "+5Hz"
    ar_voice: Optional[str] = Field(default=None)  # Jordanian voice override: "male" | "female" | full voice name


class TTSResponse(BaseModel):
    audio_base64:  str
    word_timings:  List[Dict[str, Any]]
    viseme_events: List[Dict[str, Any]] = []
    sample_rate:   int = 24000
    format:        str = "pcm"


# ── Main endpoint ──────────────────────────────────────────────────────────────
@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(payload: TTSRequest):
    """
    Synthesize text to speech with word-level timing and viseme events for lip-sync.
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # Resolve prosody from emotion (or use explicit pitch override)
    prosody = _EMOTION_PROSODY.get(
        (payload.emotion or 'neutral').lower(),
        _DEFAULT_PROSODY,
    )
    tts_rate  = prosody['rate']
    tts_pitch = payload.pitch if payload.pitch else prosody['pitch']

    # Resolve Jordanian Arabic voice
    _ar_voice_req = (payload.ar_voice or '').strip().lower()
    if _ar_voice_req == 'female':
        ar_voice_name = EDGE_TTS_ARABIC_FEMALE
    elif _ar_voice_req in ('male', ''):
        ar_voice_name = EDGE_TTS_ARABIC_MALE
    else:
        ar_voice_name = payload.ar_voice  # accept full voice name as-is

    # 1) Kokoro (non-Arabic local model — speed param only, prosody not supported)
    if is_available():
        result = await synthesize_with_timing(
            text=text,
            voice=payload.voice or "am_michael",
            speed=payload.speed or 1.0,
        )
        if result is not None:
            audio_bytes, word_timings = result
            return TTSResponse(
                audio_base64=base64.b64encode(audio_bytes).decode("ascii"),
                word_timings=word_timings,
                viseme_events=[],   # Kokoro doesn't emit visemes
                sample_rate=24000,
                format="pcm",
            )
        logger.info("Kokoro returned None (Arabic text) — using edge-tts")

    # 2) edge-tts streaming (real word-boundary timing + viseme events + prosody)
    try:
        mp3_bytes, word_timings, viseme_events = await _synthesize_edge_tts(
            text, rate=tts_rate, pitch=tts_pitch, voice=ar_voice_name
        )
        logger.info(
            "edge-tts: %d words, %d viseme events",
            len(word_timings), len(viseme_events),
        )
        return TTSResponse(
            audio_base64=base64.b64encode(mp3_bytes).decode("ascii"),
            word_timings=word_timings,
            viseme_events=viseme_events,
            sample_rate=24000,
            format="mp3",
        )
    except Exception as e:
        logger.warning("edge-tts failed (%s), falling back to gTTS", e)

    # 3) gTTS last resort (estimated timings, no visemes)
    try:
        loop = asyncio.get_event_loop()
        mp3_bytes = await loop.run_in_executor(None, _synthesize_gtts_sync, text)
    except Exception as e:
        logger.exception("gTTS fallback also failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"TTS unavailable: all engines failed ({e!s})",
        )

    word_timings = _estimate_word_timings(text)
    return TTSResponse(
        audio_base64=base64.b64encode(mp3_bytes).decode("ascii"),
        word_timings=word_timings,
        viseme_events=[],
        sample_rate=24000,
        format="mp3",
    )
