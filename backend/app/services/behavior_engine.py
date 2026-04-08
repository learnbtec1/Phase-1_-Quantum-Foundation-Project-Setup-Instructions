# -*- coding: utf-8 -*-
"""
behavior_engine.py
──────────────────
محرك سلوك اختياري: قواعد مرجحة + قابل لتبديل الاستراتيجية (مثلاً LLM لاحقاً).
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from abc import ABC, abstractmethod
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from pydantic import BaseModel, Field

from app.archive.contextual_gesture_analyzer import (
    ContextualGestureMatch,
    get_contextual_analyzer,
)
from app.archive.emotion_mapper import EmotionalState, get_emotion_mapper
from app.archive.gesture_repertoire import (
    GestureChannel,
    GestureDefinition,
    GestureRepertoire,
    GestureSide,
    get_repertoire,
)

logger = logging.getLogger(__name__)


class BehaviorContext(BaseModel):
    emotion: str = "neutral"
    intent: str = "statement"
    user_text: str = ""
    reply_text: str = ""
    conversation_turn: int = 0
    speech_duration_ms: int = 3000


class GestureProposal(BaseModel):
    type: str
    side: str = "none"
    start_offset_ms: int = 400
    duration_ms: int = 1000
    priority: int = 5
    channel: str = "upper"
    critical_timing: bool = Field(
        False,
        description="When True, client may schedule without extra playback-start delay (urgent cues).",
    )
    # ═══ NEW ═══
    scale_factor: float = Field(
        1.0,
        ge=0.3,
        le=1.5,
        description="Gesture amplitude/size multiplier",
    )


class MicroExpressionProposal(BaseModel):
    type: str
    start_offset_ms: int = 100
    duration_ms: int = 400
    intensity: float = 0.7


class GazeProposal(BaseModel):
    target: str = "user"
    start_offset_ms: int = 0
    duration_ms: int = 2000


class PostureHint(BaseModel):
    type: str = "neutral"
    intensity: float = 0.5


class BehaviorPlan(BaseModel):
    model_config = {"extra": "allow"}

    gestures: List[GestureProposal] = Field(default_factory=list)
    micro_expressions: List[MicroExpressionProposal] = Field(default_factory=list)
    gaze: List[GazeProposal] = Field(default_factory=list)
    posture: Optional[PostureHint] = None
    # ═══ NEW ═══
    emotional_state: Optional[EmotionalState] = None
    debug_info: Dict[str, Any] = Field(default_factory=dict)

    def to_ws_payload(self) -> Dict[str, Any]:
        """مخرجات متوافقة مع normalizeAvatarBehavior في الواجهة (start_ms / duration_ms / micro_expressions)."""
        out: Dict[str, Any] = {
            "gestures": [],
            "micro_expressions": [],
            "gaze": [],
        }
        for g in self.gestures:
            pr01 = max(0.0, min(1.0, g.priority / 10.0))
            out["gestures"].append(
                {
                    "type": g.type,
                    "side": g.side,
                    "start_ms": g.start_offset_ms,
                    "startOffsetMs": g.start_offset_ms,
                    "duration_ms": g.duration_ms,
                    "durationMs": g.duration_ms,
                    "channel": g.channel,
                    "priority": pr01,
                    "critical_timing": g.critical_timing,
                    # ═══ NEW ═══
                    "scale_factor": g.scale_factor,
                }
            )
        for m in self.micro_expressions:
            out["micro_expressions"].append(
                {
                    "type": m.type,
                    "start_ms": m.start_offset_ms,
                    "startOffsetMs": m.start_offset_ms,
                    "duration_ms": m.duration_ms,
                    "durationMs": m.duration_ms,
                    "intensity": m.intensity,
                }
            )
        for gz in self.gaze:
            out["gaze"].append(
                {
                    "target": gz.target,
                    "start_ms": gz.start_offset_ms,
                    "startOffsetMs": gz.start_offset_ms,
                    "duration_ms": gz.duration_ms,
                    "durationMs": gz.duration_ms,
                }
            )
        if self.posture:
            out["posture"] = self.posture.model_dump()
        # ═══ NEW ═══
        if self.emotional_state:
            out["emotional_state"] = self.emotional_state.model_dump()
        return out


class CooldownManager:
    def __init__(self, max_history: int = 50) -> None:
        self._history: Dict[str, Deque[float]] = {}
        self._recent: Deque[str] = deque(maxlen=20)
        self._max_history = max_history

    def record(self, gesture_name: str) -> None:
        now = time.time()
        if gesture_name not in self._history:
            self._history[gesture_name] = deque(maxlen=5)
        self._history[gesture_name].append(now)
        self._recent.append(gesture_name)

    def is_on_cooldown(self, gesture_name: str, cooldown_seconds: float) -> bool:
        if gesture_name not in self._history or not self._history[gesture_name]:
            return False
        last_use = self._history[gesture_name][-1]
        return (time.time() - last_use) < cooldown_seconds

    def recency_penalty(self, gesture_name: str) -> float:
        for i, name in enumerate(reversed(list(self._recent))):
            if name == gesture_name:
                return max(0.0, 1.0 - (i * 0.2))
        return 0.0


class BehaviorStrategy(ABC):
    """استبدل بتنفيذ يعتمد على LLM أو نموذج آخر."""

    @abstractmethod
    def decide(
        self,
        context: BehaviorContext,
        repertoire: GestureRepertoire,
        cooldowns: CooldownManager,
    ) -> BehaviorPlan:
        raise NotImplementedError


class WeightedRuleStrategy(BehaviorStrategy):
    def __init__(self, rules_path: Optional[str] = None):
        self.rules = self._load_rules(rules_path)

    def _load_rules(self, rules_path: Optional[str] = None) -> Dict[str, Any]:
        default: Dict[str, Any] = {
            "weights": {
                "emotion_match": 3.0,
                "intent_match": 2.5,
                "first_turn_bonus": 1.5,
                "recency_penalty": -2.0,
                "random_jitter": 0.5,
            },
            "timing": {
                "gesture_start_offset_min_ms": 300,
                "gesture_start_offset_max_ms": 500,
                "micro_start_offset_min_ms": 50,
                "micro_start_offset_max_ms": 200,
                "gaze_start_offset_ms": 0,
                "subsequent_gesture_gap_ms": 800,
            },
            "limits": {
                "max_gestures_per_turn": 2,
                "max_micros_per_turn": 2,
                "min_score_threshold": 1.0,
                "short_reply_max_gestures": 1,
                "short_reply_char_threshold": 40,
            },
            "emotion_tag_map": {
                "friendly": ["friendly", "welcoming", "presenting", "agreement"],
                "happy": ["happy", "friendly", "welcoming"],
                "sad": ["sad"],
                "angry": ["angry"],
                "surprised": ["surprised", "curious"],
                "thinking": ["thinking", "curious", "question"],
                "attentive": ["attentive", "acknowledgment"],
                "neutral": ["neutral", "transitional"],
                "encouraging": ["encouragement", "friendly", "happy", "welcoming"],
            },
            "intent_tag_map": {
                "question": ["question", "curious", "thinking"],
                "statement": ["presenting", "explaining"],
                "greeting": ["greeting", "welcoming", "friendly"],
                "farewell": ["farewell", "welcoming"],
                "agreement": ["agreement", "acknowledgment", "friendly"],
                "encouragement": ["encouragement", "friendly", "happy"],
            },
            "posture_map": {
                "attentive": {"type": "listeningLean", "intensity": 0.5},
                "thinking": {"type": "thinkingUpward", "intensity": 0.6},
                "happy": {"type": "excited", "intensity": 0.4},
                "neutral": {"type": "neutral", "intensity": 0.5},
            },
        }
        paths = [p for p in [rules_path] if p]
        paths.append(str(Path(__file__).resolve().parent.parent / "config" / "gesture_rules.json"))
        for p in paths:
            if p and os.path.isfile(p):
                try:
                    with open(p, encoding="utf-8") as f:
                        data = json.load(f)
                    for k, v in data.items():
                        if isinstance(v, dict) and isinstance(default.get(k), dict):
                            default[k].update(v)
                        else:
                            default[k] = v
                    logger.info("[BehaviorEngine] loaded rules from %s", p)
                    break
                except Exception as e:
                    logger.warning("[BehaviorEngine] failed to load %s: %s", p, e)
        return default

    def _score_gesture(
        self,
        gesture: GestureDefinition,
        context: BehaviorContext,
        cooldowns: CooldownManager,
    ) -> float:
        if cooldowns.is_on_cooldown(gesture.name, gesture.cooldown_seconds):
            return -999.0

        score = 0.0
        w = self.rules["weights"]
        emotion_tags = self.rules["emotion_tag_map"].get(context.emotion, [])
        score += len(set(gesture.tags) & set(emotion_tags)) * w["emotion_match"]

        intent_tags = self.rules["intent_tag_map"].get(context.intent, [])
        score += len(set(gesture.tags) & set(intent_tags)) * w["intent_match"]

        if context.conversation_turn == 0 and any(t in gesture.tags for t in ("welcoming", "greeting")):
            score += w["first_turn_bonus"]

        score += cooldowns.recency_penalty(gesture.name) * w["recency_penalty"]
        score += random.uniform(0, w["random_jitter"])
        return score

    def decide(
        self,
        context: BehaviorContext,
        repertoire: GestureRepertoire,
        cooldowns: CooldownManager,
    ) -> BehaviorPlan:
        limits = self.rules["limits"]
        timing = self.rules["timing"]

        # ═══ NEW ═══
        emotion_mapper = get_emotion_mapper()
        emotional_state = emotion_mapper.map_emotion_intensity(
            context.emotion,
            intensity=0.7,
        )
        contextual_analyzer = get_contextual_analyzer()
        contextual_matches = contextual_analyzer.analyze(context.reply_text)
        # ═══ NEW END ═══

        is_short = len(context.reply_text) < int(limits["short_reply_char_threshold"])
        max_gestures = int(limits["short_reply_max_gestures"] if is_short else limits["max_gestures_per_turn"])

        scored: List[tuple[float, GestureDefinition]] = []
        min_thr = float(limits["min_score_threshold"])
        for g in repertoire.all_gestures():
            s = self._score_gesture(g, context, cooldowns)
            # ═══ NEW ═══
            s += self._contextual_score_boost(g, contextual_matches)
            # ═══ NEW END ═══
            if s >= min_thr:
                scored.append((s, g))

        scored.sort(key=lambda x: x[0], reverse=True)

        selected_upper: List[tuple[float, GestureDefinition]] = []
        selected_micro: List[tuple[float, GestureDefinition]] = []
        for s, g in scored:
            if g.channel == GestureChannel.MICRO and len(selected_micro) < int(limits["max_micros_per_turn"]):
                selected_micro.append((s, g))
            elif g.channel in (GestureChannel.UPPER, GestureChannel.FULL) and len(selected_upper) < max_gestures:
                selected_upper.append((s, g))

        gestures: List[GestureProposal] = []
        current_offset = random.randint(
            int(timing["gesture_start_offset_min_ms"]),
            int(timing["gesture_start_offset_max_ms"]),
        )
        for _, g in selected_upper:
            sides = g.allowed_sides or [GestureSide.NONE]
            # ═══ NEW ═══
            ctx_side = self._contextual_side_for_gesture(g, contextual_matches)
            side = ctx_side if ctx_side is not None else random.choice(sides)
            scale_factor = self._get_gesture_scale(g, contextual_matches, emotional_state)
            # ═══ NEW END ═══
            duration = random.randint(int(g.min_duration_ms), int(min(g.default_duration_ms, g.max_duration_ms)))
            goff = current_offset
            if g.channel == GestureChannel.FULL:
                goff = max(int(timing["gesture_start_offset_min_ms"]), min(goff, 520))
            critical_timing = "stop" in (g.name or "").lower() or "halt" in (g.name or "").lower()
            gestures.append(
                GestureProposal(
                    type=g.name,
                    side=side.value,
                    start_offset_ms=goff,
                    duration_ms=duration,
                    priority=g.default_priority,
                    channel=g.channel.value,
                    critical_timing=critical_timing,
                    scale_factor=scale_factor,
                )
            )
            cooldowns.record(g.name)
            current_offset += duration + int(timing["subsequent_gesture_gap_ms"])

        micros: List[MicroExpressionProposal] = []
        micro_off = random.randint(
            int(timing["micro_start_offset_min_ms"]),
            int(timing["micro_start_offset_max_ms"]),
        )
        for _, g in selected_micro:
            duration = random.randint(int(g.min_duration_ms), int(min(g.default_duration_ms, g.max_duration_ms)))
            micros.append(
                MicroExpressionProposal(
                    type=g.name,
                    start_offset_ms=micro_off,
                    duration_ms=duration,
                    intensity=random.uniform(0.5, 0.9),
                )
            )
            cooldowns.record(g.name)
            micro_off += duration + 300

        sp = int(context.speech_duration_ms)
        gaze = [
            GazeProposal(
                target="user",
                start_offset_ms=int(timing.get("gaze_start_offset_ms", 0)),
                duration_ms=min(sp, 3000),
            )
        ]
        if sp > 4000:
            gaze.append(GazeProposal(target="away", start_offset_ms=2500, duration_ms=1500))

        posture_cfg = self.rules["posture_map"].get(
            context.emotion,
            self.rules["posture_map"]["neutral"],
        )
        posture = PostureHint(**posture_cfg)

        return BehaviorPlan(
            gestures=gestures,
            micro_expressions=micros,
            gaze=gaze,
            posture=posture,
            emotional_state=emotional_state,
            debug_info={
                "candidates": len(scored),
                "short_reply": is_short,
                "contextual_matches": len(contextual_matches),
                "emotional_intensity": emotional_state.intensity,
            },
        )

    # ═══ NEW ═══
    def _contextual_score_boost(
        self,
        gesture: GestureDefinition,
        matches: List[ContextualGestureMatch],
    ) -> float:
        total_boost = 0.0
        for match in matches:
            if match.trigger.gesture_name == gesture.name:
                total_boost += match.trigger.priority_boost * match.confidence
        return total_boost

    def _contextual_side_for_gesture(
        self,
        gdef: GestureDefinition,
        matches: List[ContextualGestureMatch],
    ) -> Optional[GestureSide]:
        side_map = {
            "left": GestureSide.LEFT,
            "right": GestureSide.RIGHT,
            "both": GestureSide.BOTH,
        }
        for match in matches:
            if match.trigger.gesture_name != gdef.name:
                continue
            raw = match.trigger.side
            if not raw or not isinstance(raw, str):
                continue
            gs = side_map.get(raw.lower())
            if gs is not None and gs in gdef.allowed_sides:
                return gs
        return None

    def _get_gesture_scale(
        self,
        gesture: GestureDefinition,
        contextual_matches: List[ContextualGestureMatch],
        emotional_state: EmotionalState,
    ) -> float:
        for match in contextual_matches:
            if match.trigger.gesture_name == gesture.name and match.trigger.scale_factor is not None:
                return float(match.trigger.scale_factor)
        return float(emotional_state.gesture_scale)
    # ═══ NEW END ═══


class BehaviorEngine:
    def __init__(
        self,
        enabled: Optional[bool] = None,
        strategy: Optional[BehaviorStrategy] = None,
    ):
        if enabled is None:
            self._enabled = os.getenv("COGNI_BEHAVIOR_ENGINE_ENABLED", "false").lower() in (
                "true",
                "1",
                "yes",
            )
        else:
            self._enabled = enabled
        self._repertoire = get_repertoire()
        self._strategy: BehaviorStrategy = strategy or WeightedRuleStrategy()
        self._cooldowns = CooldownManager()
        logger.info(
            "[BehaviorEngine] init enabled=%s gestures=%d",
            self._enabled,
            len(self._repertoire.names()),
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    def set_strategy(self, strategy: BehaviorStrategy) -> None:
        self._strategy = strategy

    def analyze_behavior(self, context: BehaviorContext) -> BehaviorPlan:
        if not self._enabled:
            return BehaviorPlan()
        try:
            start = time.perf_counter()
            plan = self._strategy.decide(context, self._repertoire, self._cooldowns)
            elapsed_ms = (time.perf_counter() - start) * 1000
            plan.debug_info["decision_time_ms"] = round(elapsed_ms, 2)
            return plan
        except Exception as e:
            logger.error("[BehaviorEngine] analyze_behavior failed: %s", e, exc_info=True)
            return BehaviorPlan()

    def reset_cooldowns(self) -> None:
        self._cooldowns = CooldownManager()


_ENGINE_INSTANCE: Optional[BehaviorEngine] = None


def get_behavior_engine() -> BehaviorEngine:
    global _ENGINE_INSTANCE
    if _ENGINE_INSTANCE is None:
        _ENGINE_INSTANCE = BehaviorEngine()
    return _ENGINE_INSTANCE


def reset_behavior_engine_for_tests() -> None:
    global _ENGINE_INSTANCE
    _ENGINE_INSTANCE = None
