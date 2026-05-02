# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_admin
from app.db.models import User
from app.services import admin_analytics_service

router = APIRouter(prefix="/admin", tags=["admin-analytics"])


class AdminStatsOut(BaseModel):
    total_users: int
    active_users: int
    active_users_window_days: int = Field(
        default=7,
        description="Rolling window for active_users (distinct users with ≥1 usage_events row).",
    )
    active_users_definition: str = Field(
        default="",
        description="How active_users is computed.",
    )
    total_assessments: int
    total_plagiarism_checks: int
    total_revenue_cents: int = Field(description="Sum of successful invoice amount_cents")
    total_revenue: float = Field(description="Convenience: total_revenue_cents / 100 (USD, 2 d.p.)")
    pro_users: int
    unlimited_users: int


@router.get("/stats", response_model=AdminStatsOut)
def get_admin_stats(_admin: User = Depends(get_current_admin)) -> AdminStatsOut:
    try:
        raw = admin_analytics_service.fetch_admin_stats()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load admin stats",
        ) from exc
    cents = int(raw.get("total_revenue_cents") or 0)
    return AdminStatsOut(
        total_users=int(raw["total_users"]),
        active_users=int(raw["active_users"]),
        active_users_window_days=int(raw.get("active_users_window_days") or 7),
        active_users_definition=str(raw.get("active_users_definition") or ""),
        total_assessments=int(raw["total_assessments"]),
        total_plagiarism_checks=int(raw["total_plagiarism_checks"]),
        total_revenue_cents=cents,
        total_revenue=round(cents / 100.0, 2),
        pro_users=int(raw["pro_users"]),
        unlimited_users=int(raw["unlimited_users"]),
    )


@router.get("/usage")
def get_admin_usage(_admin: User = Depends(get_current_admin)) -> dict:
    try:
        return admin_analytics_service.fetch_admin_usage()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load admin usage",
        ) from exc


@router.get("/revenue")
def get_admin_revenue(_admin: User = Depends(get_current_admin)) -> dict:
    try:
        return admin_analytics_service.fetch_admin_revenue()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load admin revenue",
        ) from exc


@router.get("/insights")
def get_admin_insights(_admin: User = Depends(get_current_admin)) -> dict:
    try:
        return admin_analytics_service.fetch_admin_insights()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load admin insights",
        ) from exc
