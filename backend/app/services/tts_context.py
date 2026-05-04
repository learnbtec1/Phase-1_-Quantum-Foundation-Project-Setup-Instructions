# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SynthesisContext:
    """Per-request options for the TTS router (no provider-specific globals in endpoints)."""

    allow_elevenlabs_fallback: bool
    edge_voice: str
    elevenlabs_voice_id: str
    elevenlabs_timeout_sec: float
    edge_timeout_sec: float
    local_timeout_sec: float
    request_id: str | None = None
