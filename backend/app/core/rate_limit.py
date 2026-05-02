# -*- coding: utf-8 -*-
"""
Redis-backed per-user LLM rate limits (fastapi-limiter 0.1.x).
Identifier prefers JWT `sub` from HttpOnly session cookie, then Authorization Bearer, then IP+path.
When Redis is unavailable, GuardedRateLimiter no-ops (see main.py lifespan).
"""
from __future__ import annotations

from math import ceil

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

from app.core.config import settings
from app.core.security import safe_decode_subject
from fastapi_limiter import FastAPILimiter, default_identifier
from fastapi_limiter.depends import RateLimiter

# Same Arabic body for all 429s from this limiter (required product copy).
_AR_429 = "لقد تجاوزت الحد المسموح من الطلبات. يرجى الانتظار لمدة دقيقة ثم المحاولة مجدداً."


async def llm_user_identifier(request: Request) -> str:
    """
    Per-user (JWT `sub`) + path when session cookie or Bearer is valid; else IP+path
    (same key shape as before so shared-NAT is only hit when unauthenticated).
    """
    for cookie_name in (
        settings.AUTH_COOKIE_NAME,
        "eduvor_token",
        "auth_token",
    ):
        if not cookie_name:
            continue
        raw = request.cookies.get(str(cookie_name).strip()) or None
        if not raw or not str(raw).strip():
            continue
        sub = safe_decode_subject(str(raw).strip())
        if sub:
            path = request.scope.get("path", "")
            return f"uid:{sub}:{path}"
    auth = (request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        sub = safe_decode_subject(auth[7:].strip())
        if sub:
            path = request.scope.get("path", "")
            return f"uid:{sub}:{path}"
    return await default_identifier(request)


async def arabic_http_429(
    _request: Request,
    _response: Response,
    pexpire: int,
) -> None:
    """fastapi-limiter 0.1.x http_callback signature: remaining window in ms (from Lua)."""
    seconds = max(1, int(ceil(pexpire / 1000)))
    raise HTTPException(
        status_code=HTTP_429_TOO_MANY_REQUESTS,
        detail=_AR_429,
        headers={"Retry-After": str(seconds)},
    )


class GuardedRateLimiter(RateLimiter):
    """
    If FastAPILimiter was never initialised (Redis down), skip rate enforcement instead of
    raising "You must call FastAPILimiter.init" (see app.main lifespan graceful degradation).
    """

    async def __call__(self, request: Request, response: Response) -> None:
        if not getattr(FastAPILimiter, "redis", None) or not getattr(
            FastAPILimiter, "lua_sha", None
        ):
            return None
        return await super().__call__(request, response)


# Strict: 5 LLM (or OpenAI) calls per user per route per 60s — stored in Redis.
llm_rate_limit: GuardedRateLimiter = GuardedRateLimiter(
    times=5,
    seconds=60,
    identifier=llm_user_identifier,
)
