# -*- coding: utf-8 -*-
"""
Whisper STT service - Speech-to-Text using OpenAI Whisper.
Optional: requires faster-whisper or openai-whisper. Falls back gracefully when not available.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_whisper_available = False
_processor = None


def _init_whisper() -> bool:
    """Initialize Whisper model. Returns True if successful."""
    global _whisper_available, _processor
    if _whisper_available:
        return True
    try:
        from faster_whisper import WhisperModel
        _processor = WhisperModel("tiny", device="cpu", compute_type="int8")
        _whisper_available = True
        logger.info("Whisper STT initialized (faster-whisper, tiny model)")
        return True
    except ImportError:
        pass
    except Exception as e:
        logger.warning("faster-whisper init failed: %s", e)
    try:
        import whisper
        _processor = whisper.load_model("tiny")
        _whisper_available = True
        logger.info("Whisper STT initialized (openai-whisper, tiny model)")
        return True
    except ImportError:
        pass
    except Exception as e:
        logger.warning("openai-whisper init failed: %s", e)
    logger.warning("Whisper not available. Install faster-whisper or openai-whisper for STT.")
    return False


def is_available() -> bool:
    """Check if Whisper STT is available."""
    return _init_whisper()


def _extract_pcm(audio_bytes: bytes) -> tuple[bytes, int]:
    """Extract 16-bit PCM from raw bytes or WAV. Returns (pcm_bytes, sample_rate)."""
    if len(audio_bytes) < 44:
        return audio_bytes, 16000
    if audio_bytes[:4] == b'RIFF' and audio_bytes[8:12] == b'WAVE':
        import struct
        fmt_chunk = audio_bytes[12:36]
        if fmt_chunk[:4] == b'fmt ':
            sr = struct.unpack_from('<I', fmt_chunk, 8)[0]
            pcm_start = audio_bytes.find(b'data')
            if pcm_start >= 0:
                data_len = struct.unpack_from('<I', audio_bytes, pcm_start + 4)[0]
                pcm = audio_bytes[pcm_start + 8:pcm_start + 8 + data_len]
                return pcm, sr
        return audio_bytes[44:], 16000
    return audio_bytes, 16000


async def transcribe_audio(audio_bytes: bytes, sample_rate: int = 16000) -> Optional[str]:
    """
    Transcribe audio bytes to text.
    Accepts raw 16-bit PCM mono or WAV.
    Returns transcribed text or None on error.
    """
    if not _init_whisper():
        return None
    try:
        import numpy as np
        pcm_bytes, detected_sr = _extract_pcm(audio_bytes)
        audio_array = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        def _run():
            global _processor
            try:
                segments, _ = _processor.transcribe(audio_array, language="ar", beam_size=1)
                return " ".join(s.text.strip() for s in segments if s.text.strip())
            except (TypeError, AttributeError):
                r = _processor.transcribe(audio_array, fp16=False, language="ar")
                return (r.get("text") if isinstance(r, dict) else str(r) or "").strip()

        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, _run)
        text = (text or "").strip()
        if not text or len(text) < 2:
            return None
        if text.lower() in ("thank you", "thanks for watching", "you", ".", ""):
            return None
        logger.info("Whisper transcription: %s", text[:80])
        return text
    except Exception as e:
        logger.exception("Whisper transcription error: %s", e)
        return None
