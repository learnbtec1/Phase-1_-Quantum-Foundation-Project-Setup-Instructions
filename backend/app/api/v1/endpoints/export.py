# -*- coding: utf-8 -*-
"""BTEC record export — docxtpl only; template at app/templates/btec_record.docx."""
from __future__ import annotations

import io
import logging
import os
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from docxtpl import DocxTemplate

from app.api.deps import get_current_user
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["export"])


class GradedCriterion(BaseModel):
    criterion_id: str
    achieved: str
    feedback: str


class BtecExportRequest(BaseModel):
    student_reg_no: str
    student_name: str
    assignment_title: str
    assessor_name: str
    unit_title: str
    submission_date: str
    deadline_date: str
    feedback_date: str
    general_feedback: str
    graded_criteria: List[GradedCriterion] = Field(..., min_length=1)


def _template_path() -> str:
    """Resolve app/templates/btec_record.docx from this module (Docker-safe)."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(
        os.path.join(current_dir, "..", "..", "..", "templates", "btec_record.docx")
    )


# Names still present in the checked-in btec_record.docx Jinja; merged at render (not in API body).
_DEFAULT_PROGRAM_TITLE = "شهادات Pearson BTEC International من المستوى 3 في الاعمال"


def _build_context(request: BtecExportRequest) -> dict:
    ctx: dict = request.model_dump()
    ctx["graded_criteria"] = [c.model_dump() for c in request.graded_criteria]
    # Keep legacy placeholders in the template file working without extra API fields
    if "program_title" not in ctx:
        ctx["program_title"] = _DEFAULT_PROGRAM_TITLE
    if "extension_approved" not in ctx:
        ctx["extension_approved"] = "—"
    if "submission_body" not in ctx:
        ctx["submission_body"] = ""
    return ctx


@router.post(
    "/btec-word",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    responses={
        200: {"content": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {}}}
    },
)
async def export_btec_word(
    request: BtecExportRequest,
    _user: User = Depends(get_current_user),
) -> Response:
    template_path = _template_path()
    if not os.path.isfile(template_path):
        logger.error("Template not found at: %s", template_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="القالب الرسمي غير موجود في الخادم.",
        )
    try:
        doc = DocxTemplate(template_path)
        context = _build_context(request)
        doc.render(context)
    except Exception as e:
        logger.error("Docx generation error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"حدث خطأ أثناء توليد الملف: {e!s}",
        ) from e

    buffer = io.BytesIO()
    try:
        doc.save(buffer)
    except Exception as e:
        logger.error("Docx save to buffer failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="تعذّر حفظ المستند في الذاكرة.",
        ) from e
    buffer.seek(0)
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": "attachment; filename=BTEC_Assessment_Record.docx"},
    )
