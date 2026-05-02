# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.security import decode_token
from app.crud import user as user_crud
from app.db.models import User

logger = logging.getLogger(__name__)

bearer = HTTPBearer(auto_error=False)


def _synthetic_emergency_dev_user() -> User:
    """In-memory row when AUTH_DEV_BYPASS runs but AUTH_DEV_STATIC_USER_ID has no DB row."""
    now = datetime.now(timezone.utc)
    uid = int(settings.AUTH_DEV_STATIC_USER_ID)
    return User(
        id=uid,
        email="dev@local",
        password_hash="__emergency_auth_freeze__",
        is_active=True,
        created_at=now,
        role="admin",
        subscription_plan="free",
        stripe_customer_id=None,
        stripe_subscription_id=None,
        sub_status=None,
        sub_period_end=None,
        sub_cancel_at_end=False,
        totp_secret=None,
        totp_enabled=False,
        is_verified=True,
        verification_token_hash=None,
        verification_token_expires_at=None,
    )


def _resolve_dev_bypass_subject() -> User:
    """DB-first subject for AUTH_DEV_BYPASS; skeleton admin so gated routes avoid 401 in local freeze."""
    u = user_crud.get_user_by_id(settings.AUTH_DEV_STATIC_USER_ID)
    if u and getattr(u, "is_active", True):
        return u
    logger.warning(
        "AUTH_DEV_BYPASS: user id=%s missing or inactive — synthetic admin returned",
        settings.AUTH_DEV_STATIC_USER_ID,
    )
    return _synthetic_emergency_dev_user()


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> User:
    token: str | None = None
    raw = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if raw and str(raw).strip():
        token = str(raw).strip()
    if not token and creds and creds.credentials:
        token = creds.credentials

    if not token:
        if settings.AUTH_DEV_BYPASS:
            return _resolve_dev_bypass_subject()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Dev-only opaque token (pair NEXT_PUBLIC_DEV_TOKEN with AUTH_DEV_STATIC_TOKEN).
    if (
        settings.AUTH_DEV_BYPASS
        and (settings.AUTH_DEV_STATIC_TOKEN or "").strip()
        and token.strip() == (settings.AUTH_DEV_STATIC_TOKEN or "").strip()
    ):
        return _resolve_dev_bypass_subject()

    sub = None
    try:
        data = decode_token(token)
        sub = data.get("sub")
    except Exception:
        sub = None
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    try:
        uid = int(sub)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid subject") from e
    u = user_crud.get_user_by_id(uid)
    if not u or not u.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not getattr(u, "is_verified", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="EMAIL_NOT_VERIFIED",
        )
    return u


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    if (getattr(user, "role", None) or "").lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def get_teacher_user(
    user: User = Depends(get_current_user),
) -> User:
    """Ref-stack TTS admin routes: allow teacher or admin role."""
    r = (getattr(user, "role", "") or "").lower()
    if r not in ("teacher", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher or admin access required",
        )
    return user


async def gate_tts_user(
    user: User = Depends(get_current_user),
) -> User:
    """JWT/cookie authenticated user — same boundary used by `/tts-with-timing`."""
    return user
