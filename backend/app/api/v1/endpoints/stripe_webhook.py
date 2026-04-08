# -*- coding: utf-8 -*-
"""Stripe subscription webhooks (Phase C) — test mode by default."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def stripe_webhook(request: Request) -> dict:
    """Handle `customer.subscription.created` / `customer.subscription.deleted` (stub)."""
    secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
    payload = await request.body()
    sig = request.headers.get("stripe-signature") or ""

    if settings.is_production and not secret:
        logger.error("STRIPE_WEBHOOK_SECRET missing in production — rejecting webhook")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="STRIPE_WEBHOOK_SECRET is required in production",
        )

    if not secret:
        logger.warning("STRIPE_WEBHOOK_SECRET not set — acknowledge without verify (dev only)")
        return {"received": False, "detail": "configure STRIPE_WEBHOOK_SECRET for verified webhooks"}

    try:
        import stripe
    except ImportError:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="stripe package not installed")

    stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not stripe.api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="STRIPE_SECRET_KEY not set")

    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=sig, secret=secret)
    except Exception as e:
        logger.warning("Stripe webhook verify failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature") from e

    et = event.get("type") if isinstance(event, dict) else getattr(event, "type", None)
    logger.info("Stripe event: %s", et)
    # Production: map customer → users.subscription_plan via metadata user_id
    return {"received": True, "type": et}
