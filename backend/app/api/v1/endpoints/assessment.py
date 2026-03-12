# -*- coding: utf-8 -*-
"""
Assessment Endpoints (v4 — Claude Anthropic Edition)
----------------------------------------------------
يضيف مسارين:
  POST /api/v1/assessment/forensic-grade-v3        (نتيجة دفعة واحدة)
  POST /api/v1/assessment/forensic-grade-v3/stream (تدفق JSON line-by-line)
"""

from __future__ import annotations
import logging
import json
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, AliasChoices
from fastapi.responses import StreamingResponse, JSONResponse

# استيراد المحرك الجديد (Claude-based)
from app.services.forensic_engine import forensic_grade, forensic_grade_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/assessment", tags=["Assessment"])


class GradePayload(BaseModel):
    model_config = {"populate_by_name": True}

    assignment_text: str = Field(
        ...,
        validation_alias=AliasChoices("assignment_text", "assignmentContext", "criteria")
    )
    student_text: str = Field(
        ...,
        validation_alias=AliasChoices("student_text", "student_content", "studentAnswer", "answer")
    )


# ==========================================
# 🔥 Forensic Grade v3 (now powered by Claude)
# ==========================================

@router.post("/forensic-grade-v3")
async def grade_v3(payload: GradePayload):
    """تقييم شامل وإرجاع النتيجة دفعة واحدة (Batch) — يعمل بمحرك Claude"""
    if len(payload.student_text.strip()) < 5:
        raise HTTPException(status_code=400, detail="إجابة الطالب قصيرة جداً.")

    try:
        result = await forensic_grade(payload.assignment_text, payload.student_text)

        # Return ERROR result as JSON (not HTTP 500) so frontend can show user-friendly message
        if result.get("final_grade") == "ERROR":
            return JSONResponse(
                status_code=503,
                content={
                    "final_grade": "ERROR",
                    "summary": result.get("summary", "تقييم غير متاح حالياً، يرجى المحاولة لاحقاً."),
                    "criteria": result.get("criteria", {}),
                    "criteria_results": result.get("criteria_results", {}),
                    "error_detail": result.get("error_detail"),
                },
            )

        return JSONResponse(content=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error in grade_v3: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "final_grade": "ERROR",
                "summary": "تقييم غير متاح حالياً، يرجى المحاولة لاحقاً.",
                "criteria": {},
                "criteria_results": {},
                "error_detail": str(e),
            },
        )


@router.post("/forensic-grade-v3/stream")
async def grade_v3_stream(payload: GradePayload):
    """تقييم متدفق (Streaming) للواجهة التفاعلية — يعمل بمحرك Claude"""
    if len(payload.student_text.strip()) < 5:
        raise HTTPException(status_code=400, detail="إجابة الطالب قصيرة جداً.")

    return StreamingResponse(
        forensic_grade_stream(payload.assignment_text, payload.student_text),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# ==========================================
# Legacy compatibility endpoint
# ==========================================

@router.post("/grade")
async def grade_legacy(payload: GradePayload):
    """Legacy endpoint — redirects to v3"""
    return await grade_v3(payload)


# ==========================================
# Plagiarism / AI Detection endpoint
# ==========================================

class PlagiarismPayload(BaseModel):
    text: str

@router.post("/check_plagiarism")
async def check_plagiarism(payload: PlagiarismPayload):
    """كشف الانتحال والبصمة الرقمية (مؤشرات أسلوبية)"""
    if not payload.text or len(payload.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="النص قصير جداً للتحليل.")
    try:
        from app.services.plagiarism_guard import PlagiarismGuard
        guard = PlagiarismGuard()
        result = await guard.evaluate(payload.text)
        # Return in the shape the frontend expects: {score, detail, findings}
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("[Plagiarism] error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))