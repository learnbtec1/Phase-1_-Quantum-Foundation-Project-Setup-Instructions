# -*- coding: utf-8 -*-
"""Ephemeral BTEC criterion progress in Redis (session-scoped; TTL)."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

_CODE_RE = re.compile(r"^[PMD]\d+$", re.I)
_TTL_SEC = int(os.getenv("COGNI_BTEC_REDIS_TTL_SEC", "1209600"))  # 14d default


def _key(user_key: str, assignment_id: str, criterion_code: str) -> str:
    return f"btec:{user_key}:{assignment_id}:{criterion_code.upper()}"


def store_criterion_update(
    *,
    user_key: str,
    assignment_id: str,
    criterion_code: str,
    status: str,
    evidence: str = "",
) -> bool:
    code = criterion_code.strip().upper()
    if not _CODE_RE.match(code):
        logger.warning("[BtecProgress] invalid criterion code %r", criterion_code)
        return False
    aid = (assignment_id or "").strip()[:160]
    if not aid:
        return False
    r = get_redis()
    if not r:
        logger.warning("[BtecProgress] Redis unavailable — criterion not persisted")
        return False
    uk = (user_key or "guest")[:128]
    payload = {
        "criterion_code": code,
        "status": status,
        "evidence": (evidence or "")[:2000],
        "updated_at": int(time.time()),
    }
    try:
        r.setex(_key(uk, aid, code), _TTL_SEC, json.dumps(payload, ensure_ascii=False))
        return True
    except Exception as e:
        logger.error("[BtecProgress] Redis set failed: %s", e)
        return False


def load_all_for_assignment(user_key: str, assignment_id: str) -> Dict[str, Dict[str, Any]]:
    """Best-effort scan of known pattern — optional; HUD merges incremental updates."""
    _ = (user_key, assignment_id)
    return {}
