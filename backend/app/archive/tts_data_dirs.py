# -*- coding: utf-8 -*-
"""Ensure TTS / conversation persistence directories exist and are writable."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def ensure_tts_data_dirs() -> None:
    """
    Create backend/data/audio and backend/data/store (and chroma parent) if needed.
    Performs a small write/delete probe; logs ERROR if not writable.
    """
    backend_root = Path(__file__).resolve().parents[2]
    data = backend_root / "data"
    for sub in ("audio", "store", "chroma_cogni"):
        p = data / sub
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.error(
                "[TTS_DATA] cannot mkdir %s | errno=%s | %s",
                p,
                getattr(e, "errno", "?"),
                e,
                exc_info=True,
            )
            raise
        probe = p / ".cogni_write_probe"
        try:
            probe.write_text("ok", encoding="utf-8")
            if probe.exists():
                probe.unlink()
        except OSError as e:
            logger.error("[TTS_DATA] not writable: %s | %s", p, e, exc_info=True)

    # Honor AUDIO_DIR / STORE_DIR if set to custom paths
    for env_key, default_name in (("AUDIO_DIR", "audio"), ("STORE_DIR", "store")):
        raw = (os.getenv(env_key) or "").strip()
        if not raw:
            continue
        custom = Path(raw).expanduser()
        try:
            custom.mkdir(parents=True, exist_ok=True)
            t = custom / ".cogni_write_probe"
            t.write_text("ok", encoding="utf-8")
            t.unlink()
        except OSError as e:
            logger.error("[TTS_DATA] custom %s=%s not usable | %s", env_key, custom, e, exc_info=True)

    logger.info("[TTS_DATA] data dirs checked | base=%s", data)
