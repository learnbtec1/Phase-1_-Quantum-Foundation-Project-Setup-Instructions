# -*- coding: utf-8 -*-
"""
Kokoro TTS service - Text-to-Speech with native word-level timing for lip-sync.
Optional: requires kokoro package. Falls back gracefully when not available.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional, Tuple, List, Dict, Any

# Arabic Unicode block: U+0600–U+06FF (also U+0750–U+077F extended Arabic)
_ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]")

logger = logging.getLogger(__name__)

_pipeline = None
_available = False


def _init_kokoro() -> bool:
    """Initialize Kokoro TTS. Returns True if successful."""
    global _pipeline, _available
    if _available:
        return True
    try:
        from kokoro import KPipeline
        _pipeline = KPipeline(lang_code="a")
        _available = True
        logger.info("Kokoro TTS initialized successfully")
        return True
    except ImportError as e:
        logger.warning("Kokoro TTS not available (ImportError): %s", e)
        return False
    except Exception as e:
        logger.warning("Kokoro TTS init failed: %s", e)
        return False


def is_available() -> bool:
    """Check if Kokoro TTS is available."""
    return _init_kokoro()


async def synthesize_with_timing(
    text: str,
    voice: str = "am_michael",
    speed: float = 1.0,
) -> Optional[Tuple[bytes, List[Dict[str, Any]]]]:
    """
    Synthesize speech with word-level timing.
    Returns (audio_bytes_16bit_pcm, word_timings) or None.
    word_timings: [{"word": str, "start_time": ms, "end_time": ms}, ...]
    """
    if not _init_kokoro() or not text or not text.strip():
        return None
    # Kokoro is an English pipeline (lang_code="a"). Arabic text causes the
    # phonemizer to emit the literal word "arabic" into the audio stream.
    # Return None so the caller falls back to OpenAI TTS, which handles Arabic.
    if _ARABIC_RE.search(text):
        logger.info("Kokoro: Arabic text detected — skipping Kokoro, returning None for OpenAI fallback")
        return None
    try:
        import numpy as np

        def _run():
            all_audio = []
            all_timings = []
            time_offset = 0.0
            gen = _pipeline(
                text.strip(),
                voice=voice,
                speed=speed,
                split_pattern=None,
            )
            for result in gen:
                for token in getattr(result, "tokens", []) or []:
                    if getattr(token, "start_ts", None) is not None and getattr(token, "end_ts", None) is not None:
                        all_timings.append({
                            "word": getattr(token, "text", "") or "",
                            "start_time": (token.start_ts + time_offset) * 1000,
                            "end_time": (token.end_ts + time_offset) * 1000,
                        })
                aud = getattr(result, "audio", None)
                if aud is not None:
                    arr = aud.cpu().numpy() if hasattr(aud, "cpu") else aud
                    all_audio.append(arr)
                    if len(arr) > 0:
                        time_offset += len(arr) / 24000.0
            if not all_audio:
                return None, []
            combined = np.concatenate(all_audio)
            audio_bytes = (combined * 32767).astype(np.int16).tobytes()
            return audio_bytes, all_timings

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)
    except Exception as e:
        logger.exception("Kokoro TTS error: %s", e)
        return None
