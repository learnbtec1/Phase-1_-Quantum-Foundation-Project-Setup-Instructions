# -*- coding: utf-8 -*-
"""Auth + per-user rate limits for Phase 2 expensive HTTP routes."""

from __future__ import annotations

import os
import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user, get_current_user_optional
from app.core.rate_limit import (
    assert_llm_http_route_budget,
    assert_eduverse_read_budget,
    assert_stt_hourly_budget,
    assert_tts_hourly_budget,
)
from app.models.db_models import User, UserRole

_DEBUG_TTS_USER_ID = uuid.UUID("00000000-0000-4000-8000-0000000000c0")


def _dev_bypass_auth_enabled() -> bool:
    """Local dev only: set COGNI_DEV_BYPASS_AUTH=true (forbidden in production via Settings)."""
    return os.getenv("COGNI_DEV_BYPASS_AUTH", "false").lower() in ("1", "true", "yes")


def _stub_dev_user() -> User:
    return SimpleNamespace(  # type: ignore[return-value]
        id=_DEBUG_TTS_USER_ID,
        email="dev-bypass@local",
        name="Dev Bypass",
        role=UserRole.student,
        is_active=True,
    )


async def gate_llm_http_user(user: User = Depends(get_current_user)) -> User:
    assert_llm_http_route_budget(str(user.id))
    return user


async def gate_eduverse_read_user(user: User = Depends(get_current_user)) -> User:
    assert_eduverse_read_budget(str(user.id))
    return user


async def gate_tts_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    if user is not None:
        assert_tts_hourly_budget(str(user.id))
        return user
    if _dev_bypass_auth_enabled():
        u = _stub_dev_user()
        assert_tts_hourly_budget(str(u.id))
        return u
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def gate_stt_user(user: User = Depends(get_current_user)) -> User:
    assert_stt_hourly_budget(str(user.id))
    return user
