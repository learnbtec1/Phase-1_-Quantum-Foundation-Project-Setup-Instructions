# -*- coding: utf-8 -*-
"""
Kokoro TTS — DISABLED. Production uses Microsoft Edge TTS (edge-tts) only.

This module remains as a stub so accidental imports fail loudly instead of
pulling optional kokoro dependencies. Use ``app.services.tts_service`` (Edge TTS) for synthesis.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_DISABLED_MSG = (
    "Kokoro TTS is disabled — Cogni uses Edge TTS (edge-tts) only. "
    "No API key required; ensure outbound network to Microsoft."
)


def _reject() -> None:
    logger.error(_DISABLED_MSG)
    raise RuntimeError(_DISABLED_MSG)


def _init_kokoro() -> bool:
    """Always false — Kokoro is not used."""
    return False


def is_available() -> bool:
    return False


async def synthesize_with_timing(
    text: str,
    voice: str = "am_michael",
    speed: float = 1.0,
) -> Optional[Tuple[bytes, List[Dict[str, Any]]]]:
    _reject()
    return None
