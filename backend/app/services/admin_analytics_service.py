# -*- coding: utf-8 -*-
"""
Aggregated read-only admin metrics.
- usage_stats: monthly quota totals (unchanged)
- usage_events: per-request log for daily charts and 7-day active users
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from psycopg.rows import dict_row

from app.db.session import get_db_connection

ACTIVE_USERS_DAYS = 7
USAGE_SPIKE_RATIO = 1.5  # 50% increase vs prior window
REVENUE_DROP_RATIO = 0.5  # current < 50% of prior window

PlatformStatus = Literal["healthy", "attention"]
AlertSeverity = Literal["info", "warning", "critical"]


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def fetch_admin_stats() -> dict[str, Any]:
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT COUNT(*)::bigint AS c FROM users")
            total_users = int((cur.fetchone() or {})["c"] or 0)
            # At least one usage event in the rolling window (real activity)
            cur.execute(
                f"""
                SELECT COUNT(DISTINCT user_id)::bigint AS c
                FROM usage_events
                WHERE created_at >= (NOW() AT TIME ZONE 'UTC' - INTERVAL '{ACTIVE_USERS_DAYS} days')
                """
            )
            active_users = int((cur.fetchone() or {})["c"] or 0)
            cur.execute("SELECT COALESCE(SUM(assessments_used), 0)::bigint AS s FROM usage_stats")
            total_assessments = int((cur.fetchone() or {})["s"] or 0)
            cur.execute("SELECT COALESCE(SUM(plagiarism_used), 0)::bigint AS s FROM usage_stats")
            total_plagiarism = int((cur.fetchone() or {})["s"] or 0)
            cur.execute(
                """
                SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s
                FROM invoices
                WHERE LOWER(status) IN ('paid', 'succeeded', 'complete')
                """
            )
            total_revenue_cents = int((cur.fetchone() or {})["s"] or 0)
            cur.execute(
                "SELECT COUNT(*)::bigint AS c FROM users WHERE LOWER(subscription_plan) = 'pro'"
            )
            pro_users = int((cur.fetchone() or {})["c"] or 0)
            cur.execute(
                "SELECT COUNT(*)::bigint AS c FROM users WHERE LOWER(subscription_plan) = 'unlimited'"
            )
            unlimited_users = int((cur.fetchone() or {})["c"] or 0)
    return {
        "total_users": total_users,
        "active_users": active_users,
        "active_users_window_days": ACTIVE_USERS_DAYS,
        "active_users_definition": (
            f"Distinct users with at least one row in usage_events in the last {ACTIVE_USERS_DAYS} days (UTC)."
        ),
        "total_assessments": total_assessments,
        "total_plagiarism_checks": total_plagiarism,
        "total_revenue_cents": total_revenue_cents,
        "pro_users": pro_users,
        "unlimited_users": unlimited_users,
    }


def _monthly_usage(cur, months: int) -> list[dict[str, Any]]:
    m = max(1, min(24, int(months)))
    cur.execute(
        f"""
        SELECT
          date_trunc('month', period_start AT TIME ZONE 'UTC')::date AS month,
          COALESCE(SUM(assessments_used), 0)::bigint AS assessments,
          COALESCE(SUM(plagiarism_used), 0)::bigint AS plagiarism,
          COALESCE(SUM(total_requests), 0)::bigint AS total_requests
        FROM usage_stats
        WHERE period_start >= (
          date_trunc('month', (NOW() AT TIME ZONE 'UTC')::timestamptz)
            - (INTERVAL '1 month' * {m - 1})
        )
        GROUP BY 1
        ORDER BY 1
        """
    )
    rows = cur.fetchall() or []
    return [
        {
            "month": r["month"].isoformat() if r["month"] else "",
            "assessments": int(r["assessments"] or 0),
            "plagiarism": int(r["plagiarism"] or 0),
            "total_requests": int(r["total_requests"] or 0),
        }
        for r in rows
    ]


def _fetch_daily_from_events(cur, start_day: date, end_day: date) -> list[dict[str, Any]]:
    """Real per-day counts from usage_events (UTC calendar dates)."""
    cur.execute(
        """
        WITH days AS (
          SELECT d::date AS day
          FROM generate_series(
            %s::date,
            %s::date,
            '1 day'::interval
          ) AS d
        ),
        agg AS (
          SELECT
            (ue.created_at AT TIME ZONE 'UTC')::date AS day,
            COUNT(*) FILTER (WHERE ue.event_type = 'assessment')::bigint AS assessments,
            COUNT(*) FILTER (WHERE ue.event_type = 'plagiarism')::bigint AS plagiarism
          FROM usage_events ue
          WHERE (ue.created_at AT TIME ZONE 'UTC')::date >= %s
            AND (ue.created_at AT TIME ZONE 'UTC')::date <= %s
          GROUP BY 1
        )
        SELECT
          days.day,
          COALESCE(agg.assessments, 0)::bigint AS assessments,
          COALESCE(agg.plagiarism, 0)::bigint AS plagiarism
        FROM days
        LEFT JOIN agg ON agg.day = days.day
        ORDER BY days.day
        """,
        (start_day, end_day, start_day, end_day),
    )
    rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for r in rows:
        a = int(r["assessments"] or 0)
        p = int(r["plagiarism"] or 0)
        out.append(
            {
                "date": r["day"].isoformat() if r["day"] else "",
                "assessments": a,
                "plagiarism": p,
                "total_requests": a + p,
                "granularity": "usage_events_utc",
            }
        )
    return out


def _fetch_top_users_by_usage(cur, limit: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        WITH agg AS (
          SELECT
            user_id,
            COALESCE(SUM(assessments_used), 0)::bigint AS assessments,
            COALESCE(SUM(plagiarism_used), 0)::bigint AS plagiarism,
            COALESCE(SUM(total_requests), 0)::bigint AS total_requests
          FROM usage_stats
          GROUP BY user_id
        )
        SELECT
          u.id,
          u.email,
          u.subscription_plan,
          COALESCE(a.total_requests, 0)::bigint AS total_usage,
          GREATEST(
            (SELECT MAX(s.created_at) FROM usage_stats s WHERE s.user_id = u.id::text),
            (SELECT MAX(i.created_at) FROM invoices i WHERE i.user_id = u.id),
            (SELECT MAX(ue.created_at) FROM usage_events ue WHERE ue.user_id = u.id),
            u.sub_period_end
          ) AS last_active
        FROM users u
        LEFT JOIN agg a ON a.user_id = u.id::text
        WHERE LOWER(COALESCE(u.role, 'student')) <> 'admin'
        ORDER BY total_usage DESC NULLS LAST, u.id ASC
        LIMIT %s
        """,
        (limit,),
    )
    rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for r in rows:
        la = r.get("last_active")
        if la is not None and isinstance(la, datetime):
            la_out = la.astimezone(timezone.utc).isoformat()
        else:
            la_out = None
        out.append(
            {
                "email": str(r.get("email") or ""),
                "total_usage": int(r.get("total_usage") or 0),
                "plan": str(r.get("subscription_plan") or "free"),
                "last_active_utc": la_out,
            }
        )
    return out


def fetch_admin_usage() -> dict[str, Any]:
    end = _today_utc()
    start = end - timedelta(days=29)
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            daily = _fetch_daily_from_events(cur, start, end)
            by_month = _monthly_usage(cur, 12)
            top = _fetch_top_users_by_usage(cur, 25)
    return {
        "daily": daily,
        "monthly": by_month,
        "top_users": top,
        "method_note": "Daily series counts rows in usage_events (UTC dates). "
        "Monthly bars remain aggregated from usage_stats (quota months).",
    }


def fetch_admin_revenue() -> dict[str, Any]:
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT
                  (date_trunc('month', created_at AT TIME ZONE 'UTC'))::date AS month,
                  COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
                FROM invoices
                WHERE LOWER(COALESCE(status, '')) IN ('paid', 'succeeded', 'complete')
                  AND created_at >= (
                    date_trunc('month', (NOW() AT TIME ZONE 'UTC')::timestamptz)
                    - INTERVAL '23 months'
                  )
                GROUP BY 1
                ORDER BY 1
                """
            )
            rev_rows = cur.fetchall() or []
            cur.execute("SELECT COUNT(*)::bigint AS c FROM invoices")
            total_invoices = int((cur.fetchone() or {})["c"] or 0)
            cur.execute(
                """
                SELECT COUNT(*)::bigint AS c
                FROM invoices
                WHERE LOWER(COALESCE(status, '')) IN (
                  'failed', 'payment_failed', 'void', 'uncollectible', 'unpaid', 'refunded'
                )
                """
            )
            failed_payments = int((cur.fetchone() or {})["c"] or 0)
    revenue_by_month = [
        {
            "month": r["month"].isoformat() if r["month"] else "",
            "revenue_cents": int(r["amount_cents"] or 0),
        }
        for r in rev_rows
    ]
    return {
        "revenue_by_month": revenue_by_month,
        "total_invoices": total_invoices,
        "failed_payments": failed_payments,
    }


def _count_events_window(cur, start: datetime, end: datetime) -> int:
    cur.execute(
        """
        SELECT COUNT(*)::bigint AS c
        FROM usage_events
        WHERE created_at >= %s AND created_at < %s
        """,
        (start, end),
    )
    return int((cur.fetchone() or {})["c"] or 0)


def _revenue_cents_window(cur, start: datetime, end: datetime) -> int:
    cur.execute(
        """
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s
        FROM invoices
        WHERE LOWER(COALESCE(status, '')) IN ('paid', 'succeeded', 'complete')
          AND created_at >= %s AND created_at < %s
        """,
        (start, end),
    )
    return int((cur.fetchone() or {})["s"] or 0)


def fetch_admin_insights() -> dict[str, Any]:
    """Lightweight rules for admin banners (no ML)."""
    now = datetime.now(timezone.utc)
    alerts: list[dict[str, Any]] = []

    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur7_end = now
            cur7_start = now - timedelta(days=7)
            prev7_end = cur7_start
            prev7_start = now - timedelta(days=14)
            ev_cur = _count_events_window(cur, cur7_start, cur7_end)
            ev_prev = _count_events_window(cur, prev7_start, prev7_end)

            rev_cur = _revenue_cents_window(cur, cur7_start, cur7_end)
            rev_prev = _revenue_cents_window(cur, prev7_start, prev7_end)

            cur.execute(
                "SELECT COUNT(*)::bigint AS c FROM users WHERE created_at >= %s",
                (now - timedelta(hours=24),),
            )
            new_users_24h = int((cur.fetchone() or {})["c"] or 0)
            cur.execute("SELECT COUNT(*)::bigint AS c FROM users")
            total_users = int((cur.fetchone() or {})["c"] or 0)
            cur.execute(
                """
                SELECT COUNT(*)::bigint AS c
                FROM invoices
                WHERE LOWER(COALESCE(status, '')) IN (
                  'failed', 'payment_failed', 'void', 'uncollectible', 'unpaid', 'refunded'
                )
                """
            )
            failed_payments = int((cur.fetchone() or {})["c"] or 0)

    if failed_payments > 0:
        alerts.append(
            {
                "id": "failed_payments",
                "severity": "warning",
                "message": f"There are {failed_payments} invoice(s) in failed/void/unpaid state in the database. Review billing.",
                "message_ar": f"توجد {failed_payments} فاتورة بحالة فشل/مشكلة دفع. راجع الفوترة.",
            }
        )

    if total_users > 0 and new_users_24h == 0:
        alerts.append(
            {
                "id": "no_new_users_24h",
                "severity": "info",
                "message": "No new user sign-ups in the last 24 hours.",
                "message_ar": "لا يوجد مستخدمون جدد خلال آخر 24 ساعة.",
            }
        )

    spike = False
    if ev_prev > 0 and ev_cur >= USAGE_SPIKE_RATIO * ev_prev:
        spike = True
    elif ev_prev == 0 and ev_cur >= 20:
        spike = True
    if spike:
        pct = 0.0
        if ev_prev > 0:
            pct = (ev_cur - ev_prev) / float(ev_prev) * 100.0
        alerts.append(
            {
                "id": "usage_spike",
                "severity": "warning",
                "message": (
                    f"Usage events up sharply: {ev_cur} in the last 7d vs {ev_prev} in the previous 7d"
                    + (f" (~{pct:.0f}% change)." if ev_prev else ".")
                ),
                "message_ar": (
                    f"قفز استخدام المنصة: {ev_cur} حدثاً في آخر 7 أيام مقابل {ev_prev} في الأيام السبعة السابقة."
                ),
            }
        )

    if rev_prev > 0 and rev_cur < REVENUE_DROP_RATIO * rev_prev:
        drop = (1.0 - rev_cur / float(rev_prev)) * 100.0
        alerts.append(
            {
                "id": "revenue_drop",
                "severity": "warning",
                "message": (
                    f"Paid revenue in the last 7d is much lower than the prior 7d (~{drop:.0f}% down vs previous window)."
                ),
                "message_ar": "الإيرادات المدفوعة في آخر 7 أيام أقل بكثير مقارنة بالأسبوعين السابقين.",
            }
        )

    serious = any(a.get("severity") in ("warning", "critical") for a in alerts)
    status: PlatformStatus = "attention" if serious else "healthy"

    return {
        "platform_status": status,
        "alerts": alerts,
        "windows": {
            "usage_spike_compared": "7d vs previous 7d (UTC) event counts",
            "revenue_compared": "7d vs previous 7d paid invoice sums",
        },
    }
