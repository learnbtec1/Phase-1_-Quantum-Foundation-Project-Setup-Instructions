# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from psycopg.rows import dict_row

from app.db.models import User
from app.db.session import get_db_connection

# Designated platform admin (operator scripts only). Not used in auth or JWT.
EDUVERSE_PLATFORM_ADMIN_EMAIL = "admin@eduversejo.com"

_USER_SELECT = """
    SELECT id, email, password_hash, is_active, created_at,
           role, subscription_plan, stripe_customer_id, stripe_subscription_id,
           sub_status, sub_period_end, sub_cancel_at_end, totp_secret, totp_enabled,
           is_verified, verification_token_hash, verification_token_expires_at
    FROM users
"""


def _row_to_user(row: dict) -> User:
    return User(
        id=int(row["id"]),
        email=str(row["email"]),
        password_hash=str(row["password_hash"]),
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        role=str(row.get("role") or "student"),
        subscription_plan=str(row.get("subscription_plan") or "free"),
        stripe_customer_id=row.get("stripe_customer_id"),
        stripe_subscription_id=row.get("stripe_subscription_id"),
        sub_status=row.get("sub_status"),
        sub_period_end=row.get("sub_period_end"),
        sub_cancel_at_end=bool(row.get("sub_cancel_at_end") or False),
        totp_secret=row.get("totp_secret"),
        totp_enabled=bool(row.get("totp_enabled") or False),
        is_verified=bool(row.get("is_verified", True)),
        verification_token_hash=row.get("verification_token_hash"),
        verification_token_expires_at=row.get("verification_token_expires_at"),
    )


def get_user_by_email(email: str) -> Optional[User]:
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                f"{_USER_SELECT} WHERE LOWER(email) = LOWER(%s)",
                (email.strip(),),
            )
            row = cur.fetchone()
            if not row:
                return None
            return _row_to_user(row)


def get_user_by_id(user_id: int) -> Optional[User]:
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"{_USER_SELECT} WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                return None
            return _row_to_user(row)


def get_user_by_stripe_customer(stripe_customer_id: str) -> Optional[User]:
    cid = (stripe_customer_id or "").strip()
    if not cid:
        return None
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"{_USER_SELECT} WHERE stripe_customer_id = %s", (cid,))
            row = cur.fetchone()
            if not row:
                return None
            return _row_to_user(row)


def get_user_by_stripe_subscription_id(stripe_subscription_id: str) -> Optional[User]:
    sid = (stripe_subscription_id or "").strip()
    if not sid:
        return None
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"{_USER_SELECT} WHERE stripe_subscription_id = %s", (sid,))
            row = cur.fetchone()
            if not row:
                return None
            return _row_to_user(row)


def create_user(email: str, password_hash: str, role: str = "student") -> int:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, role, is_verified)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (email.strip().lower(), password_hash, role, False),
            )
            row = cur.fetchone()
            conn.commit()
            return int(row[0]) if row else 0


def update_password_hash(user_id: int, password_hash: str) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (password_hash, user_id),
            )
            conn.commit()


def set_stripe_customer_id(user_id: int, stripe_customer_id: str) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET stripe_customer_id = %s WHERE id = %s",
                (stripe_customer_id, user_id),
            )
            conn.commit()


def set_stripe_subscription_id(user_id: int, stripe_subscription_id: Optional[str]) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET stripe_subscription_id = %s WHERE id = %s",
                (stripe_subscription_id, user_id),
            )
            conn.commit()


def update_subscription_stripe_snapshot(
    user_id: int,
    *,
    sub_status: Optional[str] = None,
    sub_period_end: Optional[datetime] = None,
    sub_cancel_at_end: Optional[bool] = None,
) -> None:
    """Cache Stripe subscription fields from webhooks (read by /billing/me as fallback)."""
    parts: list[str] = []
    vals: list[object] = []
    if sub_status is not None:
        parts.append("sub_status = %s")
        vals.append(sub_status)
    if sub_period_end is not None:
        parts.append("sub_period_end = %s")
        vals.append(sub_period_end)
    if sub_cancel_at_end is not None:
        parts.append("sub_cancel_at_end = %s")
        vals.append(sub_cancel_at_end)
    if not parts:
        return
    vals.append(user_id)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE users SET {', '.join(parts)} WHERE id = %s",
                vals,
            )
            conn.commit()


def set_subscription_plan(user_id: int, plan: str) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET subscription_plan = %s WHERE id = %s",
                (plan, user_id),
            )
            conn.commit()


def set_user_role_by_email(email: str, role: str) -> int:
    """
    Set users.role for the row with matching email (case-insensitive, trimmed).
    Returns number of rows updated (0 or 1). For operator/CLI scripts only — not for HTTP routes.
    """
    em = (email or "").strip()
    r = (role or "").strip()
    if not em or not r:
        return 0
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET role = %s WHERE LOWER(email) = LOWER(%s)",
                (r, em),
            )
            n = int(cur.rowcount or 0)
        conn.commit()
    return n


def ensure_eduverse_platform_admin_role() -> int:
    """
    Idempotent: set role to 'admin' for EDUVERSE_PLATFORM_ADMIN_EMAIL.
    Returns 0 if no matching user, 1 if a row was updated. Does not create users.
    """
    return set_user_role_by_email(EDUVERSE_PLATFORM_ADMIN_EMAIL, "admin")


def clear_subscription_stripe_snapshot(user_id: int) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET sub_status = NULL, sub_period_end = NULL, sub_cancel_at_end = false
                WHERE id = %s
                """,
                (user_id,),
            )
            conn.commit()


def set_totp_secret(user_id: int, secret: Optional[str]) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET totp_secret = %s WHERE id = %s",
                (secret, user_id),
            )
            conn.commit()


def set_totp_enabled(user_id: int, enabled: bool) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET totp_enabled = %s WHERE id = %s",
                (enabled, user_id),
            )
            conn.commit()


# --- password reset tokens ---

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_password_reset_token(user_id: int, ttl_minutes: int = 60) -> str:
    raw = secrets.token_urlsafe(32)
    th = _hash_token(raw)
    exp = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM password_resets WHERE user_id = %s", (user_id,))
            cur.execute(
                """
                INSERT INTO password_resets (user_id, token_hash, expires_at)
                VALUES (%s, %s, %s)
                """,
                (user_id, th, exp),
            )
            conn.commit()
    return raw


def consume_password_reset_token(raw: str) -> Optional[int]:
    th = _hash_token(raw)
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT user_id, expires_at
                FROM password_resets
                WHERE token_hash = %s
                """,
                (th,),
            )
            row = cur.fetchone()
            if not row:
                return None
            exp = row["expires_at"]
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                cur.execute("DELETE FROM password_resets WHERE token_hash = %s", (th,))
                conn.commit()
                return None
            uid = int(row["user_id"])
            cur.execute("DELETE FROM password_resets WHERE user_id = %s", (uid,))
            conn.commit()
            return uid


# --- email verification (hash-only; use secrets.token_urlsafe(32) for raw links) ---


def set_email_verification_token(user_id: int, raw_token: str, ttl_hours: int) -> None:
    th = _hash_token(raw_token)
    exp = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET verification_token_hash = %s, verification_token_expires_at = %s
                WHERE id = %s
                """,
                (th, exp, user_id),
            )
            conn.commit()


def clear_email_verification_token(user_id: int) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET verification_token_hash = NULL, verification_token_expires_at = NULL
                WHERE id = %s
                """,
                (user_id,),
            )
            conn.commit()


def set_email_verified(user_id: int, verified: bool = True) -> None:
    """Set verification flag without a token (e.g. register when outbound mail is not configured)."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET is_verified = %s WHERE id = %s",
                (verified, user_id),
            )
            conn.commit()


def verify_email_by_raw_token(raw: str) -> Optional[int]:
    """On success, sets is_verified and clears the stored hash. Returns user id, or None."""
    raw = (raw or "").strip()
    if not raw:
        return None
    th = _hash_token(raw)
    now = datetime.now(timezone.utc)
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, verification_token_expires_at
                FROM users
                WHERE verification_token_hash = %s
                """,
                (th,),
            )
            row = cur.fetchone()
            if not row:
                return None
            exp = row.get("verification_token_expires_at")
            if exp is None:
                return None
            if getattr(exp, "tzinfo", None) is None:
                exp = exp.replace(tzinfo=timezone.utc)  # type: ignore[union-attr]
            if exp < now:
                cur.execute(
                    "UPDATE users SET verification_token_hash = NULL, verification_token_expires_at = NULL WHERE id = %s",
                    (int(row["id"]),),
                )
                conn.commit()
                return None
            uid = int(row["id"])
            cur.execute(
                """
                UPDATE users
                SET is_verified = true,
                    verification_token_hash = NULL,
                    verification_token_expires_at = NULL
                WHERE id = %s
                """,
                (uid,),
            )
            conn.commit()
            return uid
