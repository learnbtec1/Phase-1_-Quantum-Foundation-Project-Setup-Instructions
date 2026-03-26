# -*- coding: utf-8 -*-
"""User profile — GDPR data deletion (Phase C)."""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.db_models import (
    Answer,
    Assignment,
    ConsentRecord,
    Evaluation,
    LessonAssignment,
    StudentPersonaPreference,
    StudentTimeline,
    TrainingData,
    UsageLog,
    User,
    UserContextRow,
    UserMemory,
    UserTopicMastery,
)
from app.services.audit_service import write_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


class MePreferencesBody(BaseModel):
    dnd_mode: bool | None = None


@router.patch("/me/preferences", status_code=status.HTTP_200_OK)
def patch_my_preferences(
    body: MePreferencesBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if body.dnd_mode is not None:
        user.dnd_mode = bool(body.dnd_mode)
        db.add(user)
        db.commit()
    return {"dnd_mode": bool(getattr(user, "dnd_mode", False))}


@router.get("/me/memory")
def list_my_memories(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    memory_type: str | None = Query(None),
    limit: int = Query(80, ge=1, le=500),
):
    q = db.query(UserMemory).filter(UserMemory.user_id == user.id)
    if memory_type:
        q = q.filter(UserMemory.memory_type == memory_type)
    rows = q.order_by(desc(UserMemory.created_at)).limit(limit).all()
    return [
        {
            "id": str(r.id),
            "memory_type": r.memory_type,
            "content": (r.content or "")[:8000],
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.delete("/me/memory", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_memories_filtered(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    memory_type: str | None = Query(None),
    topic_substring: str | None = Query(None, description="Delete emotional/goal rows whose content contains this text"),
) -> None:
    q = db.query(UserMemory).filter(UserMemory.user_id == user.id)
    if memory_type:
        q = q.filter(UserMemory.memory_type == memory_type)
    rows = q.all()
    for r in rows:
        if topic_substring and topic_substring not in (r.content or ""):
            continue
        db.delete(r)
    db.commit()


@router.get("/me/export")
def export_my_data_json(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mems = db.query(UserMemory).filter(UserMemory.user_id == user.id).all()
    ctx = db.query(UserContextRow).filter(UserContextRow.user_id == user.id).first()
    tl = db.query(StudentTimeline).filter(StudentTimeline.user_id == user.id).order_by(desc(StudentTimeline.day_date)).limit(120).all()
    return {
        "user": {"id": str(user.id), "email": user.email, "name": user.name},
        "memories": [
            {"type": m.memory_type, "content": m.content, "created_at": m.created_at.isoformat() if m.created_at else None}
            for m in mems
        ],
        "user_context": {
            "device_type": ctx.device_type if ctx else None,
            "timezone": ctx.timezone if ctx else None,
            "country_code": ctx.country_code if ctx else None,
        }
        if ctx
        else None,
        "timeline": [
            {
                "day": str(t.day_date),
                "summary": t.summary,
                "topics": t.topics_covered,
            }
            for t in tl
        ],
    }


@router.delete("/me/data", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_data(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Remove personal data for the current user; keep anonymized analytics where possible."""
    uid = user.id
    rid = getattr(request.state, "request_id", None)

    try:
        db.query(UsageLog).filter(UsageLog.user_id == uid).delete(synchronize_session=False)
        db.query(ConsentRecord).filter(ConsentRecord.user_id == uid).delete(synchronize_session=False)
        db.query(UserMemory).filter(UserMemory.user_id == uid).delete(synchronize_session=False)
        db.query(UserContextRow).filter(UserContextRow.user_id == uid).delete(synchronize_session=False)
        db.query(StudentTimeline).filter(StudentTimeline.user_id == uid).delete(synchronize_session=False)
        db.query(TrainingData).filter(TrainingData.user_id == uid).delete(synchronize_session=False)
        db.query(StudentPersonaPreference).filter(StudentPersonaPreference.user_id == uid).delete(
            synchronize_session=False
        )
        db.query(Answer).filter(Answer.user_id == uid).delete(synchronize_session=False)
        db.query(UserTopicMastery).filter(UserTopicMastery.user_id == uid).delete(synchronize_session=False)
        db.query(LessonAssignment).filter(
            (LessonAssignment.student_id == uid) | (LessonAssignment.teacher_id == uid)
        ).delete(synchronize_session=False)

        assign_ids = [row[0] for row in db.query(Assignment.id).filter(Assignment.student_id == uid).all()]
        for aid in assign_ids:
            db.query(Evaluation).filter(Evaluation.assignment_id == aid).delete(synchronize_session=False)
        db.query(Assignment).filter(Assignment.student_id == uid).delete(synchronize_session=False)

        anon_email = f"deleted_{uid.hex[:12]}@anonymized.invalid"
        user.email = anon_email
        user.name = "Deleted user"
        user.hashed_password = None
        user.parent_email = None
        user.consent_given_at = None
        user.terms_accepted_at = None
        user.is_active = False
        user.subscription_plan = "free"
        user.model_tier = "standard"
        db.add(user)
        write_audit(
            db,
            actor_id=uid,
            action="gdpr_data_delete",
            resource=str(uid),
            ip_address=request.client.host if request.client else None,
            request_id=str(rid) if rid else None,
            details={"outcome": "anonymized"},
            commit=False,
        )
        db.commit()
    except Exception as e:
        logger.exception("GDPR delete failed: %s", e)
        db.rollback()
        raise
