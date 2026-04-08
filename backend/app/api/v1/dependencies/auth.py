# -*- coding: utf-8 -*-
"""
Deprecated compatibility shim — use ``app.api.deps`` for auth.

All protected routes should depend on ``get_current_user`` / ``get_teacher_user`` from
``app.api.deps`` (JWT + database ``User`` + ``is_active``). This module re-exports the
same callables so any legacy ``from app.api.v1.dependencies.auth import ...`` keeps working.
"""

from __future__ import annotations

from app.api.deps import (
    get_admin_user,
    get_current_user,
    get_current_user_optional,
    get_teacher_user,
    security,
)

__all__ = [
    "get_admin_user",
    "get_current_user",
    "get_current_user_optional",
    "get_teacher_user",
    "security",
]
