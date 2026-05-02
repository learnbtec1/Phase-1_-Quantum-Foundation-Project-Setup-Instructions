# -*- coding: utf-8 -*-
"""
Optional Redis connections for app features. Lazy init, bounded timeouts, short retries.

Used by A/B grader metrics when ASSESSMENT_AB_USE_REDIS and REDIS_URL/ASSESSMENT_REDIS_URL are set.
Does not import grading or billing code.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_grader_ab_client: Any = None
_GRADER_AB_RETRIES = 3


def _resolve_redis_url() -> str:
    return (
        (getattr(settings, "ASSESSMENT_REDIS_URL", None) or getattr(settings, "REDIS_URL", None) or "")
        .strip()
    )


def get_grader_ab_redis() -> Optional[Any]:
    """
    Return a process-wide Redis client for A/B metrics, or None (caller uses JSON).

    Gated by ASSESSMENT_AB_USE_REDIS. Safe for multi-worker: each process has one client; server holds truth.
    """
    if not getattr(settings, "ASSESSMENT_AB_USE_REDIS", True):
        return None
    url = _resolve_redis_url()
    if not url:
        return None

    global _grader_ab_client
    with _lock:
        if _grader_ab_client is not None:
            try:
                _grader_ab_client.ping()
                return _grader_ab_client
            except Exception:
                logger.debug("grader_ab redis: ping failed, reconnecting")
                try:
                    _grader_ab_client.close()
                except Exception:
                    pass
                _grader_ab_client = None

        last_err: Optional[Exception] = None
        for attempt in range(_GRADER_AB_RETRIES):
            try:
                import redis as redis_lib  # type: ignore[import-not-found]

                try:
                    st = float(getattr(settings, "ASSESSMENT_REDIS_SOCKET_TIMEOUT", 2.0) or 2.0)
                except (TypeError, ValueError):
                    st = 2.0
                _grader_ab_client = redis_lib.from_url(  # type: ignore[assignment]
                    url,
                    decode_responses=True,
                    socket_connect_timeout=min(st, 5.0),
                    socket_timeout=st,
                )
                _grader_ab_client.ping()
                logger.info("redis_client: grader A/B Redis connected")
                return _grader_ab_client
            except Exception as e:
                last_err = e
                if attempt < _GRADER_AB_RETRIES - 1:
                    time.sleep(0.1 * (attempt + 1))
        logger.warning("redis_client: grader A/B Redis unavailable (%s) — JSON fallback for A/B", last_err)
        _grader_ab_client = None
        return None
