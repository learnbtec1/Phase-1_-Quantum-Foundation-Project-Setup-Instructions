# -*- coding: utf-8 -*-
"""Admin: usage / cost aggregates (Phase C)."""

from __future__ import annotations

import calendar
import datetime as dt
import logging
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.models.db_models import UsageLog, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


class UsageRow(BaseModel):
    user_id: str
    total_tokens: int
    total_cost: float
    service: str


@router.get("/usage/monthly", response_model=List[UsageRow])
def usage_monthly(
    year: int = dt.datetime.utcnow().year,
    month: int = dt.datetime.utcnow().month,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> List[UsageRow]:
    start = dt.datetime(year, month, 1, tzinfo=dt.timezone.utc)
    last_day = calendar.monthrange(year, month)[1]
    end = dt.datetime(year, month, last_day, 23, 59, 59, tzinfo=dt.timezone.utc)

    rows = (
        db.query(
            UsageLog.user_id,
            UsageLog.service,
            func.coalesce(func.sum(UsageLog.tokens_used), 0),
            func.coalesce(func.sum(UsageLog.cost), 0),
        )
        .filter(UsageLog.created_at >= start, UsageLog.created_at <= end)
        .filter(UsageLog.user_id.isnot(None))
        .group_by(UsageLog.user_id, UsageLog.service)
        .all()
    )
    out: List[UsageRow] = []
    for uid, svc, tok, cost in rows:
        if uid is None:
            continue
        out.append(
            UsageRow(
                user_id=str(uid),
                total_tokens=int(tok or 0),
                total_cost=float(cost or 0),
                service=str(svc),
            )
        )
    return out
