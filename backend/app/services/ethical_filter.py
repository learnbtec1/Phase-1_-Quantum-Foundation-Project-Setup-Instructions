# -*- coding: utf-8 -*-
"""Post-LLM guardrails: block medical/legal/financial/romantic advice (V28)."""

from __future__ import annotations

import re
from typing import Optional

_SAFE_REDIRECT = (
    "أنا معلم منهاجي فقط. ما بقدر أعطي نصائح طبية أو قانونية أو مالية. "
    "خلينا نركز على درسك أو سؤالك من المنهاج الأردني.\n"
    "*يبتسم بلطف*\n[EMOTION: friendly]"
)

_TRIGGERS = (
    (r"(?:دواء|علاج|تشخيص|أعراض|طبيب|مستشفى|سرطان|اكتئاب)", "medical"),
    (r"(?:محامي|قانوني|قضية|محكمة|عقد\s*قانوني)", "legal"),
    (r"(?:استثمار|أسهم|بورصة|قرض|بنكي|ضريبة\s*معقدة)", "financial"),
    (r"(?:أحبك|موعد\s*رومانسي|صديق\s*حبيب)", "romantic"),
)


def apply_ethical_filter(text: str, enabled: bool = True) -> str:
    if not enabled or not (text or "").strip():
        return text
    t = text.strip()
    low = t.lower()
    for pat, _ in _TRIGGERS:
        if re.search(pat, t, re.I) or re.search(pat, low, re.I):
            return _SAFE_REDIRECT
    # English medical/legal hints
    if re.search(
        r"\b(diagnos|prescription|dosage|lawsuit|attorney|invest in bitcoin|stock tip)\b",
        low,
        re.I,
    ):
        return _SAFE_REDIRECT
    return text


def _edu_anchor(text: str) -> bool:
    """Do not block clear curriculum-tied questions (biology, civics, etc.)."""
    t = text or ""
    keys = ("منهاج", "درس", "وحدة", "مادة", "امتحان", "صف ", "واجب", "وحدة")
    return any(k in t for k in keys)


def should_block_user_message(message: str) -> Optional[str]:
    """If user asks for disallowed domains, return safe reply; else None."""
    if not (message or "").strip():
        return None
    if _edu_anchor(message):
        return None
    t = message.strip()
    for pat, _ in _TRIGGERS:
        if re.search(pat, t, re.I):
            return _SAFE_REDIRECT
    return None
