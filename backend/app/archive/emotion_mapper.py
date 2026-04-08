# -*- coding: utf-8 -*-
"""
emotion_mapper.py
─────────────────
Emotional Mapping Module for Cogni Digital Human.

Maps emotion labels and intensity values to:
  - VRM facial blend shapes (morph targets)
  - Gesture scale factors
  - Emotional transitions (lerp parameters)

This enables dynamic facial expressions that match emotional intensity
and smooth transitions between emotional states.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class FacialBlendShape(BaseModel):
    """A single facial blend shape (morph target) with intensity."""
    name: str = Field(..., description="VRM blend shape name (e.g., 'happy', 'aa', 'ih')")
    value: float = Field(0.0, ge=0.0, le=1.0, description="Target value 0-1")


class EmotionalState(BaseModel):
    """Complete emotional state with facial expressions and gesture modifiers."""
    emotion: str
    intensity: float = Field(0.5, ge=0.0, le=1.0)
    blend_shapes: List[FacialBlendShape] = Field(default_factory=list)
    gesture_scale: float = Field(1.0, ge=0.3, le=1.5, description="Gesture amplitude multiplier")
    transition_speed: float = Field(0.15, ge=0.05, le=0.5, description="Lerp factor for smooth transitions")


# ════════════════════════════════════════════════════════════
# VRM Blend Shape Mappings
# ════════════════════════════════════════════════════════════
_EMOTION_BLEND_MAP: Dict[str, Dict[str, float]] = {
    "happy": {
        "happy": 0.8,
        "relaxed": 0.3,
        "aa": 0.2,
    },
    "friendly": {
        "happy": 0.5,
        "relaxed": 0.6,
        "aa": 0.1,
    },
    "excited": {
        "happy": 0.95,
        "surprised": 0.4,
        "aa": 0.3,
    },
    "sad": {
        "sad": 0.85,
        "relaxed": 0.2,
    },
    "concerned": {
        "sad": 0.5,
        "angry": 0.2,
    },
    "angry": {
        "angry": 0.9,
        "sad": 0.1,
    },
    "surprised": {
        "surprised": 0.9,
        "aa": 0.4,
        "oh": 0.3,
    },
    "thinking": {
        "relaxed": 0.4,
        "lookUp": 0.3,
        "angry": 0.15,
    },
    "attentive": {
        "relaxed": 0.5,
        "happy": 0.2,
    },
    "neutral": {
        "relaxed": 0.4,
    },
    "encouraging": {
        "happy": 0.7,
        "relaxed": 0.4,
        "aa": 0.15,
    },
    "skeptical": {
        "angry": 0.4,
        "sad": 0.2,
    },
}


def _intensity_scale(intensity: float) -> float:
    return 0.3 + (intensity * 1.0)


def _gesture_scale_from_intensity(intensity: float, emotion: str) -> float:
    base_scale = 0.5 + (intensity * 0.7)
    if emotion in ("excited", "angry", "surprised"):
        base_scale *= 1.15
    elif emotion in ("sad", "concerned"):
        base_scale *= 0.8
    elif emotion in ("thinking", "attentive"):
        base_scale *= 0.85
    return max(0.3, min(1.5, base_scale))


class EmotionMapper:
    """Main emotion mapping service."""

    def __init__(self) -> None:
        self._enabled = os.getenv("COGNI_ENABLE_EMOTIONAL_MAPPING", "true").lower() in (
            "true",
            "1",
            "yes",
        )
        self._blend_map = _EMOTION_BLEND_MAP

    @property
    def enabled(self) -> bool:
        return self._enabled

    def map_emotion_intensity(
        self,
        emotion: str,
        intensity: Optional[float] = None,
    ) -> EmotionalState:
        if not self._enabled:
            return EmotionalState(emotion=emotion, intensity=0.5)

        if intensity is None:
            intensity = 0.5
        intensity = max(0.0, min(1.0, intensity))

        base_blends = self._blend_map.get(emotion, self._blend_map.get("neutral", {}))
        scale = _intensity_scale(intensity)
        blend_shapes = [
            FacialBlendShape(name=name, value=min(1.0, value * scale))
            for name, value in base_blends.items()
        ]
        gesture_scale = _gesture_scale_from_intensity(intensity, emotion)
        transition_speed = 0.1 + (intensity * 0.15)

        return EmotionalState(
            emotion=emotion,
            intensity=intensity,
            blend_shapes=blend_shapes,
            gesture_scale=gesture_scale,
            transition_speed=transition_speed,
        )

    def get_available_emotions(self) -> List[str]:
        return list(self._blend_map.keys())

    def add_custom_mapping(self, emotion: str, blend_map: Dict[str, float]) -> None:
        self._blend_map[emotion] = blend_map


_mapper_instance: Optional[EmotionMapper] = None


def get_emotion_mapper() -> EmotionMapper:
    global _mapper_instance
    if _mapper_instance is None:
        _mapper_instance = EmotionMapper()
    return _mapper_instance
