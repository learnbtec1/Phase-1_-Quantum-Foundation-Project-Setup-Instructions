# -*- coding: utf-8 -*-
"""
TTS-with-timing endpoint: POST /api/v1/tts-with-timing
Synthesize speech with word-level timing for lip-sync.
Uses Kokoro TTS (local) when available; falls back to edge-tts (Arabic male) or gTTS.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import tempfile
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Tuple

from fastapi import APIRouter, HTTPException

from app.services.kokoro_tts import is_available, synthesize_with_timing

logger = logging.getLogger(__name__)

router = APIRouter()


class TTSRequest(BaseModel):
    text: str = Field(..., max_length=5000, description="Text to synthesize")
    voice: Optional[str] = Field(default="am_michael", description="Voice ID (Kokoro: am_michael male)")
    speed: Optional[float] = Field(default=1.0, ge=0.25, le=4.0, description="Speed multiplier")


class TTSResponse(BaseModel):
    audio_base64: str
    word_timings: List[Dict[str, Any]]
    sample_rate: int = 24000
    format: str = "pcm"


def _estimate_word_timings(text: str, ms_per_word: float = 350.0) -> List[Dict[str, Any]]:
    """Estimate word timings for fallback TTS (no real timings)."""
    words = text.split()
    if not words:
        return []
    return [
        {"word": w, "start_time": i * ms_per_word, "end_time": (i + 1) * ms_per_word}
        for i, w in enumerate(words)
    ]


# Arabic male voice — Jordanian dialect (اللهجة الأردنية)
EDGE_TTS_ARABIC_MALE = "ar-JO-TaimNeural"


def _fallback_tts_sync(text: str, lang: str = "ar") -> Tuple[bytes, List[Dict[str, Any]]]:
    """
    Fallback TTS: prefer edge-tts (Jordanian Arabic male), else gTTS (Arabic).
    Returns (mp3_bytes, word_timings).
    """
    # 1) Try edge-tts — Jordanian male (ar-JO-TaimNeural)
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, EDGE_TTS_ARABIC_MALE)
        fd, path = tempfile.mkstemp(suffix=".mp3")
        try:
            os.close(fd)
            communicate.save(path)
            with open(path, "rb") as f:
                mp3_bytes = f.read()
            word_timings = _estimate_word_timings(text)
            return mp3_bytes, word_timings
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
    except Exception as e:
        logger.warning("edge-tts failed (%s), trying gTTS", e)

    # 2) gTTS Arabic (no male/female choice; speaks Arabic)
    try:
        from gtts import gTTS
    except ImportError:
        raise RuntimeError("TTS fallback failed. Install: pip install edge-tts gtts")
    buf = io.BytesIO()
    tts = gTTS(text=text, lang=lang, slow=False)
    tts.write_to_fp(buf)
    mp3_bytes = buf.getvalue()
    word_timings = _estimate_word_timings(text)
    return mp3_bytes, word_timings


@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(payload: TTSRequest):
    """
    Synthesize text to speech with word-level timing.
    Returns base64-encoded audio (PCM from Kokoro or MP3 from gTTS fallback) and word timings.
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    # Try Kokoro first
    if is_available():
        result = await synthesize_with_timing(
            text=text,
            voice=payload.voice or "am_michael",
            speed=payload.speed or 1.0,
        )
        if result is not None:
            audio_bytes, word_timings = result
            audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            return TTSResponse(
                audio_base64=audio_b64,
                word_timings=word_timings,
                sample_rate=24000,
                format="pcm",
            )
        # Kokoro returned None (e.g. Arabic text) → use fallback
        logger.info("Kokoro returned None (e.g. Arabic), using gTTS fallback")

    # Kokoro not available or returned None: use gTTS fallback
    logger.info("Using gTTS fallback for TTS (Kokoro not available or skipped)")
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        mp3_bytes, word_timings = await loop.run_in_executor(None, _fallback_tts_sync, text)
    except Exception as e:
        logger.exception("gTTS fallback failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"TTS unavailable: Kokoro not available and gTTS failed: {e!s}",
        )
    audio_b64 = base64.b64encode(mp3_bytes).decode("ascii")
    return TTSResponse(
        audio_base64=audio_b64,
        word_timings=word_timings,
        sample_rate=24000,
        format="mp3",
    )
