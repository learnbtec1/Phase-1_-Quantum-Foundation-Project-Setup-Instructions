# -*- coding: utf-8 -*-
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.rate_limit import llm_rate_limit
from app.db.models import User
from app.services.gemini_ultra import generate_tutor_response

logger = logging.getLogger(__name__)

# Appended to settings.API_V1_STR in main.py → /api/v1/ultra/session
router = APIRouter(prefix="/ultra", tags=["Ultra Tutor"])


class TutorSessionRequest(BaseModel):
    brief_id: str = Field(..., min_length=1, max_length=128, description="معرف الواجب (واجهة / جلسة)")
    current_criterion: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="المعيار الحالي، مثال: P1 أو M2",
    )
    brief_text: str = Field(
        ...,
        min_length=20,
        max_length=200_000,
        description="نص الواجب لسياق النموذج",
    )


class TutorSessionResponse(BaseModel):
    explanation: str
    media_prompt: str
    game_idea: str


@router.post(
    "/session",
    response_model=TutorSessionResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(llm_rate_limit)],
)
def create_tutor_session(
    request: TutorSessionRequest,
    _user: User = Depends(get_current_user),
) -> TutorSessionResponse:
    """
    جلسة توجيه سقراطية لمعيار BTEC (لا يُعاد إرسال brief_id إلى النموذج حالياً؛ يُحتفظ للتوسعة).
    """
    _ = request.brief_id  # reserved for DB-backed briefs
    try:
        tutor_data = generate_tutor_response(
            criterion=request.current_criterion,
            brief_text=request.brief_text,
        )
        return TutorSessionResponse(
            explanation=str(tutor_data.get("explanation", "عذراً، لم أتمكن من صياغة الشرح.")),
            media_prompt=str(tutor_data.get("media_prompt", "")),
            game_idea=str(tutor_data.get("game_idea", "")),
        )
    except ValueError as ve:
        logger.error("Ultra Tutor ValueError: %s", ve)
        raise HTTPException(status_code=500, detail=str(ve)) from ve
    except RuntimeError as e:
        msg = str(e)
        if "not configured" in msg.lower() or "GEMINI" in msg or "GOOGLE_API_KEY" in msg:
            raise HTTPException(status_code=503, detail=msg) from e
        logger.error("Ultra Tutor RuntimeError: %s", e)
        raise HTTPException(status_code=500, detail=msg) from e
    except Exception as e:
        logger.exception("Ultra Tutor General Error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="حدث خطأ أثناء محاولة استحضار المعلم الذكي. يرجى المحاولة لاحقاً.",
        ) from e
