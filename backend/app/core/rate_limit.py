# -*- coding: utf-8 -*-
"""Redis-backed rate limits for API cost governance (Phase C)."""

from __future__ import annotations

import logging
import os
import time
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

OPENAI_TOKEN_LIMIT_PER_MINUTE = int(os.getenv("OPENAI_TOKEN_LIMIT_PER_MINUTE", "5000"))


def _load_tts_call_limit_per_hour() -> int:
    """Redis hourly budget for POST /api/v1/tts* per client IP. Env: TTS_CALL_LIMIT_PER_HOUR."""
    # os.getenv only accepts str default; semantic default is 500 calls/hour
    raw = os.getenv("TTS_CALL_LIMIT_PER_HOUR", "500")
    try:
        n = int(str(raw).strip())
    except ValueError:
        logger.warning(
            "Invalid TTS_CALL_LIMIT_PER_HOUR=%r — using default 500",
            raw,
        )
        return 500
    if n < 1:
        logger.warning("TTS_CALL_LIMIT_PER_HOUR=%s < 1 — clamping to 1", n)
        return 1
    return n


TTS_CALL_LIMIT_PER_HOUR = _load_tts_call_limit_per_hour()


def _rl_key(prefix: str, ident: str, window: str) -> str:
    return f"rl:{prefix}:{ident}:{window}"


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
    if not r:
        return True, 0
    try:
        win = int(time.time() // 60)
        k = _rl_key("tok", ident, str(win))
        cur = int(r.incrby(k, increment))
        if cur == increment:
            r.expire(k, 120)
        return cur <= OPENAI_TOKEN_LIMIT_PER_MINUTE, cur
    except Exception as e:
        logger.debug("rate_limit tokens: %s", e)
        return True, 0


def check_hourly_tts(ident: str) -> tuple[bool, int]:
    r = get_redis()
    if not r:
        return True, 0
    try:
        win = int(time.time() // 3600)
        k = _rl_key("tts", ident, str(win))
        cur = int(r.incr(k))
        if cur == 1:
            r.expire(k, 7200)
        return cur <= TTS_CALL_LIMIT_PER_HOUR, cur
    except Exception as e:
        logger.debug("rate_limit tts: %s", e)
        return True, 0


class ApiRateLimitMiddleware(BaseHTTPMiddleware):
    """Light guard: /api/v1/tts* hourly call count per client IP (when Redis up)."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path or ""
        if not path.startswith("/api/v1/") or path.startswith("/api/health"):
            return await call_next(request)
        ident = request.client.host if request.client else "unknown"
        if request.method == "POST" and ("/tts" in path or "tts-with-timing" in path):
            ok, n = check_hourly_tts(ident)
            if not ok:
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": f"TTS hourly limit exceeded ({TTS_CALL_LIMIT_PER_HOUR}/hour). Try again later.",
                        "code": "tts_rate_limit",
                    },
                )
        return await call_next(request)
