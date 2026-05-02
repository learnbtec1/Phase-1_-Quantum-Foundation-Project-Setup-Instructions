# -*- coding: utf-8 -*-
"""
Teacher feedback loop + integrity weight inspection / retrain (see integrity_learning service).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.models import User
from app.services.integrity_composite import INTEGRITY_VERSION
from app.services.integrity_learning import (
    get_weights_status,
    insert_feedback,
    retrain_least_squares,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrity", tags=["integrity"])


class FeedbackIn(BaseModel):
    student_id: Optional[str] = None
    feedback: str = Field(..., min_length=1, description="Teacher note, e.g. false positive on this case.")
    action_taken: Optional[str] = Field(
        None,
        description="e.g. retrain, mark_false_positive, mark_confirmed, note",
    )
    teacher_label: Optional[str] = Field(
        None,
        description="false_positive, confirmed, needs_review, etc. — used with integrity_snapshot to add training row.",
    )
    integrity_snapshot: Optional[Dict[str, Any]] = Field(
        None,
        description="Per-hit payload from /vectors/search (e.g. component_*, for self-tuning).",
    )


class FeedbackOut(BaseModel):
    id: int
    status: str = "stored"
    integrity_version: str = INTEGRITY_VERSION


@router.post("/feedback", response_model=FeedbackOut)
def submit_integrity_feedback(
    body: FeedbackIn,
    user: User = Depends(get_current_user),
) -> FeedbackOut:
    if not (settings.DATABASE_URL or "").strip().startswith(("postgresql://", "postgres://")):
        raise HTTPException(status_code=503, detail="Database not configured for feedback storage")
    try:
        fid = insert_feedback(
            user.id,
            student_id=body.student_id,
            feedback_text=body.feedback,
            action_taken=body.action_taken,
            teacher_label=body.teacher_label,
            integrity_snapshot=body.integrity_snapshot,
        )
    except Exception as e:
        logger.exception("integrity feedback insert failed")
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e
    return FeedbackOut(id=fid, integrity_version=INTEGRITY_VERSION)


@router.get("/weights")
def integrity_weights_status(_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    if not (settings.DATABASE_URL or "").strip().startswith(("postgresql://", "postgres://")):
        raise HTTPException(status_code=503, detail="Database not configured")
    try:
        return get_weights_status()
    except Exception as e:
        logger.exception("integrity weights read failed")
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e


@router.post("/retrain")
def integrity_retrain(_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    if not (settings.DATABASE_URL or "").strip().startswith(("postgresql://", "postgres://")):
        raise HTTPException(status_code=503, detail="Database not configured")
    try:
        r = retrain_least_squares()
    except Exception as e:
        logger.exception("integrity retrain failed")
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e
    if not r.ok:
        return {
            "ok": False,
            "integrity_version": r.version,
            "message": r.message,
            "n_samples": r.n_samples,
        }
    return {
        "ok": True,
        "integrity_version": r.version,
        "message": r.message,
        "n_samples": r.n_samples,
        "weights": r.weights,
    }
