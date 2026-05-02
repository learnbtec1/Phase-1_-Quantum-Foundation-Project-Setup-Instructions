# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import secrets
import smtplib
from email.message import EmailMessage
from typing import Literal, Optional

import pyotp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import get_current_user
from app.core.limiter import limiter
from app.core.config import settings
from app.core.mail import mail_is_configured, send_verification_email_luxury
from app.core.security import create_access_token, hash_password, verify_password
from app.crud import user as user_crud
from app.db.models import User
from app.services import usage_service

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

DETAIL_EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"

PUBLIC_REGISTER_ROLES = ("student", "teacher")


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=256)
    role: Literal["student", "teacher"] = "student"


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)
    totp_code: Optional[str] = Field(
        default=None,
        description="6-digit TOTP if two-factor is enabled for the account.",
    )


class LoginOut(BaseModel):
    """Web login: JWT is set only in HttpOnly cookie, not in this body."""

    ok: bool = True
    token_type: str = "bearer"


class RegisterOut(BaseModel):
    message: str
    email: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    subscription_plan: str
    totp_enabled: bool
    is_verified: bool


class WsTokenOut(BaseModel):
    """JWT for WebSocket `{ type: \"auth\", token }` when the browser only has HttpOnly session cookie."""

    access_token: str
    token_type: str = "bearer"


class ResendVerificationBody(BaseModel):
    email: EmailStr


class TwoFaSetupOut(BaseModel):
    secret: str
    provisioning_uri: str
    label: str


class TwoFaEnableBody(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class TwoFaDisableBody(BaseModel):
    password: str
    totp_code: str = Field(..., min_length=6, max_length=8)


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=8, max_length=256)


async def _background_send_verification(to_email: str, raw_token: str) -> None:
    try:
        await send_verification_email_luxury(to_email, raw_token)
    except Exception as e:
        logger.exception("Failed to send verification email: %s", e)


def _send_reset_email(to_email: str, reset_url: str) -> None:
    if not (settings.SMTP_HOST or "").strip():
        logger.info("Password reset link for %s: %s (configure SMTP to email)", to_email, reset_url)
        return
    msg = EmailMessage()
    msg["Subject"] = "Password reset"
    msg["From"] = (settings.SMTP_FROM or settings.SMTP_USER or "noreply@localhost").strip()
    msg["To"] = to_email
    msg.set_content(
        f"You requested a password reset.\n\nOpen this link (valid {settings.PASSWORD_RESET_TOKEN_TTL_MINUTES} min):\n{reset_url}\n"
    )
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as smtp:
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            smtp.starttls()
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


@router.post("/register", response_model=RegisterOut)
@limiter.limit("10/minute")
def register(
    request: Request,  # noqa: ARG001
    background_tasks: BackgroundTasks,
    body: RegisterBody,
) -> RegisterOut:
    if not settings.ENABLE_REGISTRATION:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Registration is disabled")
    if body.role not in PUBLIC_REGISTER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role for self-registration")
    if user_crud.get_user_by_email(body.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    pw_hash = hash_password(body.password)
    uid = user_crud.create_user(body.email, pw_hash, role=body.role)
    u = user_crud.get_user_by_id(uid)
    if u:
        usage_service.ensure_current_period_row(u)
    email_n = body.email.strip().lower()
    # No MAIL_* credentials: verification email cannot be sent — auto-verify so local/dev accounts can sign in.
    if not mail_is_configured():
        user_crud.set_email_verified(uid, True)
        user_crud.clear_email_verification_token(uid)
        return RegisterOut(
            message=(
                "Account created. You can sign in now "
                "(outbound email is not configured; verification link would only appear in server logs)."
            ),
            email=body.email,
        )
    raw = secrets.token_urlsafe(32)
    user_crud.set_email_verification_token(uid, raw, settings.EMAIL_VERIFICATION_TTL_HOURS)
    background_tasks.add_task(_background_send_verification, email_n, raw)
    return RegisterOut(
        message="Account created. Check your email for a verification link before signing in.",
        email=body.email,
    )


@router.post("/login", response_model=LoginOut)
@limiter.limit("20/minute")
def login(request: Request, body: LoginBody) -> JSONResponse:  # noqa: ARG001
    u = user_crud.get_user_by_email(body.email)
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not u.is_active:
        raise HTTPException(status_code=403, detail="User inactive")
    if settings.REQUIRE_EMAIL_VERIFICATION_FOR_LOGIN and not u.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=DETAIL_EMAIL_NOT_VERIFIED,
        )
    if u.totp_enabled:
        secret = (u.totp_secret or "").strip()
        if not secret:
            raise HTTPException(status_code=500, detail="Two-factor misconfigured; contact support")
        code = (body.totp_code or "").replace(" ", "").strip()
        if not code or not pyotp.TOTP(secret).verify(code, valid_window=1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Two-factor code required or invalid",
            )
    jwt = create_access_token(u.id, extra_claims={"role": (u.role or "student")})
    usage_service.ensure_current_period_row(u)
    max_age = int(settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    out = LoginOut()
    response = JSONResponse(status_code=200, content=out.model_dump())
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=jwt,
        httponly=True,
        max_age=max_age,
        samesite="lax",
        path="/",
        secure=bool(settings.AUTH_COOKIE_SECURE),
    )
    return response


@router.post("/logout", response_model=None)
def logout() -> JSONResponse:
    r = JSONResponse(content={"ok": True})
    r.delete_cookie(key=settings.AUTH_COOKIE_NAME, path="/")
    return r


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        subscription_plan=user.subscription_plan,
        totp_enabled=user.totp_enabled,
        is_verified=user.is_verified,
    )


@router.get("/ws-token", response_model=WsTokenOut)
@limiter.limit("30/minute")
def ws_token_for_session(request: Request, user: User = Depends(get_current_user)) -> WsTokenOut:
    """
    Cogni `/ws/agent` cannot read HttpOnly cookies in manual `auth` frames — only localStorage / sent token.
    Issue a fresh JWT matching `JWT_SECRET_KEY` so `decode_token` in ws_agent succeeds.
    """
    jwt = create_access_token(user.id, extra_claims={"role": (user.role or "student")})
    return WsTokenOut(access_token=jwt)


@router.get("/verify-email", response_model=None)
@limiter.limit("30/minute")
def verify_email(
    request: Request,  # noqa: ARG001
    token: str | None = Query(default=None, description="Raw verification token from email"),
    return_json: bool = Query(
        default=False,
        description="If true, return JSON (for SPA); if false, redirect to the frontend result page",
    ),
):
    # Return type not annotated: RedirectResponse | dict breaks Pydantic response model inference.
    fe = settings.FRONTEND_URL.rstrip("/")
    t = (token or "").strip()
    if not t:
        if return_json:
            raise HTTPException(status_code=400, detail="Missing token")
        return RedirectResponse(url=f"{fe}/verify-email?error=missing", status_code=status.HTTP_302_FOUND)
    uid = user_crud.verify_email_by_raw_token(t)
    if not uid:
        if return_json:
            raise HTTPException(status_code=400, detail="Invalid or expired verification token")
        return RedirectResponse(url=f"{fe}/verify-email?error=invalid", status_code=status.HTTP_302_FOUND)
    if return_json:
        return {"ok": True, "detail": "Email verified. You can sign in now."}
    return RedirectResponse(url=f"{fe}/verify-email?verified=1", status_code=status.HTTP_302_FOUND)


@router.post("/resend-verification")
@limiter.limit("5/minute")
def resend_verification(
    request: Request,  # noqa: ARG001
    background_tasks: BackgroundTasks,
    body: ResendVerificationBody,
) -> dict[str, str]:
    u = user_crud.get_user_by_email(body.email)
    if u and not u.is_verified:
        raw = secrets.token_urlsafe(32)
        user_crud.set_email_verification_token(u.id, raw, settings.EMAIL_VERIFICATION_TTL_HOURS)
        background_tasks.add_task(_background_send_verification, u.email, raw)
    return {"detail": "If that account exists and is not yet verified, a new link has been sent."}


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, body: ForgotPasswordBody) -> dict[str, str]:  # noqa: ARG001
    u = user_crud.get_user_by_email(body.email)
    if u:
        raw = user_crud.create_password_reset_token(
            u.id, ttl_minutes=settings.PASSWORD_RESET_TOKEN_TTL_MINUTES
        )
        base = settings.FRONTEND_URL.rstrip("/")
        reset_url = f"{base}/reset-password?token={raw}"
        try:
            _send_reset_email(u.email, reset_url)
        except Exception as e:
            logger.exception("Failed to send reset email: %s", e)
    return {"detail": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(request: Request, body: ResetPasswordBody) -> dict[str, str]:  # noqa: ARG001
    uid = user_crud.consume_password_reset_token(body.token)
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user_crud.update_password_hash(uid, hash_password(body.new_password))
    return {"detail": "Password updated"}


@router.get("/2fa/status")
def two_fa_status(user: User = Depends(get_current_user)) -> dict[str, bool]:
    return {
        "enabled": bool(user.totp_enabled),
        "setup_pending": bool((user.totp_secret or "").strip() and not user.totp_enabled),
    }


@router.post("/2fa/setup", response_model=TwoFaSetupOut)
def two_fa_setup(user: User = Depends(get_current_user)) -> TwoFaSetupOut:
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor is already enabled")
    secret = pyotp.random_base32()
    user_crud.set_totp_secret(user.id, secret)
    label = f"EDUVERSE ({user.email})"
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="EDUVERSE")
    return TwoFaSetupOut(secret=secret, provisioning_uri=uri, label=label)


@router.post("/2fa/enable")
def two_fa_enable(body: TwoFaEnableBody, user: User = Depends(get_current_user)) -> dict[str, str]:
    secret = (user.totp_secret or "").strip()
    if not secret:
        raise HTTPException(status_code=400, detail="Run /auth/2fa/setup first")
    if user.totp_enabled:
        return {"detail": "Already enabled"}
    code = body.code.replace(" ", "").strip()
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    user_crud.set_totp_enabled(user.id, True)
    return {"detail": "Two-factor authentication enabled"}


@router.post("/2fa/disable")
def two_fa_disable(body: TwoFaDisableBody, user: User = Depends(get_current_user)) -> dict[str, str]:
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor is not enabled")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")
    secret = (user.totp_secret or "").strip()
    if not secret or not pyotp.TOTP(secret).verify(body.totp_code.replace(" ", ""), valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    user_crud.set_totp_enabled(user.id, False)
    user_crud.set_totp_secret(user.id, None)
    return {"detail": "Two-factor authentication disabled"}
