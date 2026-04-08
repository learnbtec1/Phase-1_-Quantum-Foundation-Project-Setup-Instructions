# -*- coding: utf-8 -*-
"""
ربط محرك السلوك بمسار WebSocket دون كسر العقد الحالي.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from app.services.behavior_engine import BehaviorContext, get_behavior_engine
from app.archive.behavior_logger import get_behavior_logger
from app.services.cogni_behavior import resolve_behavior_intent


def _map_coarse_intent_to_engine(coarse: str) -> str:
    return {
        "question": "question",
        "gratitude": "agreement",
        "confusion": "statement",
        "neutral": "statement",
    }.get(coarse, "statement")


def _behavior_gestures_empty(behavior: Any) -> bool:
    if behavior is None:
        return True
    if not isinstance(behavior, dict):
        return True
    if behavior.get("gestures"):
        return False
    if behavior.get("gaze"):
        return False
    if behavior.get("microExpressions") or behavior.get("micro_expressions"):
        return False
    return True


def maybe_apply_behavior_engine_to_parsed(
    parsed: Dict[str, Any],
    *,
    user_text: str,
    ws_client_intent: Optional[str],
    reply_meta: Dict[str, Any],
    conversation_turn: int,
    session_id: Optional[str],
) -> None:
    """
    يحدّث parsed[\"behavior\"] عند تفعيل COGNI_BEHAVIOR_ENGINE_ENABLED=true.
    COGNI_BEHAVIOR_ENGINE_WHEN=empty (افتراضي) يملأ فقط إن لم يُرسل LLM إيماءات/نظرات.
    """
    engine = get_behavior_engine()
    if not engine.enabled:
        return

    when = os.getenv("COGNI_BEHAVIOR_ENGINE_WHEN", "empty").strip().lower()
    existing = parsed.get("behavior")
    if when == "empty" and not _behavior_gestures_empty(existing):
        return

    coarse = resolve_behavior_intent(
        parsed,
        user_text or "",
        ws_client_intent=ws_client_intent,
        rule_based_intent=(str(reply_meta.get("rule_based_intent") or "").strip() or None),
    )
    intent = _map_coarse_intent_to_engine(coarse)
    reply = str(parsed.get("dialogue") or "")
    speech_ms = min(120_000, max(2_500, len(reply) * 72))

    ctx = BehaviorContext(
        emotion=str(parsed.get("emotion") or "neutral"),
        intent=intent,
        user_text=user_text or "",
        reply_text=reply,
        conversation_turn=int(conversation_turn),
        speech_duration_ms=int(speech_ms),
    )
    plan = engine.analyze_behavior(ctx)
    payload = plan.to_ws_payload()

    if isinstance(existing, dict) and existing.get("emotion") is not None:
        payload["emotion"] = existing["emotion"]

    parsed["behavior"] = payload
    try:
        get_behavior_logger().log_decision(ctx, plan, session_id=session_id)
    except Exception:
        pass
