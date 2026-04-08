# -*- coding: utf-8 -*-
"""Redis-backed rate limits with safe fallback when Redis is down (Phase C + Phase 2).

Multi-instance / horizontal scale: in-process memory fallback is per replica only, so limits
are not shared across instances. For production with more than one API process or pod, run
Redis and set ``RATE_LIMIT_STRICT_REDIS=true`` so missing Redis yields 503 instead of
per-process counters (see env in ``.env.example`` and ``docs/SECURITY_PHASES.md``).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Callable, Optional, Tuple

from fastapi import HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

OPENAI_TOKEN_LIMIT_PER_MINUTE = int(os.getenv("OPENAI_TOKEN_LIMIT_PER_MINUTE", "5000"))
TTS_CALL_LIMIT_PER_HOUR = int(os.getenv("TTS_CALL_LIMIT_PER_HOUR", "30"))
STT_CALL_LIMIT_PER_HOUR = int(os.getenv("STT_CALL_LIMIT_PER_HOUR", "60"))
# Per-user HTTP routes that invoke LLM (chat, eduverse grade/appeal, evaluate-and-speak)
LLM_HTTP_ROUTE_LIMIT_PER_MINUTE = int(os.getenv("LLM_HTTP_ROUTE_LIMIT_PER_MINUTE", "45"))
# Lighter cap for Eduverse read-only GETs (history / audit)
EDUVERSE_READ_LIMIT_PER_MINUTE = int(os.getenv("EDUVERSE_READ_LIMIT_PER_MINUTE", "120"))

# When true and Redis is unavailable, rate-limited routes return 503 instead of in-process limits.
RATE_LIMIT_STRICT_REDIS = os.getenv("RATE_LIMIT_STRICT_REDIS", "").lower() in ("1", "true", "yes")

# If Redis errors mid-request, fall back to memory unless strict (same as unavailable).
_memory_fallback_logged = False
_mem_lock = threading.Lock()
# key -> (count, expires_at_unix)
_memory_counts: dict[str, tuple[int, float]] = {}


def _log_memory_fallback_once() -> None:
    global _memory_fallback_logged
    if not _memory_fallback_logged:
        logger.warning(
            "Rate limit: Redis unavailable — using conservative in-process counters "
            "(per server process; restart clears). Set REDIS_URL for shared limits, "
            "or RATE_LIMIT_STRICT_REDIS=true to return 503 when Redis is required."
        )
        _memory_fallback_logged = True


def _memory_incr(key: str, limit: int, ttl_sec: int) -> Tuple[bool, int]:
    """Fixed-window counter in RAM; ttl_sec bounds key lifetime for cleanup."""
    now = time.time()
    expire_at = now + float(ttl_sec)
    with _mem_lock:
        stale = [k for k, (_, exp) in _memory_counts.items() if exp < now]
        for k in stale[:500]:
            _memory_counts.pop(k, None)
        cur, old_exp = _memory_counts.get(key, (0, expire_at))
        if old_exp < now:
            cur = 0
        cur += 1
        _memory_counts[key] = (cur, max(old_exp, expire_at))
        return cur <= limit, cur


def _bump_counter(redis_key: str, limit: int, ttl_sec: int) -> Tuple[bool, int]:
    """
    Increment a fixed-window counter in Redis, or in-memory if Redis is down.
    Strict mode: no Redis → 503 (no silent unlimited traffic).
    """
    r = get_redis()
    if r is not None:
        try:
            cur = int(r.incr(redis_key))
            if cur == 1:
                r.expire(redis_key, ttl_sec)
            return cur <= limit, cur
        except Exception as e:
            logger.warning("Redis rate limit incr failed (%s); evaluating fallback", e)
            if RATE_LIMIT_STRICT_REDIS:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Rate limit service temporarily unavailable (Redis error).",
                ) from e
            _log_memory_fallback_once()
            return _memory_incr(redis_key, limit, ttl_sec)

    if RATE_LIMIT_STRICT_REDIS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rate limiting requires Redis. Configure REDIS_URL or set RATE_LIMIT_STRICT_REDIS=false.",
        )
    _log_memory_fallback_once()
    return _memory_incr(redis_key, limit, ttl_sec)


def _rl_key(prefix: str, ident: str, window: str) -> str:
    return f"rl:{prefix}:{ident}:{window}"


def assert_llm_http_route_budget(user_id: str) -> None:
    win = int(time.time() // 60)
    key = _rl_key("http_llm", user_id, str(win))
    ok, _ = _bump_counter(key, LLM_HTTP_ROUTE_LIMIT_PER_MINUTE, 120)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"LLM route rate limit exceeded ({LLM_HTTP_ROUTE_LIMIT_PER_MINUTE} requests/minute).",
        )


def assert_eduverse_read_budget(user_id: str) -> None:
    win = int(time.time() // 60)
    key = _rl_key("eduverse_read", user_id, str(win))
    ok, _ = _bump_counter(key, EDUVERSE_READ_LIMIT_PER_MINUTE, 120)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Eduverse read rate limit exceeded ({EDUVERSE_READ_LIMIT_PER_MINUTE}/minute).",
        )


def assert_tts_hourly_budget(user_id: str) -> None:
    win = int(time.time() // 3600)
    key = _rl_key("tts_user", user_id, str(win))
    ok, _ = _bump_counter(key, TTS_CALL_LIMIT_PER_HOUR, 7200)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"TTS hourly limit exceeded ({TTS_CALL_LIMIT_PER_HOUR}/hour).",
        )


def assert_stt_hourly_budget(user_id: str) -> None:
    win = int(time.time() // 3600)
    key = _rl_key("stt_user", user_id, str(win))
    ok, _ = _bump_counter(key, STT_CALL_LIMIT_PER_HOUR, 7200)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"STT hourly limit exceeded ({STT_CALL_LIMIT_PER_HOUR}/hour).",
        )


def minute_token_count(ident: str) -> int:
    """Current token tally for this minute window (no increment)."""
    r = get_redis()
    if not r:
        return 0
    try:
        win = int(time.time() // 60)
        k = _rl_key("tok", ident, str(win))
        raw = r.get(k)
        return int(raw) if raw is not None else 0
    except Exception as e:
        logger.debug("rate_limit minute_token_count: %s", e)
        return 0


def check_minute_tokens(ident: str, increment: int = 0) -> tuple[bool, int]:
    """Return (allowed, current_count) for token budget per minute."""
    r = get_redis()
    win = int(time.time() // 60)
    k = _rl_key("tok", ident, str(win))
    expire_at = time.time() + 120.0

    if not r:
        if increment <= 0:
            return True, 0
        if RATE_LIMIT_STRICT_REDIS:
            logger.warning("check_minute_tokens: Redis down + strict mode — denying token increment")
            return False, OPENAI_TOKEN_LIMIT_PER_MINUTE + 1
        _log_memory_fallback_once()
        with _mem_lock:
            cur, exp = _memory_counts.get(k, (0, expire_at))
            if exp < time.time():
                cur = 0
            cur += int(increment)
            _memory_counts[k] = (cur, max(exp, expire_at))
            return cur <= OPENAI_TOKEN_LIMIT_PER_MINUTE, cur

    try:
        cur = int(r.incrby(k, increment))
        if cur == increment:
            r.expire(k, 120)
        return cur <= OPENAI_TOKEN_LIMIT_PER_MINUTE, cur
    except Exception as e:
        logger.warning("rate_limit tokens Redis error: %s", e)
        if RATE_LIMIT_STRICT_REDIS:
            return False, OPENAI_TOKEN_LIMIT_PER_MINUTE + 1
        _log_memory_fallback_once()
        with _mem_lock:
            cur, exp = _memory_counts.get(k, (0, expire_at))
            if exp < time.time():
                cur = 0
            cur += int(increment)
            _memory_counts[k] = (cur, max(exp, expire_at))
            return cur <= OPENAI_TOKEN_LIMIT_PER_MINUTE, cur


def check_hourly_tts(ident: str) -> tuple[bool, int]:
    """Legacy hourly TTS check by arbitrary ident (e.g. IP). Prefer assert_tts_hourly_budget(user_id)."""
    win = int(time.time() // 3600)
    key = _rl_key("tts", ident, str(win))
    ok, cur = _bump_counter(key, TTS_CALL_LIMIT_PER_HOUR, 7200)
    return ok, cur


class ApiRateLimitMiddleware(BaseHTTPMiddleware):
    """Reserved for global guards; per-user TTS/STT limits run in route dependencies (Phase 2)."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        return await call_next(request)
