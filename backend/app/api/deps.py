# -*- coding: utf-8 -*-
"""FastAPI dependencies: current user from Bearer JWT."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.database import SessionLocal, get_db
from app.models.db_models import User, UserRole

security = HTTPBearer(auto_error=False)


def load_user_from_access_token(token: str) -> Optional[User]:
    """Load active user from raw JWT string (WebSocket `auth` frame / subprotocol)."""
    tok = (token or "").strip()
    if not tok:
        return None
    db = SessionLocal()
    try:
        return _user_from_token(SimpleNamespace(credentials=tok), db)
    finally:
        db.close()


def _user_from_token(
    credentials: Optional[HTTPAuthorizationCredentials],
    db: Session,
) -> Optional[User]:
    if not credentials or not credentials.credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    try:
        uid = uuid.UUID(str(sub))
    except (ValueError, TypeError):
        return None
    user = db.query(User).filter(User.id == uid).first()
    if not user or not user.is_active:
        return None
    return user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    return _user_from_token(credentials, db)


async def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_teacher_user(
    user: User = Depends(get_current_user),
) -> User:
    if user.role not in (UserRole.teacher, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
    return user


async def get_admin_user(
    user: User = Depends(get_current_user),
) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user
