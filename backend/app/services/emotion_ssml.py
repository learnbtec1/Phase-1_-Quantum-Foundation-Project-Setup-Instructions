# -*- coding: utf-8 -*-
"""
Emotion → Azure Neural SSML: express-as style + prosody (rate / pitch / volume).

Styles must be supported by the target neural voice (ar-JO-TaimNeural supports a subset).
See: https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup-voice-styles
"""
from __future__ import annotations

import re
from typing import Dict, Tuple

# Canonical emotion keys → Azure `mstts:express-as` style names (neural voices).
# Calm → chat, serious → serious, excited → excited, thinking → newscast (per product spec).
EMOTION_TO_STYLE: Dict[str, str] = {
    "calm": "chat",
    "serious": "serious",
    "excited": "excited",
    "thinking": "newscast",
    "neutral": "friendly",
    "friendly": "friendly",
    "happy": "friendly",
    "encouraging": "friendly",
    "concerned": "friendly",
    "empathetic": "friendly",
    "sad": "sad",
    "strict": "serious",
    "proud": "friendly",
    "attentive": "friendly",
    "curious": "friendly",
    "surprised": "excited",
    "celebrate": "excited",
    "celebration": "excited",
    "anxious": "friendly",
    "relax": "chat",
    "strictevaluation": "serious",
}

# Baseline prosody per style family — overridden by intensity-scaled deltas below.
_STYLE_BASE: Dict[str, Tuple[str, str, str]] = {
    # style_key: (default_rate, default_pitch, default_volume)
    "friendly": ("92%", "+2%", "medium"),
    "chat": ("88%", "+0%", "medium"),
    "serious": ("90%", "-1%", "medium"),
    "excited": ("102%", "+4%", "+5%"),
    "newscast": ("94%", "+1%", "medium"),
    "empathetic": ("90%", "-2%", "medium"),
    "sad": ("86%", "-3%", "medium"),
}

# Extra rate/pitch deltas by canonical emotion (scaled by intensity).
_EMOTION_PROSODY_DELTA: Dict[str, Tuple[str, str]] = {
    "calm": ("-5%", "-2%"),
    "serious": ("+0%", "+0%"),
    "excited": ("+10%", "+6%"),
    "thinking": ("-3%", "+0%"),
    "neutral": ("+0%", "+0%"),
    "friendly": ("+2%", "+1%"),
    "happy": ("+4%", "+3%"),
    "encouraging": ("+5%", "+3%"),
    "strict": ("-2%", "-1%"),
    "surprised": ("+6%", "+5%"),
    "sad": ("-4%", "-4%"),
    "concerned": ("-3%", "-2%"),
}


def _parse_pct(s: str) -> float:
    s = (s or "").strip()
    m = re.match(r"^([+-]?)(\d+(?:\.\d+)?)\s*%$", s)
    if not m:
        return 0.0
    sign = -1.0 if m.group(1) == "-" else 1.0
    return sign * float(m.group(2))


def _fmt_pct(x: float) -> str:
    v = round(x, 2)
    return f"{v:+.1f}%" if v != 0 else "+0%"


def _add_rate_pitch(a: str, b: str) -> str:
    return _fmt_pct(_parse_pct(a) + _parse_pct(b))


def resolve_express_style(emotion: str) -> str:
    e = (emotion or "neutral").lower().strip()
    return EMOTION_TO_STYLE.get(e, "friendly")


def resolve_styledegree(intensity: float) -> str:
    """Map 0..1 → styledegree 1.0..1.95 (Azure allows ~0.01–2.0)."""
    t = max(0.0, min(1.0, float(intensity)))
    deg = 1.0 + t * 0.95
    return f"{deg:.2f}"


def resolve_prosody_triple(
    emotion: str,
    intensity: float,
) -> Tuple[str, str, str]:
    """
    Returns (rate, pitch, volume) for inner <prosody>.
    Intensity scales deviation from neutral (stronger emotion → stronger prosody).
    """
    e = (emotion or "neutral").lower().strip()
    style = resolve_express_style(e)
    base = _STYLE_BASE.get(style, _STYLE_BASE["friendly"])
    dr, dp = _EMOTION_PROSODY_DELTA.get(e, ("+0%", "+0%"))
    t = max(0.0, min(1.0, float(intensity)))
    # Blend delta toward neutral when intensity is low
    rate = _add_rate_pitch(base[0], _fmt_pct(_parse_pct(dr) * (0.35 + 0.65 * t)))
    pitch = _add_rate_pitch(base[1], _fmt_pct(_parse_pct(dp) * (0.35 + 0.65 * t)))
    vol = base[2]
    if e in ("excited", "celebrate", "celebration", "surprised") and t > 0.45:
        vol = "loud"
    elif e in ("calm", "sad", "concerned") and t > 0.55:
        vol = "soft"
    return rate, pitch, vol
