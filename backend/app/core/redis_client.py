# -*- coding: utf-8 -*-
"""Optional Redis connection (Phase C — horizontal scale)."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

_redis: Any = None  # None=uninitialized, False=unavailable, else client


def get_redis():
    """Return a sync redis client or None if REDIS_URL unset / connection fails."""
    global _redis
    if _redis is False:
        return None
    if _redis is not None:
        return _redis
    url = (os.getenv("REDIS_URL") or "").strip()
    if not url:
        _redis = False
        return None
    try:
        import redis as redis_lib
    except ModuleNotFoundError:
        logger.warning(
            "Redis package not installed — `pip install redis` (see requirements.txt). "
            "Session/state features degrade gracefully without Redis.",
        )
        _redis = False
        return None
    try:
        client = redis_lib.from_url(url, decode_responses=True, socket_connect_timeout=2.0)
        client.ping()
        _redis = client
        logger.info("Redis connected for Cogni state / rate limits")
    except Exception as e:
        logger.warning("Redis unavailable (state stays local/DB): %s", e)
        _redis = False
        return None
    return _redis


def redis_ping() -> bool:
    r = get_redis()
    if not r:
        return False
    try:
        return bool(r.ping())
    except Exception:
        return False
