# -*- coding: utf-8 -*-
"""Cross-device session snapshot in Redis (V28)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

PREFIX = "cogni:session:"


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
