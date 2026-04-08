# -*- coding: utf-8 -*-
"""
gesture_repertoire.py
─────────────────────
سجل الإيماءات المتاحة في مشروع كوجني.
تتطابق الأسماء مع مفاتيح الواجهة (VRMA / animationMap) حيث أمكن.
"""

from __future__ import annotations

import json
import logging
import os
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class GestureChannel(str, Enum):
    MICRO = "micro"
    UPPER = "upper"
    FULL = "full"


class GestureSide(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    BOTH = "both"
    NONE = "none"


class GestureDefinition(BaseModel):
    name: str
    channel: GestureChannel
    default_duration_ms: int = Field(1000, ge=200, le=5000)
    min_duration_ms: int = Field(400, ge=200)
    max_duration_ms: int = Field(2500, le=5000)
    allowed_sides: List[GestureSide] = Field(default_factory=lambda: [GestureSide.NONE])
    cooldown_seconds: float = Field(5.0, ge=0.0)
    default_priority: int = Field(5, ge=1, le=10)
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    # ═══ NEW ═══
    contextual_triggers: List[str] = Field(
        default_factory=list,
        description="Keywords that trigger this gesture contextually",
    )


_BUILTIN_GESTURES: List[dict] = [
    {
        "name": "wave",
        "channel": "upper",
        "default_duration_ms": 1200,
        "min_duration_ms": 800,
        "max_duration_ms": 2000,
        "allowed_sides": ["right", "both"],
        "cooldown_seconds": 8.0,
        "default_priority": 6,
        "description": "موجة ترحيب",
        "tags": ["welcoming", "greeting", "farewell", "friendly"],
    },
    {
        "name": "beckon",
        "channel": "upper",
        "default_duration_ms": 1200,
        "min_duration_ms": 700,
        "max_duration_ms": 1800,
        "allowed_sides": ["right"],
        "cooldown_seconds": 6.0,
        "default_priority": 5,
        "description": "إشارة تعال",
        "tags": ["welcoming", "encouragement", "friendly"],
    },
    {
        "name": "openHand",
        "channel": "upper",
        "default_duration_ms": 1000,
        "min_duration_ms": 600,
        "max_duration_ms": 1500,
        "allowed_sides": ["right", "left", "both"],
        "cooldown_seconds": 4.0,
        "default_priority": 5,
        "description": "كف مفتوح",
        "tags": ["presenting", "explaining", "welcoming"],
    },
    {
        "name": "point",
        "channel": "upper",
        "default_duration_ms": 1000,
        "min_duration_ms": 600,
        "max_duration_ms": 1800,
        "allowed_sides": ["right", "left"],
        "cooldown_seconds": 5.0,
        "default_priority": 6,
        "description": "إشارة توضيح",
        "tags": ["presenting", "explaining", "question", "thinking"],
    },
    {
        "name": "think",
        "channel": "upper",
        "default_duration_ms": 1400,
        "min_duration_ms": 800,
        "max_duration_ms": 2200,
        "allowed_sides": ["right", "none"],
        "cooldown_seconds": 6.0,
        "default_priority": 5,
        "description": "تفكير",
        "tags": ["thinking", "question", "curious"],
    },
    {
        "name": "clap",
        "channel": "upper",
        "default_duration_ms": 1100,
        "min_duration_ms": 700,
        "max_duration_ms": 2000,
        "allowed_sides": ["both", "right"],
        "cooldown_seconds": 8.0,
        "default_priority": 7,
        "description": "تصفيق",
        "tags": ["happy", "encouragement", "friendly", "welcoming"],
    },
    {
        "name": "cheer",
        "channel": "upper",
        "default_duration_ms": 1200,
        "min_duration_ms": 700,
        "max_duration_ms": 2200,
        "allowed_sides": ["both", "right"],
        "cooldown_seconds": 8.0,
        "default_priority": 7,
        "description": "تهنئة/حماس",
        "tags": ["happy", "encouragement", "welcoming"],
    },
    {
        "name": "shrug",
        "channel": "upper",
        "default_duration_ms": 900,
        "min_duration_ms": 500,
        "max_duration_ms": 1500,
        "allowed_sides": ["both", "none"],
        "cooldown_seconds": 5.0,
        "default_priority": 4,
        "description": "لا أدري / تردد",
        "tags": ["thinking", "neutral", "question"],
    },
    {
        "name": "nod",
        "channel": "upper",
        "default_duration_ms": 600,
        "min_duration_ms": 300,
        "max_duration_ms": 1000,
        "allowed_sides": ["none"],
        "cooldown_seconds": 2.5,
        "default_priority": 4,
        "description": "إيماءة رأس",
        "tags": ["agreement", "acknowledgment", "attentive"],
    },
    {
        "name": "agree",
        "channel": "upper",
        "default_duration_ms": 800,
        "min_duration_ms": 500,
        "max_duration_ms": 1200,
        "allowed_sides": ["right"],
        "cooldown_seconds": 5.0,
        "default_priority": 5,
        "description": "موافقة",
        "tags": ["agreement", "encouragement"],
    },
    {
        "name": "ack",
        "channel": "upper",
        "default_duration_ms": 800,
        "min_duration_ms": 500,
        "max_duration_ms": 1200,
        "allowed_sides": ["right"],
        "cooldown_seconds": 4.0,
        "default_priority": 4,
        "description": "استيعاب",
        "tags": ["acknowledgment", "thinking"],
    },
    {
        "name": "look",
        "channel": "upper",
        "default_duration_ms": 1000,
        "min_duration_ms": 500,
        "max_duration_ms": 2000,
        "allowed_sides": ["left", "right"],
        "cooldown_seconds": 4.0,
        "default_priority": 3,
        "description": "نظر",
        "tags": ["directing", "thinking", "curious"],
    },
    {
        "name": "relax",
        "channel": "full",
        "default_duration_ms": 2000,
        "min_duration_ms": 1000,
        "max_duration_ms": 3000,
        "allowed_sides": ["none"],
        "cooldown_seconds": 8.0,
        "default_priority": 3,
        "description": "استرخاء",
        "tags": ["calm", "neutral", "listening"],
    },
    {
        "name": "halfSmile",
        "channel": "micro",
        "default_duration_ms": 500,
        "min_duration_ms": 200,
        "max_duration_ms": 1000,
        "allowed_sides": ["both"],
        "cooldown_seconds": 3.0,
        "default_priority": 3,
        "description": "ابتسامة خفيفة",
        "tags": ["friendly", "happy", "agreement"],
    },
    {
        "name": "eyebrowRaise",
        "channel": "micro",
        "default_duration_ms": 400,
        "min_duration_ms": 200,
        "max_duration_ms": 800,
        "allowed_sides": ["both"],
        "cooldown_seconds": 3.0,
        "default_priority": 3,
        "description": "رفع حاجب",
        "tags": ["surprised", "question", "curious"],
    },
    {
        "name": "squint",
        "channel": "micro",
        "default_duration_ms": 400,
        "min_duration_ms": 200,
        "max_duration_ms": 700,
        "allowed_sides": ["both"],
        "cooldown_seconds": 3.0,
        "default_priority": 3,
        "description": "تضييق عينين",
        "tags": ["thinking", "concentrating"],
    },
    {
        "name": "blink",
        "channel": "micro",
        "default_duration_ms": 200,
        "min_duration_ms": 200,
        "max_duration_ms": 400,
        "allowed_sides": ["both"],
        "cooldown_seconds": 1.5,
        "default_priority": 2,
        "description": "غمزة",
        "tags": ["transitional", "neutral"],
    },
]


class GestureRepertoire:
    def __init__(self, config_path: Optional[str] = None):
        self._gestures: Dict[str, GestureDefinition] = {}
        self._load(config_path)

    def _load(self, config_path: Optional[str] = None) -> None:
        loaded = False
        if config_path and os.path.isfile(config_path):
            try:
                with open(config_path, encoding="utf-8") as f:
                    data = json.load(f)
                items = data.get("gestures", data if isinstance(data, list) else [])
                for item in items:
                    g = GestureDefinition(**item)
                    self._gestures[g.name] = g
                loaded = True
            except Exception as e:
                logger.warning("[GestureRepertoire] failed to load %s: %s", config_path, e)
        if not loaded:
            for item in _BUILTIN_GESTURES:
                g = GestureDefinition(**item)
                self._gestures[g.name] = g

    def get(self, name: str) -> Optional[GestureDefinition]:
        return self._gestures.get(name)

    def all_gestures(self) -> List[GestureDefinition]:
        return list(self._gestures.values())

    def names(self) -> List[str]:
        return list(self._gestures.keys())

    def by_channel(self, channel: GestureChannel) -> List[GestureDefinition]:
        return [g for g in self._gestures.values() if g.channel == channel]

    def by_tag(self, tag: str) -> List[GestureDefinition]:
        return [g for g in self._gestures.values() if tag in g.tags]


_REPERTOIRE_INSTANCE: Optional[GestureRepertoire] = None


def get_repertoire(config_path: Optional[str] = None) -> GestureRepertoire:
    global _REPERTOIRE_INSTANCE
    if _REPERTOIRE_INSTANCE is None:
        default_json = Path(__file__).resolve().parent.parent / "config" / "gesture_repertoire.json"
        path = config_path or (str(default_json) if default_json.is_file() else None)
        _REPERTOIRE_INSTANCE = GestureRepertoire(path)
    return _REPERTOIRE_INSTANCE


def reset_repertoire_for_tests() -> None:
    global _REPERTOIRE_INSTANCE
    _REPERTOIRE_INSTANCE = None
