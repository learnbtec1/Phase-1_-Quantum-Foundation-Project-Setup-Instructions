# -*- coding: utf-8 -*-
"""Lightweight row types (not ORM). Tables: users, documents; vectors in `embedding_chunks` (see vector_service)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class User:
    id: int
    email: str
    password_hash: str
    is_active: bool
    created_at: datetime
    role: str
    subscription_plan: str
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    # Stripe subscription snapshot (synced from webhooks; fallback when live API fails)
    sub_status: Optional[str]
    sub_period_end: Optional[datetime]
    sub_cancel_at_end: bool
    totp_secret: Optional[str]
    totp_enabled: bool
    is_verified: bool
    # Hash of one-time email verification link (SHA-256 hex); raw token only in email.
    verification_token_hash: Optional[str]
    verification_token_expires_at: Optional[datetime]


@dataclass
class Document:
    id: int
    user_id: Optional[int]
    title: Optional[str]
    file_path: Optional[str]
    created_at: datetime


@dataclass
class Invoice:
    id: int
    user_id: int
    amount_cents: int
    currency: str
    status: str
    stripe_checkout_session_id: Optional[str]
    stripe_invoice_id: Optional[str]
    stripe_payment_intent_id: Optional[str]
    plan_key: Optional[str]
    created_at: datetime
