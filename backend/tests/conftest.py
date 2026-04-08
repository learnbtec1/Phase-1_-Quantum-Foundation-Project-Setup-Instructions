# -*- coding: utf-8 -*-
"""Shared pytest fixtures: stub users via FastAPI dependency overrides."""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest

# Force SQLite for pytest so ``app.database`` never requires psycopg2.
os.environ["USE_DB"] = "false"
os.environ["DATABASE_URL"] = os.environ.get(
    "PYTEST_DATABASE_URL", "sqlite:///./pytest_eduverse.db"
)

# If the parent shell left ENVIRONMENT=production, Settings() would require a strong JWT at import.
# Subprocess tests for production set their own env. Opt-in: PYTEST_ALLOW_PRODUCTION_ENV=1 + valid JWT_SECRET.
_pe = (os.getenv("ENVIRONMENT") or os.getenv("ENV") or "").strip().lower()
if _pe in ("production", "prod") and os.getenv("PYTEST_ALLOW_PRODUCTION_ENV") != "1":
    os.environ["ENVIRONMENT"] = "development"

from app.api import deps
from app.main import app
from app.models.db_models import UserRole

STUDENT_A_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
STUDENT_B_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")
TEACHER_ID = uuid.UUID("00000000-0000-4000-8000-000000000003")


class _StubUser:
    """Minimal object satisfying memory / assessment / BTEC role checks."""

    __slots__ = ("id", "email", "name", "role", "is_active")

    def __init__(self, uid: uuid.UUID, role: UserRole) -> None:
        self.id = uid
        self.email = f"stub-{uid.hex[:8]}@test.local"
        self.name = "Stub User"
        self.role = role
        self.is_active = True


def _async_user(user: _StubUser):
    async def _inner() -> Any:
        return user

    return _inner


def clear_current_user_override() -> None:
    app.dependency_overrides.pop(deps.get_current_user, None)


def set_current_user_override(uid: uuid.UUID, role: UserRole) -> None:
    app.dependency_overrides[deps.get_current_user] = _async_user(_StubUser(uid, role))


@pytest.fixture
def auth_as_student_a() -> Any:
    set_current_user_override(STUDENT_A_ID, UserRole.student)
    yield
    clear_current_user_override()


@pytest.fixture
def auth_as_student_b() -> Any:
    set_current_user_override(STUDENT_B_ID, UserRole.student)
    yield
    clear_current_user_override()


@pytest.fixture
def auth_as_teacher() -> Any:
    set_current_user_override(TEACHER_ID, UserRole.teacher)
    yield
    clear_current_user_override()


@pytest.fixture
def no_auth_override() -> Any:
    """Real ``get_current_user`` chain (401 when Bearer missing / invalid)."""
    clear_current_user_override()
    yield
    clear_current_user_override()
