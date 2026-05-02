# -*- coding: utf-8 -*-
"""No-op dialect pass-through for TTS (reference stack hook; EDUVERSE uses dataclass User + thin API)."""

from __future__ import annotations

from typing import Any


def maybe_correct_egyptian_for_tts(
    text: str,
    context: str | None = None,
    **kwargs: Any,
) -> str:
    """Optional `context`/`kwargs` kept for call-site compatibility (TTS routes, edge synth)."""
    return text
