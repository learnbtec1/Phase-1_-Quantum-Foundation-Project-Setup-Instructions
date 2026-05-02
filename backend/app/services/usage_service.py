# -*- coding: utf-8 -*-
"""Per-user monthly usage (assessment + plagiarism) for quota enforcement (free plan)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Literal, Optional

from fastapi import HTTPException, status

from app.db.models import User
from app.db.session import get_db_connection

logger = logging.getLogger(__name__)

UsageKind = Literal["assessment", "plagiarism"]

FREE_ASSESSMENT_LIMIT = 10
FREE_PLAGIARISM_LIMIT = 5
# Pro tier: higher monthly caps (unlimited = no cap, see plan_limits)
PRO_ASSESSMENT_LIMIT = 200
PRO_PLAGIARISM_LIMIT = 100
# Internal sentinel: legacy "infinite" comparisons in this module
UNLIMITED = 9_999_999
NO_LIMIT = -1

HTTP_LIMIT_DETAIL = "Usage limit reached. Please upgrade your plan."


def _user_key(user: User) -> str:
    return str(int(user.id))


def _month_bounds_utc(d: date) -> tuple[datetime, datetime]:
    """Start (inclusive) and end (exclusive) of calendar month in UTC for `d`."""
    start = datetime.combine(
        date(d.year, d.month, 1),
        time(0, 0, 0, tzinfo=timezone.utc),
    )
    if d.month == 12:
        end = datetime.combine(
            date(d.year + 1, 1, 1),
            time(0, 0, 0, tzinfo=timezone.utc),
        )
    else:
        end = datetime.combine(
            date(d.year, d.month + 1, 1),
            time(0, 0, 0, tzinfo=timezone.utc),
        )
    return start, end


def _current_month_bounds() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    return _month_bounds_utc(now.date())


def plan_limits(user: User) -> tuple[int, int]:
    """Return (assessment_limit, plagiarism_limit). Use NO_LIMIT (-1) for no quota."""
    p = (user.subscription_plan or "free").strip().lower()
    if p == "free":
        return FREE_ASSESSMENT_LIMIT, FREE_PLAGIARISM_LIMIT
    if p == "unlimited":
        return NO_LIMIT, NO_LIMIT
    if p == "pro":
        return PRO_ASSESSMENT_LIMIT, PRO_PLAGIARISM_LIMIT
    if p in ("basic", "advanced"):
        # Legacy paid tiers: prior stack treated all non-free plans as uncapped; keep that.
        return NO_LIMIT, NO_LIMIT
    # Unknown: conservative Pro caps
    return PRO_ASSESSMENT_LIMIT, PRO_PLAGIARISM_LIMIT


@dataclass
class UsageRow:
    assessments_used: int
    plagiarism_used: int
    total_requests: int
    period_start: datetime
    period_end: datetime


def _fetch_row(conn, user_id_s: str, period_start: datetime) -> Optional[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT assessments_used, plagiarism_used, total_requests, period_start, period_end
            FROM usage_stats
            WHERE user_id = %s AND period_start = %s
            """,
            (user_id_s, period_start),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "assessments_used": int(row[0] or 0),
            "plagiarism_used": int(row[1] or 0),
            "total_requests": int(row[2] or 0),
            "period_start": row[3],
            "period_end": row[4],
        }


def ensure_current_period_row(user: User) -> None:
    """Idempotent: ensure a usage_stats row exists for the current month (UTC)."""
    uid = _user_key(user)
    start, end = _current_month_bounds()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO usage_stats (user_id, period_start, period_end, assessments_used, plagiarism_used, total_requests)
                    VALUES (%s, %s, %s, 0, 0, 0)
                    ON CONFLICT (user_id, period_start) DO NOTHING
                    """,
                    (uid, start, end),
                )
            conn.commit()
    except Exception as e:
        logger.warning("ensure_current_period_row failed: %s", e)


def get_usage_for_user(user: User) -> UsageRow:
    ensure_current_period_row(user)
    uid = _user_key(user)
    start, _end = _current_month_bounds()
    with get_db_connection() as conn:
        d = _fetch_row(conn, uid, start)
        if not d:
            return UsageRow(0, 0, 0, start, _end)
        return UsageRow(
            d["assessments_used"],
            d["plagiarism_used"],
            d["total_requests"],
            d["period_start"],
            d["period_end"],
        )


def _raise_if_exceeded(used: int, limit: int) -> None:
    if limit < 0:
        return
    if limit >= UNLIMITED // 2:
        return
    if used >= limit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=HTTP_LIMIT_DETAIL)


def require_assessment_allowance(user: User) -> None:
    ensure_current_period_row(user)
    alim, _plim = plan_limits(user)
    row = get_usage_for_user(user)
    _raise_if_exceeded(row.assessments_used, alim)


def require_plagiarism_allowance(user: User) -> None:
    ensure_current_period_row(user)
    _al, plim = plan_limits(user)
    row = get_usage_for_user(user)
    _raise_if_exceeded(row.plagiarism_used, plim)


def record_assessment_success(user: User) -> None:
    """Increment after HTTP 200 on /assessment/grade."""
    _increment(user, "assessment")


def record_plagiarism_success(user: User) -> None:
    """Increment after HTTP 200 on /vectors/search (when count_toward_usage is true)."""
    _increment(user, "plagiarism")


def _increment(user: User, kind: UsageKind) -> None:
    ensure_current_period_row(user)
    uid = _user_key(user)
    start, _e = _current_month_bounds()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if kind == "assessment":
                    cur.execute(
                        """
                        UPDATE usage_stats
                        SET assessments_used = assessments_used + 1,
                            total_requests = total_requests + 1
                        WHERE user_id = %s AND period_start = %s
                        """,
                        (uid, start),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE usage_stats
                        SET plagiarism_used = plagiarism_used + 1,
                            total_requests = total_requests + 1
                        WHERE user_id = %s AND period_start = %s
                        """,
                        (uid, start),
                    )
            conn.commit()
    except Exception as e:
        logger.warning("usage increment failed (non-fatal): %s", e)
        return
    # Append-only event log (admin daily charts). Separate transaction so stats stay correct if this fails.
    try:
        ev_type = "assessment" if kind == "assessment" else "plagiarism"
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO usage_events (user_id, event_type)
                    VALUES (%s, %s)
                    """,
                    (int(user.id), ev_type),
                )
            conn.commit()
    except Exception as e:
        logger.warning("usage_events insert failed (non-fatal): %s", e)


def get_usage_me_payload(user: User) -> dict[str, Any]:
    alim, plim = plan_limits(user)
    row = get_usage_for_user(user)

    def _limit_and_remaining(limit: int, used: int) -> tuple[int, int]:
        if limit < 0:
            return -1, -1
        if limit >= UNLIMITED // 2:
            return -1, -1
        return limit, max(0, limit - used)

    a_out, a_rem = _limit_and_remaining(alim, row.assessments_used)
    p_out, p_rem = _limit_and_remaining(plim, row.plagiarism_used)
    return {
        "assessments_used": row.assessments_used,
        "assessments_limit": a_out,
        "plagiarism_used": row.plagiarism_used,
        "plagiarism_limit": p_out,
        "remaining_assessments": a_rem,
        "remaining_plagiarism": p_rem,
    }
