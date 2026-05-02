# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Union

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.crud import invoice as invoice_crud
from app.crud import user as user_crud
from app.db.models import Invoice, User

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)

# Paid checkout keys: legacy basic/advanced/pro + unlimited; primary SaaS = pro, unlimited
PlanKey = Literal["basic", "advanced", "pro", "unlimited"]
NewPlanType = Literal["pro", "unlimited"]

_VALID_PLANS = frozenset({"basic", "advanced", "pro", "unlimited"})

# Note: plan changes are applied ONLY from Stripe-backed paths (webhook, verify-session).
# There is no user-facing API to set subscription_plan directly.


def _stripe_configured() -> bool:
    return bool((settings.STRIPE_SECRET_KEY or "").strip())


def _init_stripe() -> None:
    stripe.api_key = settings.STRIPE_SECRET_KEY
    stripe.api_version = settings.STRIPE_API_VERSION


def _plan_key_for_stripe_price_id(price_id: Optional[str]) -> Optional[str]:
    """Map a Stripe Price id to internal plan key (env-configured)."""
    if not price_id or not str(price_id).strip():
        return None
    pid = str(price_id).strip()
    pairs: list[tuple[str, str]] = [
        ("unlimited", (settings.STRIPE_PRICE_ID_UNLIMITED or "").strip()),
        ("pro", (settings.STRIPE_PRICE_PRO or "").strip()),
        ("advanced", (settings.STRIPE_PRICE_ADVANCED or "").strip()),
        ("basic", (settings.STRIPE_PRICE_BASIC or "").strip()),
    ]
    for key, env in pairs:
        if env and pid == env:
            return key
    return None


def _first_price_id_from_subscription_object(sub: Any) -> Optional[str]:
    items = sub.get("items") if hasattr(sub, "get") else None
    data: list[Any] = []
    if isinstance(items, dict):
        data = list(items.get("data") or [])
    elif isinstance(items, list):
        data = list(items)
    if not data:
        return None
    first = data[0]
    if not isinstance(first, dict):
        return None
    price = first.get("price")
    if isinstance(price, str):
        return price.strip() or None
    if isinstance(price, dict):
        rid = price.get("id")
        return str(rid).strip() if rid else None
    return None


def _stripe_customer_id_str(cust: Any) -> str:
    if isinstance(cust, str):
        return cust.strip()
    if isinstance(cust, dict) and cust.get("id"):
        return str(cust["id"]).strip()
    return ""


def _period_end_dt_from_unix(cpe: Any) -> Optional[datetime]:
    if cpe is None:
        return None
    try:
        return datetime.fromtimestamp(int(cpe), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _first_price_id_from_invoice_object(inv: Dict[str, Any]) -> Optional[str]:
    lines = inv.get("lines")
    if isinstance(lines, dict):
        for li in lines.get("data") or []:
            if not isinstance(li, dict):
                continue
            price = li.get("price")
            if isinstance(price, str):
                return price.strip() or None
            if isinstance(price, dict) and price.get("id"):
                return str(price["id"]).strip()
    return None


def _price_id_for_plan(plan: str) -> str:
    p = (plan or "").strip().lower()
    mapping: dict[str, str] = {
        "basic": (settings.STRIPE_PRICE_BASIC or "").strip(),
        "advanced": (settings.STRIPE_PRICE_ADVANCED or "").strip(),
        "pro": (settings.STRIPE_PRICE_PRO or "").strip(),
        "unlimited": (settings.STRIPE_PRICE_ID_UNLIMITED or "").strip(),
    }
    pid = mapping.get(p, "")
    if not pid:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Stripe price not configured for plan '{p}'",
        )
    return pid


def _build_checkout_session_urls(success_path: str, cancel_path: str) -> tuple[str, str]:
    base = settings.FRONTEND_URL.rstrip("/")
    sp = success_path if success_path.startswith("/") else f"/{success_path}"
    cp = cancel_path if cancel_path.startswith("/") else f"/{cancel_path}"
    success_base = f"{base}{sp}"
    cancel_url = f"{base}{cp}"
    sep = "&" if "?" in success_base else "?"
    success_url = f"{success_base}{sep}session_id={{CHECKOUT_SESSION_ID}}"
    return success_url, cancel_url


def _create_subscription_checkout(
    user: User,
    plan: str,
    success_path: str,
    cancel_path: str,
) -> tuple[str, str]:
    price_id = _price_id_for_plan(plan)
    _init_stripe()

    success_url, cancel_url = _build_checkout_session_urls(success_path, cancel_path)
    customer_id = (user.stripe_customer_id or "").strip() or None
    if not customer_id:
        cust = stripe.Customer.create(email=user.email, metadata={"user_id": str(user.id)})
        customer_id = cust["id"]
        user_crud.set_stripe_customer_id(user.id, customer_id)

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=str(user.id),
        metadata={"user_id": str(user.id), "plan_key": plan},
        subscription_data={"metadata": {"user_id": str(user.id), "plan_key": plan}},
    )
    sid = session.get("id")
    surl = session.get("url")
    if not sid or not surl:
        raise HTTPException(status_code=502, detail="Could not start checkout")
    return str(surl), str(sid)


def _session_user_id(sess: Any) -> Optional[int]:
    try:
        meta = sess.get("metadata") or {}
        if meta.get("user_id"):
            return int(str(meta["user_id"]))
    except (TypeError, ValueError):
        pass
    if sess.get("client_reference_id"):
        try:
            return int(str(sess["client_reference_id"]))
        except (TypeError, ValueError):
            return None
    return None


def _apply_paid_subscription_checkout(sess: Any) -> None:
    """
    Idempotent: set plan + subscription id; one invoice per checkout session.
    Used by webhook and GET /verify-session. Does not trust client input for plan
    (plan_key is taken from the Checkout Session metadata that Stripe returns).
    """
    user_id = _session_user_id(sess)
    if not user_id:
        logger.warning("checkout session without user_id: %s", sess.get("id"))
        return
    u = user_crud.get_user_by_id(user_id)
    if not u:
        return

    plan_key = (sess.get("metadata") or {}).get("plan_key") or "pro"
    if plan_key not in _VALID_PLANS:
        plan_key = "pro"
    user_crud.set_subscription_plan(u.id, str(plan_key))

    raw_sub = sess.get("subscription")
    if raw_sub is not None:
        if isinstance(raw_sub, str):
            sub_id = raw_sub
        else:
            sub_id = str(raw_sub.get("id") if isinstance(raw_sub, dict) else getattr(raw_sub, "id", None) or "")
        if sub_id:
            user_crud.set_stripe_subscription_id(u.id, sub_id)

    checkout_sid = str(sess.get("id") or "")
    if checkout_sid and invoice_crud.invoice_exists_for_checkout_session(checkout_sid):
        return

    amt = sess.get("amount_total")
    if amt is None:
        amt = 0
    try:
        amount_cents = int(amt)
    except (TypeError, ValueError):
        amount_cents = 0
    currency = (sess.get("currency") or "usd").lower()
    pi = sess.get("payment_intent")
    if isinstance(pi, str):
        pi_s = pi
    elif isinstance(pi, dict) and pi.get("id"):
        pi_s = str(pi["id"])
    else:
        pi_s = None
    invoice_crud.create_invoice(
        u.id,
        amount_cents,
        currency,
        "paid",
        plan_key=str(plan_key),
        stripe_checkout_session_id=checkout_sid or None,
        stripe_payment_intent_id=pi_s,
    )


def _handle_checkout_completed(sess: Union[Dict[str, Any], Any]) -> dict[str, str]:
    _apply_paid_subscription_checkout(sess)
    return {"detail": "ok"}


class CreateCheckoutBody(BaseModel):
    plan: PlanKey
    success_path: str = Field(default="/success", max_length=256)
    cancel_path: str = Field(default="/cancel", max_length=256)


class CreateCheckoutByPlanTypeBody(BaseModel):
    plan_type: NewPlanType
    success_path: str = Field(default="/success", max_length=256)
    cancel_path: str = Field(default="/cancel", max_length=256)


class CancelSubscriptionBody(BaseModel):
    """Cancel at end of current period (default) or immediately."""

    at_period_end: bool = True


class InvoiceOut(BaseModel):
    id: int
    amount_cents: int
    currency: str
    status: str
    plan_key: Optional[str] = None
    created_at: str


class BillingMeOut(BaseModel):
    """Authoritative subscription view for the UI. Plan on free tier is always from DB."""

    plan: str
    subscription_status: str
    renewal_date: Optional[str] = None
    cancel_at_period_end: bool = False
    stripe_customer_configured: bool = False


@router.get("/config")
def billing_config() -> dict[str, bool]:
    return {
        "stripe_configured": _stripe_configured(),
    }


@router.get("/plans")
def public_plans() -> dict[str, Any]:
    """Static plan copy (amounts in Stripe; configure price IDs in env)."""
    return {
        "plans": [
            {
                "key": "free",
                "name": "Free",
                "price_label": "£0",
                "features": [
                    "BTEC assessment & plagiarism (monthly fair-use caps)",
                    "Core dashboards",
                ],
            },
            {
                "key": "pro",
                "name": "Pro",
                "price_label": "Monthly · see checkout",
                "features": [
                    "Higher monthly assessment & plagiarism limits",
                    "Priority usage tier",
                ],
            },
            {
                "key": "unlimited",
                "name": "Unlimited",
                "price_label": "Monthly · see checkout",
                "features": [
                    "No usage caps (assessment + plagiarism)",
                    "Best for schools & power users",
                ],
            },
        ],
    }


@router.get("/me", response_model=BillingMeOut)
@limiter.limit("60/minute")
def get_billing_profile(
    request: Request,  # noqa: ARG001
    user: User = Depends(get_current_user),
) -> BillingMeOut:
    """
    Return plan + live Stripe subscription status (when applicable).
    Never accepts client-supplied plan — reads DB + Stripe API only.
    """
    has_customer = bool((user.stripe_customer_id or "").strip())
    out = BillingMeOut(
        plan=(user.subscription_plan or "free").lower(),
        subscription_status="none",
        renewal_date=None,
        cancel_at_period_end=False,
        stripe_customer_configured=has_customer,
    )
    p = (user.subscription_plan or "free").lower()
    sub_id = (user.stripe_subscription_id or "").strip()
    if not _stripe_configured():
        out.subscription_status = "billing_unconfigured"
        return out
    if p == "free":
        return out
    if not sub_id:
        out.subscription_status = "unknown"
        return out

    _init_stripe()
    try:
        sub: Any = stripe.Subscription.retrieve(sub_id)
    except Exception as e:
        logger.warning("Subscription retrieve failed for user %s: %s", user.id, e)
        if getattr(user, "sub_status", None):
            out.subscription_status = str(user.sub_status)
            out.cancel_at_period_end = bool(getattr(user, "sub_cancel_at_end", False))
            pe = getattr(user, "sub_period_end", None)
            if pe is not None:
                try:
                    out.renewal_date = pe.astimezone(timezone.utc).strftime("%Y-%m-%d")
                except Exception:
                    pass
        else:
            out.subscription_status = "unknown"
        return out

    st = str(sub.get("status") or "unknown")
    out.subscription_status = st
    out.cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    cpe = sub.get("current_period_end")
    if cpe is not None:
        try:
            ts = int(cpe)
            out.renewal_date = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            pass
    return out


@router.get("/verify-session")
@limiter.limit("20/minute")
def verify_checkout_session(
    request: Request,  # noqa: ARG001
    session_id: str,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Synchronously confirm Checkout after redirect if webhook is delayed.
    Re-reads the session from Stripe; updates plan only if payment is complete and the
    session belongs to the current user. Does not accept plan from the client.
    """
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    raw = (session_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="session_id is required")

    _init_stripe()
    try:
        sess = stripe.checkout.Session.retrieve(raw, expand=["subscription"])
    except Exception as e:
        logger.info("Session retrieve failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid or unknown session_id") from e

    if _session_user_id(sess) != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This checkout session does not belong to the current user",
        )
    if sess.get("mode") != "subscription":
        raise HTTPException(status_code=400, detail="Not a subscription checkout session")

    st = str(sess.get("status") or "")
    pay = str(sess.get("payment_status") or "")
    if st != "complete":
        u = user_crud.get_user_by_id(user.id)
        return {
            "verified": False,
            "plan": (u and u.subscription_plan) or user.subscription_plan,
            "payment_status": pay or None,
            "session_status": st,
            "detail": "session_not_complete",
        }
    if pay not in ("paid", "no_payment_required"):
        u = user_crud.get_user_by_id(user.id)
        return {
            "verified": False,
            "plan": (u and u.subscription_plan) or user.subscription_plan,
            "payment_status": pay,
            "detail": f"payment_not_satisfied:{pay}",
        }

    _apply_paid_subscription_checkout(sess)
    u2 = user_crud.get_user_by_id(user.id)
    return {
        "verified": True,
        "plan": (u2 and u2.subscription_plan) or user.subscription_plan,
        "payment_status": pay,
    }


@router.post("/create-checkout")
@limiter.limit("15/minute")
def create_checkout(
    request: Request,  # noqa: ARG001
    body: CreateCheckoutByPlanTypeBody,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Start Stripe Checkout for `pro` or `unlimited` (metadata carries user_id; plan applied via Stripe)."""
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    url, _sess_id = _create_subscription_checkout(
        user, body.plan_type, body.success_path, body.cancel_path
    )
    return {"url": url, "session_id": _sess_id}


@router.post("/create-checkout-session")
@limiter.limit("15/minute")
def create_checkout_session(
    request: Request,  # noqa: ARG001
    body: CreateCheckoutBody,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    url, sid = _create_subscription_checkout(user, body.plan, body.success_path, body.cancel_path)
    return {"checkout_url": url, "id": sid}


@router.post("/cancel")
@router.post("/cancel-subscription", include_in_schema=False)
@limiter.limit("8/minute")
def cancel_subscription(
    request: Request,  # noqa: ARG001
    body: CancelSubscriptionBody = CancelSubscriptionBody(),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Cancel the current Stripe subscription for this user. Plan is not set from the client;
    DB/webhooks reflect Stripe's final state.
    """
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Billing is not configured")
    sub_id = (user.stripe_subscription_id or "").strip()
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active subscription to cancel")
    _init_stripe()
    try:
        if body.at_period_end:
            stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
        else:
            stripe.Subscription.delete(sub_id)
    except Exception as e:
        logger.warning("Stripe cancel failed for user %s: %s", user.id, e)
        raise HTTPException(status_code=502, detail="Could not cancel subscription in Stripe") from e
    if not body.at_period_end:
        user_crud.set_subscription_plan(user.id, "free")
        user_crud.set_stripe_subscription_id(user.id, None)
        user_crud.clear_subscription_stripe_snapshot(user.id)
    return {
        "detail": "canceled_at_period_end" if body.at_period_end else "canceled_immediately",
    }


@router.get("/invoices", response_model=List[InvoiceOut])
def list_my_invoices(user: User = Depends(get_current_user)) -> List[InvoiceOut]:
    invs: List[Invoice] = invoice_crud.list_invoices_for_user(user.id)
    return [
        InvoiceOut(
            id=i.id,
            amount_cents=i.amount_cents,
            currency=i.currency,
            status=i.status,
            plan_key=i.plan_key,
            created_at=i.created_at.isoformat() if i.created_at else "",
        )
        for i in invs
    ]


@router.post("/webhook", include_in_schema=True)
@limiter.limit("120/minute")
async def stripe_webhook(request: Request) -> dict[str, str]:
    if not (settings.STRIPE_WEBHOOK_SECRET or "").strip():
        raise HTTPException(status_code=503, detail="Webhook not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not sig:
        raise HTTPException(status_code=400, detail="Missing stripe-signature")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid payload") from e
    except Exception as e:
        if e.__class__.__name__ == "SignatureVerificationError":
            raise HTTPException(status_code=400, detail="Invalid signature") from e
        raise

    _init_stripe()
    etype = event.get("type", "")

    if etype == "checkout.session.completed":
        sess = event.get("data", {}).get("object", {}) or {}
        return _handle_checkout_completed(sess)
    if etype in ("customer.subscription.deleted", "customer.subscription.canceled"):
        sub = event.get("data", {}).get("object", {}) or {}
        return _handle_subscription_ended(sub)
    if etype == "invoice.payment_failed":
        inv = event.get("data", {}).get("object", {}) or {}
        return _handle_invoice_payment_failed(inv)
    if etype == "customer.subscription.updated":
        sub = event.get("data", {}).get("object", {}) or {}
        return _handle_subscription_updated(sub)
    if etype == "invoice.payment_succeeded":
        inv = event.get("data", {}).get("object", {}) or {}
        return _handle_invoice_payment_succeeded(inv)

    return {"detail": f"ignored:{etype}"}


def _handle_subscription_updated(sub: Dict[str, Any]) -> dict[str, str]:
    """Sync subscription lifecycle + plan from Stripe (dashboard edits, trial, cancel flags)."""
    sub_id = str(sub.get("id") or "").strip()
    u: Optional[User] = None
    if sub_id:
        u = user_crud.get_user_by_stripe_subscription_id(sub_id)
    cstr = _stripe_customer_id_str(sub.get("customer"))
    if not u and cstr:
        u = user_crud.get_user_by_stripe_customer(cstr)
    if not u:
        return {"detail": "no_user"}

    st = str(sub.get("status") or "")
    cat = bool(sub.get("cancel_at_period_end"))
    pe_dt = _period_end_dt_from_unix(sub.get("current_period_end"))

    user_crud.update_subscription_stripe_snapshot(
        u.id,
        sub_status=st,
        sub_period_end=pe_dt,
        sub_cancel_at_end=cat,
    )

    price_id = _first_price_id_from_subscription_object(sub)
    mapped = _plan_key_for_stripe_price_id(price_id)
    if mapped and mapped != (u.subscription_plan or "").lower():
        user_crud.set_subscription_plan(u.id, mapped)

    if st in ("canceled", "incomplete_expired") and not cat:
        user_crud.set_subscription_plan(u.id, "free")
        user_crud.set_stripe_subscription_id(u.id, None)
        user_crud.clear_subscription_stripe_snapshot(u.id)
        return {"detail": "downgraded"}
    if st == "unpaid":
        user_crud.set_subscription_plan(u.id, "free")
        user_crud.set_stripe_subscription_id(u.id, None)
        user_crud.clear_subscription_stripe_snapshot(u.id)
        return {"detail": "downgraded_unpaid"}
    return {"detail": "ok"}


def _handle_invoice_payment_succeeded(inv: Dict[str, Any]) -> dict[str, str]:
    """Record paid renewals and new charges for revenue tracking (idempotent by Stripe invoice id)."""
    inv_id = str(inv.get("id") or "").strip()
    if not inv_id:
        return {"detail": "no_invoice_id"}
    if invoice_crud.invoice_exists_for_stripe_invoice_id(inv_id):
        return {"detail": "duplicate"}

    cstr = _stripe_customer_id_str(inv.get("customer"))
    if not cstr:
        return {"detail": "no_customer"}
    u = user_crud.get_user_by_stripe_customer(cstr)
    if not u:
        return {"detail": "no_user"}

    try:
        amount_cents = int(inv.get("amount_paid") or 0)
    except (TypeError, ValueError):
        amount_cents = 0
    currency = (inv.get("currency") or "usd").lower()
    br = str(inv.get("billing_reason") or "")

    if br == "subscription_create":
        if invoice_crud.try_link_stripe_invoice_to_recent_checkout_invoice(
            u.id, inv_id, within_minutes=180
        ):
            return {"detail": "linked_checkout_row"}

    plan_key = _plan_key_for_stripe_price_id(_first_price_id_from_invoice_object(inv))
    pi = inv.get("payment_intent")
    pi_s: Optional[str] = None
    if isinstance(pi, str):
        pi_s = pi
    elif isinstance(pi, dict) and pi.get("id"):
        pi_s = str(pi["id"])

    invoice_crud.create_invoice(
        u.id,
        amount_cents,
        currency,
        "paid",
        plan_key=plan_key,
        stripe_invoice_id=inv_id,
        stripe_checkout_session_id=None,
        stripe_payment_intent_id=pi_s,
    )
    return {"detail": "recorded"}


def _downgrade_to_free_for_customer(customer_id: str) -> dict[str, str]:
    cid = (customer_id or "").strip()
    if not cid:
        return {"detail": "no_customer"}
    u = user_crud.get_user_by_stripe_customer(cid)
    if u:
        user_crud.set_subscription_plan(u.id, "free")
        user_crud.set_stripe_subscription_id(u.id, None)
        user_crud.clear_subscription_stripe_snapshot(u.id)
    return {"detail": "downgraded" if u else "no_user"}


def _handle_invoice_payment_failed(inv: Dict[str, Any]) -> dict[str, str]:
    cust = inv.get("customer")
    cstr = cust if isinstance(cust, str) else ""
    if not cstr and isinstance(cust, dict):
        cstr = str(cust.get("id") or "")
    return _downgrade_to_free_for_customer(cstr)


def _handle_subscription_ended(sub: Dict[str, Any]) -> dict[str, str]:
    sub_id = str(sub.get("id") or "").strip()
    u: Optional[User] = None
    if sub_id:
        u = user_crud.get_user_by_stripe_subscription_id(sub_id)
    cust = sub.get("customer")
    cstr: str
    if isinstance(cust, str):
        cstr = cust.strip()
    elif isinstance(cust, dict):
        cstr = str(cust.get("id") or "").strip()
    else:
        cstr = ""
    if not u and cstr:
        u = user_crud.get_user_by_stripe_customer(cstr)
    if u:
        user_crud.set_subscription_plan(u.id, "free")
        user_crud.set_stripe_subscription_id(u.id, None)
        user_crud.clear_subscription_stripe_snapshot(u.id)
    return {"detail": "downgraded" if u else "no_user"}
