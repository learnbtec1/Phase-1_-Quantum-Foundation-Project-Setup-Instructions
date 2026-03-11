# -*- coding: utf-8 -*-
"""
tts_arabic Local Arabic TTS Service
=====================================
Offline Arabic TTS powered by the `tts_arabic` library (nipponjo/tts_arabic).
No API key, no internet connection required after the one-time model download.

Returns raw **int16 PCM bytes** at 22050 Hz (mono) — the frontend's
`playPCMAudio()` wraps them in a WAV Blob via `pcmToWavBlob`.

Install:
    pip install git+https://github.com/nipponjo/tts_arabic.git

Speaker IDs:
    0 = female (Zeynep)
    1 = male   (Osman)  ← default, matches Dr. Hamza
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ── API constants ──────────────────────────────────────────────────────────────
_TTS_ENDPOINT   = "https://lahajati.ai/api/v1/text-to-speech-absolute-control"
_VOICE_ID       = "l6ErPsa0knOuPHhg7QtW3zyr"   # Hussein — teacher voice
_PERFORMANCE_ID = "1798"                         # "Teacher explaining a scientific experiment"
_DEFAULT_DIALECT = "22"                          # Ammani Jordanian (Urban)
_TIMEOUT         = 30.0                          # seconds — TTS synthesis can take a moment

# Demo/fallback key extracted from the working HTML reference app.
# Rotate via LAHAJATI_API_KEY env var in production.
_DEMO_KEY = (
    "sk_eyJpdiI6ImhmRm42ekkxMW5mWkFLb0lKdVFPdXc9PSIsInZhbHVlIjoiMElL"
    "aVhrWTdnSU56UWdveEkxQ0VrM1RIRFZLbldrbHJVUkdVZEVoU0NwaTdSRTA2Sm54"
    "YUY3V0JxeGhwNDZZdSIsIm1hYyI6IjMyNjBjMDdhNDUzMTA4MmU3ZTc0YmE5NmZm"
    "NDUyYjJiMzYzYWQ0NmMxNjgyYWEzOTg3ZTFhNjgwNDdlNDE2MzkiLCJ0YWciOiIi"
    "fQ=="
)


def _api_key() -> str:
    return os.environ.get("LAHAJATI_API_KEY", "").strip() or _DEMO_KEY


def _dialect_id() -> str:
    return os.environ.get("LAHAJATI_DIALECT_ID", _DEFAULT_DIALECT).strip()


async def synthesize(
    text: str,
    dialect_id: Optional[str] = None,
) -> Optional[bytes]:
    """
    Convert Arabic text → Jordanian Arabic MP3 via Lahajati.ai.

    Parameters
    ----------
    text       : Arabic text to synthesize (any length; API handles normalization).
    dialect_id : Override the dialect. Defaults to LAHAJATI_DIALECT_ID env var
                 or "22" (Ammani Jordanian).

    Returns
    -------
    Raw MP3 bytes on success, None on any error (caller sends tts_unavailable).
    """
    text = (text or "").strip()
    if not text:
        return None

    payload = {
        "text":           text,
        "id_voice":       _VOICE_ID,
        "input_mode":     "0",
        "performance_id": _PERFORMANCE_ID,
        "dialect_id":     dialect_id or _dialect_id(),
    }
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Accept":        "audio/mpeg",
        "Content-Type":  "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(_TTS_ENDPOINT, json=payload, headers=headers)
            resp.raise_for_status()

        mp3_bytes = resp.content
        if not mp3_bytes:
            logger.warning("[LahajatiTTS] API returned empty body for text: %.60s", text)
            return None

        logger.info(
            "[LahajatiTTS] ✅  %d bytes MP3 | dialect=%s | chars=%d",
            len(mp3_bytes), dialect_id or _dialect_id(), len(text),
        )
        return mp3_bytes

    except httpx.HTTPStatusError as exc:
        logger.error(
            "[LahajatiTTS] HTTP %s — %s",
            exc.response.status_code,
            exc.response.text[:300],
        )
        return None
    except httpx.TimeoutException:
        logger.error("[LahajatiTTS] Request timed out after %.0fs", _TIMEOUT)
        return None
    except Exception:
        logger.exception("[LahajatiTTS] Unexpected error")
        return None
