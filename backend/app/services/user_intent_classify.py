# -*- coding: utf-8 -*-
"""
Rule-based user message intent (shared by HTTP chat and WS tutor path).
Kept separate from chat.py to avoid import cycles with tutor.
"""

from __future__ import annotations

import re
from typing import List, Tuple

_INTENT_RULES: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r'\b(btec|p[123]|m[123]|d[123]|distinction|merit|pass|lo\d|criteria|criterion|unit\s*\d)\b', re.I), 'btec_question'),
    (re.compile(r'\b(معيار|معايير|تمييز|جدارة|نجاح|وحدة|بيتيسي|تكليف)\b', re.I), 'btec_question'),
    (re.compile(r'\b(لماذا|كيف|ما هو|ما هي|اشرح|what|why|how|when|who|explain|define)\b', re.I), 'general_question'),
    (re.compile(r'\b(اريد|أريد|ممكن|please|بدي|ساعدني|أحتاج|help me|can you|give me)\b', re.I), 'request'),
    (re.compile(r'\b(مش فاهم|ما فهمت|confused|lost|لا أفهم|شو يعني|i don.t get)\b', re.I), 'confusion'),
    (re.compile(r'\b(شكرا|يسلموا|يسلم|thanks|thank you|ممتاز|برافو|رائع|awesome)\b', re.I), 'gratitude'),
    (re.compile(r'\b(مرحبا|أهلا|hi|hello|hey|كيفك|شو اخبارك)\b', re.I), 'greeting'),
    (re.compile(r'\b(مع السلامة|باي|bye|goodbye|يلا وداع)\b', re.I), 'farewell'),
]

_DISTINCTION_RE = re.compile(
    r'\b(distinction|تميز|امتياز|مميز|d\d+|وحدة\s*\d+|unit\s*\d+)\b', re.I | re.UNICODE
)


def classify_user_intent(text: str) -> str:
    """Lightweight keyword/router intent for avatar behavior and analytics."""
    t = (text or "").strip()
    if not t:
        return "idle"
    if _DISTINCTION_RE.search(t):
        return "distinction_request"
    for pattern, intent in _INTENT_RULES:
        if pattern.search(t):
            return intent
    return "idle"
