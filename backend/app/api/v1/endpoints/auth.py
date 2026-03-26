# -*- coding: utf-8 -*-
"""JWT registration, login, and /me for Cogni Phase A."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.db_models import ConsentRecord, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    subscription_plan: str | None = None
    model_tier: str | None = None
    dnd_mode: bool = False

    model_config = {"from_attributes": False}


class ConsentBody(BaseModel):
    terms_accepted: bool = True
    parent_email: str | None = None


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        existing = db.query(User).filter(User.email == body.email.lower().strip()).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
        user = User(
            id=uuid.uuid4(),
            email=body.email.lower().strip(),
            name=body.name.strip(),
            hashed_password=hash_password(body.password),
            role=UserRole.student,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(subject=str(user.id))
        logger.info("User registered | id=%s email=%s", user.id, user.email)
        return TokenResponse(access_token=token)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("register failed: %s", e)
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Registration failed") from e


@router.post("/login", response_model=TokenResponse)
def login(body: LoginBody, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        user = db.query(User).filter(User.email == body.email.lower().strip()).first()
        if not user or not verify_password(body.password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
        token = create_access_token(subject=str(user.id))
        logger.info("User login | id=%s", user.id)
        return TokenResponse(access_token=token)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("login failed: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Login failed") from e


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        subscription_plan=getattr(user, "subscription_plan", None),
        model_tier=getattr(user, "model_tier", None),
        dnd_mode=bool(getattr(user, "dnd_mode", False)),
    )


@router.post("/consent", response_model=UserOut)
def record_consent(
    body: ConsentBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserOut:
    """Record terms / parental consent (COPPA-oriented)."""
    now = datetime.now(timezone.utc)
    user.terms_accepted_at = now
    if body.terms_accepted:
        user.consent_given_at = now
    if body.parent_email and str(body.parent_email).strip():
        user.parent_email = str(body.parent_email).strip()[:255]
    db.add(
        ConsentRecord(
            id=uuid.uuid4(),
            user_id=user.id,
            consent_type="terms_and_privacy",
            accepted_at=now,
            meta={"parent_email": bool(body.parent_email)},
        )
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        subscription_plan=getattr(user, "subscription_plan", None),
        model_tier=getattr(user, "model_tier", None),
        dnd_mode=bool(getattr(user, "dnd_mode", False)),
    )
