# -*- coding: utf-8 -*-
"""
Placeholder for future session-scoped emotional trajectory + history aggregation.
Agent WS and tutor.py currently pass context dict explicitly.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def _brain_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_current_state() -> Dict[str, Any]:
    """Load memory/current_state.json (defaults if missing)."""
    p = _brain_root() / "memory" / "current_state.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "emotion_confidence_default": 0.5,
            "engagement_default": 0.5,
            "gesture_intensity_cap": 1.0,
            "speech_speed_cap": 1.15,
        }


def merge_motor_with_psych_energy(
    motor: Dict[str, Any] | None, psych: Dict[str, Any] | None
) -> Dict[str, Any]:
    """Fold psychological_analysis.avatar_energy_level into speed_multiplier."""
    out: Dict[str, Any] = dict(motor) if isinstance(motor, dict) else {}
    if not isinstance(psych, dict):
        return out
    ae = psych.get("avatar_energy_level")
    if isinstance(ae, (int, float)):
        x = max(0.1, min(1.5, float(ae)))
        sm = 0.7 + (x - 0.1) * (0.6 / 1.4)
        out["speed_multiplier"] = max(0.7, min(1.3, round(sm, 4)))
    return out
