# -*- coding: utf-8 -*-
"""Human-readable TTS failure classification for logs and ops."""

from __future__ import annotations

import logging
from typing import Tuple

logger = logging.getLogger(__name__)


def classify_tts_failure(
    exc: BaseException,
    *,
    speech_credentials_ok: bool,
    edge_attempted: bool = False,
) -> Tuple[str, str]:
    """
    Returns (code, human_message) for logging and client hints.
    ``speech_credentials_ok``: Legacy flag; kept for API compatibility (Edge TTS does not use GCP).
    """

    msg = str(exc).strip()
    low = msg.lower()
    typ = type(exc).__name__

    if not speech_credentials_ok:
        return (
            "tts_credentials_missing",
            "TTS credentials missing (legacy check — Edge TTS does not use GCP credentials).",
        )

    try:
        from app.services.tts_service import is_edge_tts_failure

        if is_edge_tts_failure(exc):
            return (
                "edge_tts_error",
                f"Edge TTS / network error: {msg[:200]}",
            )
    except Exception:
        pass

    if isinstance(exc, TimeoutError) or "timeout" in low or isinstance(exc, OSError) and "timed out" in low:
        return ("network_timeout", f"Network or synthesis timeout: {typ}: {msg[:200]}")

    if isinstance(exc, (ConnectionError, OSError)):
        if "network" in low or "resolve" in low or "connection" in low:
            return ("network_error", f"Network error during TTS: {typ}: {msg[:200]}")

    if "empty" in low and "audio" in low:
        return ("google_empty_audio", "Google returned empty audio bytes.")

    if "credentials" in low and "missing" in low:
        return ("google_credentials", "Google Cloud credentials missing or invalid.")

    if not edge_attempted and "edge" not in low:
        pass
    elif edge_attempted and ("edge" in low or "edge-tts" in low):
        return ("edge_failed", f"Edge TTS fallback failed: {typ}: {msg[:200]}")

    return ("tts_unknown", f"TTS failed ({typ}): {msg[:400]}")


def log_tts_success(
    *,
    source: str,
    text_len: int,
    audio_bytes: int,
    viseme_n: int,
    word_n: int,
    voice: str = "",
) -> None:
    src = (source or "tts").lower().strip()
    if src == "edge":
        head = "✅ Edge TTS succeeded"
    elif src == "google":
        head = "✅ Google TTS succeeded"
    elif src == "azure":
        head = "✅ Azure TTS succeeded"
    else:
        head = "✅ TTS succeeded"
    logger.info(
        "%s | text_len=%d | audio_bytes=%d | visemes=%d | words=%d | voice=%s | source=%s",
        head,
        text_len,
        audio_bytes,
        viseme_n,
        word_n,
        (voice or "")[:48],
        src,
    )
