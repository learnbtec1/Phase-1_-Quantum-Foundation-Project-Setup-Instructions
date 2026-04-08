# -*- coding: utf-8 -*-
"""Auth + per-user rate limits for Phase 2 expensive HTTP routes."""

from __future__ import annotations

from fastapi import Depends

from app.api.deps import get_current_user
from app.core.rate_limit import (
    assert_llm_http_route_budget,
    assert_eduverse_read_budget,
    assert_stt_hourly_budget,
    assert_tts_hourly_budget,
)
from app.models.db_models import User


async def gate_llm_http_user(user: User = Depends(get_current_user)) -> User:
    assert_llm_http_route_budget(str(user.id))
    return user


async def gate_eduverse_read_user(user: User = Depends(get_current_user)) -> User:
    assert_eduverse_read_budget(str(user.id))
    return user


async def gate_tts_user(user: User = Depends(get_current_user)) -> User:
    assert_tts_hourly_budget(str(user.id))
    return user


async def gate_stt_user(user: User = Depends(get_current_user)) -> User:
    assert_stt_hourly_budget(str(user.id))
    return user
