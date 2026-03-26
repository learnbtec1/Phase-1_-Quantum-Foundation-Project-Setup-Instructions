# -*- coding: utf-8 -*-
"""V28 — training export, RL stub hooks."""

from __future__ import annotations

import csv
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.config import settings
from app.models.db_models import TrainingData, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/digital-human", tags=["digital-human"])


@router.get("/training-export")
def export_training_csv(
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
    limit: int = Query(5000, ge=1, le=50_000),
):
    if not settings.ENABLE_TRAINING_DATA:
        raise HTTPException(status_code=404, detail="Training data disabled")
    rows = db.query(TrainingData).order_by(TrainingData.created_at.desc()).limit(limit).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "user_id", "prompt", "response", "score", "created_at", "meta"])
    for r in rows:
        w.writerow(
            [
                str(r.id),
                str(r.user_id) if r.user_id else "",
                (r.prompt or "")[:8000],
                (r.response or "")[:8000],
                r.score,
                r.created_at.isoformat() if r.created_at else "",
                str(r.meta or ""),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="training_data.csv"'},
    )
