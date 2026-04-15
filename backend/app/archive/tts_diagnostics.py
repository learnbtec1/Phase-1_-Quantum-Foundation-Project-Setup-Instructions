# -*- coding: utf-8 -*-
"""Human-readable TTS failure classification for logs and ops."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)


def classify_tts_failure(
    exc: BaseException,
    *,
    azure_key_set: bool,
    azure_region: str,
    edge_attempted: bool = False,
) -> Tuple[str, str]:
    """
    Returns (code, human_message) for logging and client hints.
    """
    msg = str(exc).strip()
    low = msg.lower()
    typ = type(exc).__name__

    if not azure_key_set:
        return (
            "azure_key_missing",
            "AZURE_SPEECH_KEY is empty or unset — set it in .env (Azure Speech is required).",
        )
    if not (azure_region or "").strip():
        return (
            "azure_region_missing",
            "AZURE_SPEECH_REGION is empty — set a valid region (e.g. eastus, westeurope).",
        )

    try:
        from app.services.tts_service import is_azure_tts_auth_failure

        if is_azure_tts_auth_failure(exc):
            return (
                "azure_auth",
                f"Azure Speech auth failed (invalid key or subscription): {msg[:200]}",
            )
    except Exception:
        pass

    if isinstance(exc, TimeoutError) or "timeout" in low or isinstance(exc, OSError) and "timed out" in low:
        return ("network_timeout", f"Network or synthesis timeout: {typ}: {msg[:200]}")

    if isinstance(exc, (ConnectionError, OSError)):
        if "network" in low or "resolve" in low or "connection" in low:
            return ("network_error", f"Network error during TTS: {typ}: {msg[:200]}")

    if "canceled" in low or "cancellation" in low:
        m = re.search(r"details=([^|]+)", msg)
        detail = (m.group(1).strip()[:300] if m else msg[:300])
        return ("azure_canceled", f"Azure TTS canceled: {detail}")

    if "empty" in low and "audio" in low:
        return ("azure_empty_audio", "Azure returned empty audio bytes.")

    if "credentials missing" in low or "missing in environment" in low:
        return ("azure_credentials", "Azure Speech credentials missing in environment.")

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
    if src == "azure":
        head = "✅ Azure TTS succeeded"
    elif src == "edge":
        head = "✅ Edge TTS succeeded"
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
