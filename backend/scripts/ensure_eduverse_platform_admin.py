# -*- coding: utf-8 -*-
"""
Operator script: set role=admin for the designated platform admin user (single email in crud).
Idempotent. Does not create users; sign up the account first if missing.

In this app, GET /api/v1/auth/me reads role from the database (JWT carries only `sub` / user id),
so a new access token is not strictly required for admin checks; refresh the client or re-open
the session if the UI caches the profile.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

_BACK_END = Path(__file__).resolve().parent.parent
if str(_BACK_END) not in sys.path:
    sys.path.insert(0, str(_BACK_END))

from dotenv import load_dotenv

load_dotenv()

from app.crud.user import EDUVERSE_PLATFORM_ADMIN_EMAIL, ensure_eduverse_platform_admin_role

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def main() -> int:
    try:
        n = ensure_eduverse_platform_admin_role()
    except Exception as e:  # noqa: BLE001 — surface DB/config errors to operator
        logger.error("Failed to update role: %s", e)
        return 1
    if n == 0:
        logger.warning(
            "No user with email %s — not created. Register this account first, then re-run.",
            EDUVERSE_PLATFORM_ADMIN_EMAIL,
        )
        return 0
    logger.info("Updated role=admin for %s (rows=%s).", EDUVERSE_PLATFORM_ADMIN_EMAIL, n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
