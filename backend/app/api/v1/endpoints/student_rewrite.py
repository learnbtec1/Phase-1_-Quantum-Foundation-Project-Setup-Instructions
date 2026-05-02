# -*- coding: utf-8 -*-
"""Guided BTEC text improvement (institution kill-switch + policy guard)."""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import llm_rate_limit
from app.db.models import User
from app.services.student_rewrite import generate_student_rewrite

router = APIRouter(prefix="/student-rewrite", tags=["student-rewrite"])


def _rewrite_allowed() -> bool:
    return bool(settings.STUDENT_REWRITE_ENABLED and settings.FEATURE_ALLOW_AI_REWRITE)


class RewriteRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Student work to nudge (same guardrails as assessment pipeline).")
    target_level: Literal["Merit", "Distinction"] = Field(
        "Merit",
        description="Next band to nudge toward (Merit or Distinction).",
    )
    submission_format: Optional[str] = Field(
        None,
        description="optional: bullet_points | slides_style | mixed",
    )


@router.get("/allowed", response_model=dict[str, bool])
def get_rewrite_allowed() -> dict[str, bool]:
    """Public: lets the UI disable the action without a round-trip 403 (no PII)."""
    return {"allowed": _rewrite_allowed()}


@router.post(
    "/rewrite",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(llm_rate_limit)],
)
def rewrite_student_text(
    body: RewriteRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not _rewrite_allowed():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "عذراً، قامت مؤسستك التعليمية أو إعدادات النظام بتعطيل ميزة التحسين بالذكاء الاصطناعي "
                "للتوافق مع معايير BTEC / Pearson."
            ),
        )
    try:
        settings.require_openai()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e

    data = generate_student_rewrite(
        body.text,
        body.target_level,
        user_id=current_user.id,
        memory_scope_key=None,
        submission_format=body.submission_format,
    )
    return data
