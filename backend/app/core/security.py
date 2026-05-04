# -*- coding: utf-8 -*-
"""Password hashing and JWT helpers for Phase A auth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _plaintext_within_bcrypt_limit(plain: str) -> str:
    """BCrypt rejects inputs longer than 72 bytes — truncate UTF-8 safely before hash/verify."""
    return plain.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def hash_password(plain: str) -> str:
    return pwd_context.hash(_plaintext_within_bcrypt_limit(plain))


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        safe = _plaintext_within_bcrypt_limit(plain)
        return pwd_context.verify(safe, hashed)
    except Exception:
        return False


def create_access_token(*, subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=int(settings.JWT_EXPIRES_MINUTES))
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
