# -*- coding: utf-8 -*-
"""
contextual_gesture_analyzer.py
──────────────────────────────
Contextual Gesture Analysis for Cogni.

Extracts semantic cues from reply text and maps them to
appropriate gestures that match the **content** of speech.
"""

from __future__ import annotations

import os
import re
from typing import List, Optional, Set, Tuple

from pydantic import BaseModel, Field

from app.archive.gesture_repertoire import GestureRepertoire, get_repertoire


class ContextualTrigger(BaseModel):
    pattern: str = Field(..., description="Regex pattern or simple keyword")
    gesture_name: str
    side: Optional[str] = None
    scale_factor: Optional[float] = None
    priority_boost: int = Field(0, description="Extra priority points for this contextual match")
    description: str = ""


class ContextualGestureMatch(BaseModel):
    trigger: ContextualTrigger
    matched_text: str
    position: int
    confidence: float = Field(1.0, ge=0.0, le=1.0)


_CONTEXTUAL_TRIGGERS: List[ContextualTrigger] = [
    ContextualTrigger(
        pattern=r"\b(left|يسار|الشمال)\b",
        gesture_name="look",
        side="left",
        priority_boost=3,
        description="Left directional reference",
    ),
    ContextualTrigger(
        pattern=r"\b(right|يمين|اليمين)\b",
        gesture_name="look",
        side="right",
        priority_boost=3,
        description="Right directional reference",
    ),
    ContextualTrigger(
        pattern=r"\b(point to|أشير إلى|انظر إلى)\b.*(left|يسار)",
        gesture_name="point",
        side="left",
        priority_boost=4,
        description="Point left",
    ),
    ContextualTrigger(
        pattern=r"\b(point to|أشير إلى|انظر إلى)\b.*(right|يمين)",
        gesture_name="point",
        side="right",
        priority_boost=4,
        description="Point right",
    ),
    ContextualTrigger(
        pattern=r"\b(small|tiny|little|صغير|صغيرة|قليل)\b",
        gesture_name="openHand",
        scale_factor=0.6,
        priority_boost=2,
        description="Small size gesture",
    ),
    ContextualTrigger(
        pattern=r"\b(big|large|huge|enormous|كبير|كبيرة|ضخم)\b",
        gesture_name="openHand",
        scale_factor=1.3,
        priority_boost=2,
        description="Large size gesture",
    ),
    ContextualTrigger(
        pattern=r"\b(important|crucial|critical|essential|مهم|أساسي|حاسم)\b",
        gesture_name="point",
        priority_boost=3,
        description="Emphatic statement",
    ),
    ContextualTrigger(
        pattern=r"\b(remember|don't forget|pay attention|تذكر|انتبه|لا تنسى)\b",
        gesture_name="point",
        side="right",
        priority_boost=3,
        description="Attention-grabbing",
    ),
    ContextualTrigger(
        pattern=r"\b(excellent|great job|well done|perfect|ممتاز|رائع|أحسنت)\b",
        gesture_name="clap",
        priority_boost=4,
        description="Celebration",
    ),
    ContextualTrigger(
        pattern=r"\b(congratulations|يهانينا|مبروك)\b",
        gesture_name="cheer",
        priority_boost=5,
        description="Strong celebration",
    ),
    ContextualTrigger(
        pattern=r"\b(yes|correct|exactly|right|نعم|صحيح|بالضبط)\b",
        gesture_name="nod",
        priority_boost=2,
        description="Agreement",
    ),
    ContextualTrigger(
        pattern=r"\b(I agree|أوافق|أتفق)\b",
        gesture_name="nod",
        priority_boost=3,
        description="Strong agreement",
    ),
    ContextualTrigger(
        pattern=r"\b(maybe|perhaps|possibly|ربما|من الممكن|قد يكون)\b",
        gesture_name="shrug",
        priority_boost=2,
        description="Uncertainty",
    ),
    ContextualTrigger(
        pattern=r"\b(I don't know|not sure|لا أعرف|غير متأكد)\b",
        gesture_name="shrug",
        priority_boost=3,
        description="Strong uncertainty",
    ),
    ContextualTrigger(
        pattern=r"\b(let me think|hmm|interesting question|دعني أفكر|سؤال مثير)\b",
        gesture_name="think",
        priority_boost=3,
        description="Deep thought",
    ),
    ContextualTrigger(
        pattern=r"\b(welcome|come|let me show you|مرحباً|تعال|دعني أريك)\b",
        gesture_name="openHand",
        side="both",
        priority_boost=3,
        description="Welcoming gesture",
    ),
    ContextualTrigger(
        pattern=r"\b(first|firstly|أولاً|أول شيء)\b",
        gesture_name="point",
        side="left",
        priority_boost=2,
        description="First item in list",
    ),
    ContextualTrigger(
        pattern=r"\b(second|secondly|ثانياً|ثاني شيء)\b",
        gesture_name="point",
        side="right",
        priority_boost=2,
        description="Second item in list",
    ),
]


class ContextualGestureAnalyzer:
    """Analyzes text for contextual gesture triggers."""

    def __init__(self, repertoire: Optional[GestureRepertoire] = None) -> None:
        self._enabled = os.getenv("COGNI_ENABLE_CONTEXTUAL_GESTURES", "true").lower() in (
            "true",
            "1",
            "yes",
        )
        self._repertoire = repertoire or get_repertoire()
        self._triggers = _CONTEXTUAL_TRIGGERS

    @property
    def enabled(self) -> bool:
        return self._enabled

    def analyze(self, text: str) -> List[ContextualGestureMatch]:
        if not self._enabled or not text:
            return []

        matches: List[ContextualGestureMatch] = []
        text_lower = text.lower()

        for trigger in self._triggers:
            if self._repertoire.get(trigger.gesture_name) is None:
                continue
            pattern = re.compile(trigger.pattern, re.IGNORECASE | re.UNICODE)
            for match in pattern.finditer(text_lower):
                matches.append(
                    ContextualGestureMatch(
                        trigger=trigger,
                        matched_text=match.group(0),
                        position=match.start(),
                        confidence=1.0,
                    )
                )

        matches.sort(key=lambda m: m.position)
        return self._deduplicate_matches(matches)

    def _deduplicate_matches(
        self,
        matches: List[ContextualGestureMatch],
        position_threshold: int = 30,
    ) -> List[ContextualGestureMatch]:
        if len(matches) <= 1:
            return matches

        result: List[ContextualGestureMatch] = []
        used_positions: Set[Tuple[str, int]] = set()

        for match in matches:
            gesture_name = match.trigger.gesture_name
            pos_bucket = match.position // position_threshold
            key = (gesture_name, pos_bucket)
            if key not in used_positions:
                result.append(match)
                used_positions.add(key)

        return result

    def add_trigger(self, trigger: ContextualTrigger) -> None:
        self._triggers.append(trigger)

    def get_triggers_for_gesture(self, gesture_name: str) -> List[ContextualTrigger]:
        return [t for t in self._triggers if t.gesture_name == gesture_name]


_analyzer_instance: Optional[ContextualGestureAnalyzer] = None


def get_contextual_analyzer() -> ContextualGestureAnalyzer:
    global _analyzer_instance
    if _analyzer_instance is None:
        _analyzer_instance = ContextualGestureAnalyzer()
    return _analyzer_instance
