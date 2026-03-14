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
import os
import asyncio
from typing import List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field, AliasChoices
from fastapi.responses import StreamingResponse, JSONResponse

# استيراد المحرك الجديد (Claude-based)
from app.services.forensic_engine import forensic_grade, forensic_grade_stream
from app.services.file_extractor import merge_files

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
    student_id: str | None = Field(default=None, description="معرف الطالب (مؤقتاً حتى توفر المصادقة)")


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

        # حفظ النتيجة في المستودع (InMemory أو Postgres حسب USE_DB)
        try:
            from app.repository.evaluations import get_evaluation_repo, DatabaseUnavailableError
            repo = get_evaluation_repo()
            student_id = payload.student_id or "anonymous"
            evaluation_id = repo.create(
                student_id=student_id,
                title="BTEC Assessment",
                original_text=payload.assignment_text[:10000] if payload.assignment_text else None,
                status="evaluated",
                criteria=result.get("criteria", {}),
                final_grade=result.get("final_grade", "R"),
                feedback=result.get("summary", ""),
            )
            result["evaluation_id"] = evaluation_id
            # InMemory يضيف ephemeral في الاستجابة الداخلية؛ نضيفه هنا للتوافق
            if os.getenv("USE_DB", "false").lower() not in ("true", "1", "yes"):
                result["ephemeral"] = True
        except DatabaseUnavailableError as e:
            logger.error("Database unavailable: %s", e)
            raise HTTPException(
                status_code=503,
                detail="قاعدة البيانات غير متاحة، يرجى التحقق من الإعدادات.",
            ) from e

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


# ==========================================
# 📂 Multi-file text extraction endpoint
# ==========================================

MAX_FILE_SIZE_MB = 20
MAX_FILES = 5

@router.post("/extract-text")
async def extract_text_from_files(
    files: List[UploadFile] = File(..., description="ملفات الطالب (docx, pptx, pdf, txt)"),
):
    """
    استخرج النص من ملف أو أكثر (docx / pptx / pdf / txt).
    يُرجع النص الكامل المدمج بتنسيق JSON جاهز للإرسال إلى /forensic-grade-v3.
    """
    if not files:
        raise HTTPException(status_code=400, detail="لم يتم إرسال أي ملف.")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"الحد الأقصى {MAX_FILES} ملفات في الطلب الواحد.",
        )

    file_pairs = []
    for upload in files:
        data = await upload.read()
        size_mb = len(data) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            raise HTTPException(
                status_code=413,
                detail=f"الملف '{upload.filename}' حجمه {size_mb:.1f} MB يتجاوز الحد الأقصى ({MAX_FILE_SIZE_MB} MB).",
            )
        file_pairs.append((upload.filename or "file", data))

    try:
        merged_text = merge_files(file_pairs)
    except Exception as e:
        logger.exception("[extract-text] error: %s", e)
        raise HTTPException(status_code=500, detail=f"خطأ في استخراج النص: {e}")

    if not merged_text.strip():
        raise HTTPException(status_code=422, detail="لم يُستخرج أي نص من الملفات المرفقة.")

    return JSONResponse(content={
        "text": merged_text,
        "char_count": len(merged_text),
        "files": [f[0] for f in file_pairs],
    })


# ==========================================
# 📂 Multi-file grading endpoints (stream)
# ==========================================

@router.post("/forensic-grade-v3/stream-files")
async def grade_v3_stream_files(
    files: List[UploadFile] = File(..., description="ملفات الطالب (docx, pptx, pdf, txt)"),
    assignment_text: str = Form(..., description="نص الواجب / المعايير"),
):
    """
    تقييم متدفق مع رفع ملفات مباشرة.
    يستخرج النص من الملفات ثم يُشغّل المحرك الجنائي بالبث.
    """
    if not files:
        raise HTTPException(status_code=400, detail="لم يتم إرسال أي ملف.")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"الحد الأقصى {MAX_FILES} ملفات.")

    file_pairs = []
    for upload in files:
        data = await upload.read()
        size_mb = len(data) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            raise HTTPException(
                status_code=413,
                detail=f"الملف '{upload.filename}' حجمه {size_mb:.1f} MB يتجاوز الحد ({MAX_FILE_SIZE_MB} MB).",
            )
        file_pairs.append((upload.filename or "file", data))

    try:
        student_text = merge_files(file_pairs)
    except Exception as e:
        logger.exception("[stream-files] extraction error: %s", e)
        raise HTTPException(status_code=500, detail=f"خطأ في استخراج النص: {e}")

    if not student_text.strip():
        raise HTTPException(status_code=422, detail="لم يُستخرج أي نص من الملفات المرفقة.")

    return StreamingResponse(
        forensic_grade_stream(assignment_text, student_text),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )