# -*- coding: utf-8 -*-
"""Cross-instance Cogni state in Redis (lesson plan, emotional snapshot, Thinker timers)."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, Optional, TYPE_CHECKING

from app.core.redis_client import get_redis

if TYPE_CHECKING:
    from app.services.thinker import AutonomousThinker

logger = logging.getLogger(__name__)

_STATE_TTL_SEC = int(__import__("os").getenv("COGNI_REDIS_STATE_TTL_SEC", "604800"))  # 7d


def _key(user_id: uuid.UUID) -> str:
    return f"user:{user_id}:cogni_state"


def load_state(user_id: uuid.UUID) -> Optional[Dict[str, Any]]:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(_key(user_id))
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.debug("cogni_redis load_state: %s", e)
        return None


def save_state(user_id: uuid.UUID, data: Dict[str, Any]) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(_key(user_id), _STATE_TTL_SEC, json.dumps(data, ensure_ascii=False))
    except Exception as e:
        logger.warning("cogni_redis save_state failed: %s", e)


def build_state_from_emm_and_thinker(emm: Any, thinker: Optional["AutonomousThinker"]) -> Dict[str, Any]:
    snap = {
        "entries": emm._entries[-80:],
        "dialogue_turn_count": emm._dialogue_turn_count,
        "last_user_text": emm.last_user_text,
        "active_lesson_plan": emm.active_lesson_plan,
        "plan_updated_at": emm.plan_updated_at,
        "ts": time.time(),
    }
    if thinker is not None:
        snap["thinker"] = {
            "current_goal": thinker.current_goal,
            "last_proactive_time": thinker.last_proactive_time,
            "proactive_anchor_ts": thinker._proactive_anchor_ts,
            "thinker_cooldown_until": thinker._thinker_cooldown_until,
        }
    return snap


def apply_state_to_emm(emm: Any, data: Dict[str, Any]) -> None:
    if not data:
        return
    try:
        ent = data.get("entries")
        if isinstance(ent, list) and ent:
            emm._entries = ent[-200:]
        emm._dialogue_turn_count = int(data.get("dialogue_turn_count") or 0)
        emm.last_user_text = str(data.get("last_user_text") or "")[:800]
        alp = data.get("active_lesson_plan")
        if isinstance(alp, str) and alp.strip():
            emm.active_lesson_plan = alp.strip()[:8000]
            emm.plan_updated_at = data.get("plan_updated_at")
    except Exception as e:
        logger.debug("apply_state_to_emm: %s", e)


def apply_thinker_state(thinker: "AutonomousThinker", data: Dict[str, Any]) -> None:
    t = data.get("thinker")
    if not isinstance(t, dict):
        return
    try:
        g = t.get("current_goal")
        if isinstance(g, str) and g.strip():
            thinker.current_goal = g.strip()[:240]
        thinker.last_proactive_time = float(t.get("last_proactive_time") or 0)
        thinker._proactive_anchor_ts = float(t.get("proactive_anchor_ts") or 0)
        thinker._thinker_cooldown_until = float(t.get("thinker_cooldown_until") or 0)
    except Exception as e:
        logger.debug("apply_thinker_state: %s", e)
