# -*- coding: utf-8 -*-
"""
behavior_logger.py
──────────────────
تسجيل قرارات محرك السلوك (JSONL) — قابل للتعطيل عبر COGNI_BEHAVIOR_LOGGING=false
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from app.services.behavior_engine import BehaviorContext, BehaviorPlan

logger = logging.getLogger(__name__)


class BehaviorLogger:
    def __init__(self, log_dir: Optional[str] = None):
        if log_dir:
            self.log_dir = Path(log_dir)
        else:
            self.log_dir = Path(os.getenv("COGNI_BEHAVIOR_LOG_DIR", "logs/behavior"))
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning("[BehaviorLogger] cannot create log dir %s: %s", self.log_dir, e)
        self._enabled = os.getenv("COGNI_BEHAVIOR_LOGGING", "true").lower() in ("true", "1", "yes")

    def log_decision(
        self,
        context: "BehaviorContext",
        plan: "BehaviorPlan",
        session_id: Optional[str] = None,
    ) -> None:
        if not self._enabled:
            return
        try:
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_id": session_id,
                "context": {
                    "emotion": context.emotion,
                    "intent": context.intent,
                    "user_text": (context.user_text or "")[:200],
                    "reply_text": (context.reply_text or "")[:200],
                    "turn": context.conversation_turn,
                },
                "plan": {
                    "gestures": [g.model_dump() for g in plan.gestures],
                    "micros": [m.model_dump() for m in plan.micro_expressions],
                    "debug": plan.debug_info,
                },
            }
            log_file = self.log_dir / f"behavior_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.jsonl"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error("[BehaviorLogger] write failed: %s", e)


_LOGGER_INSTANCE: Optional[BehaviorLogger] = None


def get_behavior_logger() -> BehaviorLogger:
    global _LOGGER_INSTANCE
    if _LOGGER_INSTANCE is None:
        _LOGGER_INSTANCE = BehaviorLogger()
    return _LOGGER_INSTANCE


def reset_behavior_logger_for_tests() -> None:
    global _LOGGER_INSTANCE
    _LOGGER_INSTANCE = None
