# -*- coding: utf-8 -*-
"""Phase 5: CORS / auth shim consistency."""

from __future__ import annotations

import os

from app.api import deps as root_deps
from app.api.v1.dependencies import auth as shim_auth
from app.core.config import settings
from app.main import ALLOW_ORIGINS


def test_cors_list_matches_settings_plus_extra_origins() -> None:
    base = list(settings.get_cors_origins())
    extra = [x.strip() for x in os.getenv("EXTRA_ORIGINS", "").split() if x.strip()]
    expected: list[str] = []
    for o in base + extra:
        if o and o not in expected:
            expected.append(o)
    assert ALLOW_ORIGINS == expected


def test_auth_shim_reexports_same_get_current_user() -> None:
    assert shim_auth.get_current_user is root_deps.get_current_user
    assert shim_auth.get_teacher_user is root_deps.get_teacher_user
    assert shim_auth.security is root_deps.security
