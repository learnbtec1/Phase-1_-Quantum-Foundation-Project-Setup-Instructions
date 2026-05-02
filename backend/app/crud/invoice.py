# -*- coding: utf-8 -*-
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from psycopg.rows import dict_row

from app.db.models import Invoice
from app.db.session import get_db_connection


def create_invoice(
    user_id: int,
    amount_cents: int,
    currency: str,
    status: str,
    *,
    plan_key: Optional[str] = None,
    stripe_checkout_session_id: Optional[str] = None,
    stripe_invoice_id: Optional[str] = None,
    stripe_payment_intent_id: Optional[str] = None,
) -> int:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO invoices (
                    user_id, amount_cents, currency, status, plan_key,
                    stripe_checkout_session_id, stripe_invoice_id, stripe_payment_intent_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    amount_cents,
                    currency,
                    status,
                    plan_key,
                    stripe_checkout_session_id,
                    stripe_invoice_id,
                    stripe_payment_intent_id,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return int(row[0]) if row else 0


def invoice_exists_for_stripe_invoice_id(stripe_invoice_id: Optional[str]) -> bool:
    iid = (stripe_invoice_id or "").strip()
    if not iid:
        return False
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM invoices WHERE stripe_invoice_id = %s LIMIT 1",
                (iid,),
            )
            return cur.fetchone() is not None


def try_link_stripe_invoice_to_recent_checkout_invoice(
    user_id: int,
    stripe_invoice_id: str,
    within_minutes: int = 180,
) -> bool:
    """
    Avoid double rows for first charge: attach Stripe invoice id to the latest checkout row
    (no stripe_invoice_id yet) within the time window. Amount may differ (tax) so we do not
    match on amount_cents.
    """
    iid = (stripe_invoice_id or "").strip()
    if not iid:
        return False
    since = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE invoices
                SET stripe_invoice_id = %s
                WHERE id = (
                    SELECT i.id FROM invoices i
                    WHERE i.user_id = %s
                      AND i.stripe_invoice_id IS NULL
                      AND i.created_at >= %s
                    ORDER BY i.id DESC
                    LIMIT 1
                )
                RETURNING id
                """,
                (iid, user_id, since),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None and row[0] is not None


def invoice_exists_for_checkout_session(stripe_checkout_session_id: Optional[str]) -> bool:
    sid = (stripe_checkout_session_id or "").strip()
    if not sid:
        return False
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM invoices WHERE stripe_checkout_session_id = %s LIMIT 1",
                (sid,),
            )
            return cur.fetchone() is not None


def list_invoices_for_user(user_id: int, limit: int = 50) -> List[Invoice]:
    with get_db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, user_id, amount_cents, currency, status,
                       stripe_checkout_session_id, stripe_invoice_id, stripe_payment_intent_id,
                       plan_key, created_at
                FROM invoices
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            rows = cur.fetchall()
    out: List[Invoice] = []
    for r in rows:
        out.append(
            Invoice(
                id=int(r["id"]),
                user_id=int(r["user_id"]),
                amount_cents=int(r["amount_cents"]),
                currency=str(r["currency"] or "usd"),
                status=str(r["status"]),
                stripe_checkout_session_id=r.get("stripe_checkout_session_id"),
                stripe_invoice_id=r.get("stripe_invoice_id"),
                stripe_payment_intent_id=r.get("stripe_payment_intent_id"),
                plan_key=r.get("plan_key"),
                created_at=r["created_at"],
            )
        )
    return out
