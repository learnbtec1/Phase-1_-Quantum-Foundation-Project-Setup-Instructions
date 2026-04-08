# -*- coding: utf-8 -*-
"""Production-only validation (JWT secret strength, etc.)."""

from __future__ import annotations

import re

# Default shipped in repo / tutorials — never use in production.
_FORBIDDEN_JWT_SECRETS = frozenset(
    {
        "",
        "change_this_in_production",
        "change_this_in_production_docker",
        "secret",
        "changeme",
        "jwt_secret",
        "your-secret-key",
        "your_jwt_secret",
        "test",
        "dev",
    }
)

# HS256: use at least 256 bits of entropy; enforce minimum length on the shared secret string.
JWT_SECRET_MIN_LEN = 32


def environment_is_production(env_value: str | None) -> bool:
    v = (env_value or "").strip().lower()
    return v in ("production", "prod")


def validate_jwt_secret_for_production(secret: str) -> None:
    """
    Raises ValueError if ``secret`` is unsuitable for signing JWTs in production.
    Called from Settings when ENVIRONMENT is production.
    """
    raw = secret or ""
    s = raw.strip()
    low = s.lower()
    if low in _FORBIDDEN_JWT_SECRETS:
        raise ValueError(
            "JWT_SECRET must not use the default or a trivial value in production "
            "(set a long random string, e.g. openssl rand -hex 32)."
        )
    if len(s) < JWT_SECRET_MIN_LEN:
        raise ValueError(
            f"JWT_SECRET must be at least {JWT_SECRET_MIN_LEN} characters in production."
        )
    if len(set(s)) < 8:
        raise ValueError("JWT_SECRET has too little character diversity for production.")
    if re.fullmatch(r"(.)\1+", s):
        raise ValueError("JWT_SECRET must not be a repeated single character.")
