# -*- coding: utf-8 -*-
"""
Cross-device session snapshot in Redis (V28).

Flow (avatar WebSocket /ws/agent):
- On connect, ``load_session_state(user_id)`` may send a ``session_snapshot`` frame
  to the client (metadata only: last ``session_id``, turn count, persona_level).
- Episodic vector memory for logged-in non-free-tier users is keyed by ``user_id``
  (see ``agent_ws`` ``episodic_scope_id``), so Chroma retrieval survives reconnect
  even though each WS connection gets a new ``session_id`` string.
- On disconnect, ``save_session_state`` stores a small JSON blob (TTL default 14 days).
- Assessment → avatar debrief nudges: ``acknowledge_evaluation_nudge`` / ``is_evaluation_nudge_acknowledged``
  (keys under ``cogni:eval_nudge_ack:``) prevent the same stored evaluation from being re-primed on every
  WebSocket reconnect after the tutor has already delivered that one-shot feedback.

Postgres conversation APIs under ``/api/v1/memory`` are separate from Redis/Chroma;
enable with ``USE_DB`` and related settings.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from typing import Any, Optional

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

PREFIX = "cogni:session:"
# One-shot assessment → avatar nudge: same evaluation must not re-prime after reconnect (TTL weeks).
EVAL_NUDGE_ACK_PREFIX = "cogni:eval_nudge_ack:"
# Optional JSON blobs (SET by other services) consumed once per user via GETDEL on WS connect / turn.
PENDING_ASSESSMENT_NUDGE_PREFIX = "cogni:pending_assessment_nudge:"
PENDING_GRADE_RESULT_PREFIX = "cogni:pending_grade_result:"


def _key(user_id: uuid.UUID) -> str:
    return f"{PREFIX}{user_id}"


def load_session_state(user_id: uuid.UUID) -> Optional[dict[str, Any]]:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(_key(user_id))
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.debug("session_state load: %s", e)
        return None


def save_session_state(user_id: uuid.UUID, data: dict[str, Any], ttl_sec: int = 86400 * 14) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.setex(_key(user_id), ttl_sec, json.dumps(data, ensure_ascii=False, default=str))
    except Exception as e:
        logger.debug("session_state save: %s", e)


def evaluation_nudge_instance_id(snapshot: dict[str, Any]) -> str:
    """Stable id for Redis ack: DB evaluation UUID, or legacy hash of snapshot fields."""
    e = str(snapshot.get("evaluation_id") or "").strip()
    if e:
        return e
    payload = json.dumps(snapshot, sort_keys=True, ensure_ascii=False, default=str)
    return "legacy:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _eval_nudge_ack_redis_key(scope_id: uuid.UUID, instance_id: str) -> str:
    safe = instance_id.replace(":", "_")[:200]
    return f"{EVAL_NUDGE_ACK_PREFIX}{scope_id}:{safe}"


def is_evaluation_nudge_acknowledged(scope_id: uuid.UUID, snapshot: dict[str, Any]) -> bool:
    r = get_redis()
    if not r:
        return False
    try:
        iid = evaluation_nudge_instance_id(snapshot)
        return bool(r.get(_eval_nudge_ack_redis_key(scope_id, iid)))
    except Exception as e:
        logger.debug("eval_nudge_ack check: %s", e)
        return False


def acknowledge_evaluation_nudge(scope_id: uuid.UUID, snapshot: dict[str, Any], ttl_sec: int = 86400 * 14) -> None:
    """Mark this assessment nudge as delivered so reconnect does not re-inject the same debrief."""
    r = get_redis()
    if not r:
        return
    try:
        iid = evaluation_nudge_instance_id(snapshot)
        r.setex(_eval_nudge_ack_redis_key(scope_id, iid), ttl_sec, "1")
    except Exception as e:
        logger.debug("eval_nudge_ack set: %s", e)


def _pop_key(r: Any, key: str) -> Optional[str]:
    """GETDEL if available; else GET + DELETE pipeline."""
    try:
        fn = getattr(r, "getdel", None)
        if callable(fn):
            return fn(key)
    except Exception as _getdel_exc:
        logger.debug("redis getdel unavailable for %s: %s", key, _getdel_exc, exc_info=True)
    try:
        pipe = r.pipeline(transaction=True)
        pipe.get(key)
        pipe.delete(key)
        results = pipe.execute()
        return results[0] if results else None
    except Exception as e:
        logger.warning("redis pop key failed %s: %s", key, e, exc_info=True)
        return None


def pop_nudge(user_id: uuid.UUID) -> Optional[str]:
    """Atomically read and delete pending assessment nudge JSON (one-shot)."""
    r = get_redis()
    if not r:
        return None
    key = f"{PENDING_ASSESSMENT_NUDGE_PREFIX}{user_id}"
    val = _pop_key(r, key)
    if val:
        logger.info("Consumed Redis pending_assessment_nudge for user=%s", user_id)
    return val


def pop_grade_result(user_id: uuid.UUID) -> Optional[str]:
    """Atomically read and delete pending grade-result JSON (one-shot)."""
    r = get_redis()
    if not r:
        return None
    key = f"{PENDING_GRADE_RESULT_PREFIX}{user_id}"
    val = _pop_key(r, key)
    if val:
        logger.info("Consumed Redis pending_grade_result for user=%s", user_id)
    return val
