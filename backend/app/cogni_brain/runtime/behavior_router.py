# -*- coding: utf-8 -*-
"""
Maps inferred student affect → teaching strategy, gesture intensity, and speech speed.
Used when ENABLE_EMOTIONAL_INTELLIGENCE is on to append a dynamic system-prompt block.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Tuple

# Canonical states (LLM may also emit these in JSON)
STUDENT_STATES = (
    "engaged",
    "struggling",
    "frustrated",
    "bored",
    "happy",
    "sad",
    "confused",
    "tired",
)

# state → (strategy_label, gesture_intensity 0–1, speech_speed_mult)
_STATE_MAP: Dict[str, Tuple[str, float, float]] = {
    "engaged": ("challenge", 0.9, 1.1),
    "struggling": ("simplify_with_examples", 0.5, 0.9),
    "frustrated": ("empathize_re_explain", 0.6, 0.85),
    "bored": ("change_topic_fun_hook", 0.8, 1.05),
    "happy": ("positive_reinforcement", 0.9, 1.05),
    "sad": ("empathetic_supportive", 0.5, 0.9),
    "confused": ("micro_steps_examples", 0.55, 0.88),
    "tired": ("short_bursts_encourage", 0.45, 0.82),
}


def normalize_student_state(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if s in _STATE_MAP:
        return s
    aliases = {
        "excited": "happy",
        "anxious": "sad",
        "angry": "frustrated",
        "disengaged": "bored",
    }
    return aliases.get(s, "engaged")


def infer_student_state_heuristic(user_text: str) -> str:
    """
    Lightweight lexical cueing when the LLM has not yet classified the turn.
    Not a substitute for the model's firasah — only a bootstrap for prompt routing.
    """
    t = (user_text or "").strip().lower()
    if not t:
        return "engaged"
    # Frustration / anger
    if re.search(r"!{2,}|\?{3,}", t) or any(
        x in t for x in ("لا يعمل", "مش شغال", "not working", "why?!", "ليه", "زهقان")
    ):
        return "frustrated"
    # Success / joy
    if any(x in t for x in ("اشتغل", "فهمت", "yes!", "got it", "ممتاز", "yay")):
        return "happy"
    # Bored / disengaged
    if t in ("ok", "طيب", "نعم", "yes", "k", "تمام") and len(t) < 12:
        return "bored"
    # Fatigue / confusion markers
    if any(x in t for x in ("umm", "uh", "مش فاهم", "don't understand", "تعبان", "نفس")):
        return "confused"
    if any(x in t for x in ("حزين", "خايف", "worried", "anxious", "sad")):
        return "sad"
    return "engaged"


def get_teaching_strategy(student_state: str) -> str:
    return _STATE_MAP.get(normalize_student_state(student_state), _STATE_MAP["engaged"])[0]


def get_gesture_intensity(student_state: str) -> float:
    return _STATE_MAP.get(normalize_student_state(student_state), _STATE_MAP["engaged"])[1]


def get_speech_speed(student_state: str) -> float:
    return _STATE_MAP.get(normalize_student_state(student_state), _STATE_MAP["engaged"])[2]


def build_emotional_prompt_suffix(student_state: str, strategy: str) -> str:
    st = normalize_student_state(student_state)
    gi = get_gesture_intensity(st)
    sp = get_speech_speed(st)
    return (
        "\n\n## [COGNI BRAIN — حالة الطالب (داخلي)]\n"
        f"تقدير حالة الطالب لهذه الجولة: **{st}**. استراتيجية التدريس المقترحة: **{strategy}**.\n"
        f"أثناء توليد ردك: شدّة الإيماءات المقتربة ≈ {gi:.2f}؛ سرعة الكلام النسبية ≈ {sp:.2f} "
        "(عطف، تبسيط، أو تحدي حسب الحالة). لا تذكر للطالب أنك تصنّف حالته.\n"
        "إن كان المخرج JSON، أضف الحقول student_state وstudent_confidence وstudent_engagement وpsychological_analysis عند الحاجة.\n"
    )


def load_teaching_strategies_md() -> str:
    """Best-effort load of prompts/teaching_strategies.md for optional injection."""
    from pathlib import Path

    p = Path(__file__).resolve().parent.parent / "prompts" / "teaching_strategies.md"
    try:
        return p.read_text(encoding="utf-8")[:6000]
    except OSError:
        return ""
