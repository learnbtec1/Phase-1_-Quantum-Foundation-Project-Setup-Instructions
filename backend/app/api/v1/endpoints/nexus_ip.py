# -*- coding: utf-8 -*-
"""
NEXUS IP Endpoints v1.0
-----------------------
المسارات التي تُحوّل نظام NEXUS من "أداة تقييم" إلى "وكيل أكاديمي قانوني قابل للترخيص".

المسارات:
  POST   /api/v1/nexus/grade-verified          — تقييم كامل + ناقد داخلي + ذاكرة + مشاعر + Audit
  POST   /api/v1/nexus/appeal                  — اعتراض الطالب + إعادة الفحص
  GET    /api/v1/nexus/student/{id}/history    — سجل الطالب الطولي
  GET    /api/v1/nexus/audit/{job_id}          — سجل XAI كامل
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ─── Services ────────────────────────────────────────────────────────────────
from app.services.forensic_engine import (
    forensic_grade,
    extract_criteria_codes,
    extract_criteria_descriptions,
    calculate_final_grade_btec,
    MODEL as GRADER_MODEL,
)

try:
    from app.services.quantitative_requirements import extract_quantitative_requirements_advanced
except ImportError:
    def extract_quantitative_requirements_advanced(*a, **kw):
        return {}

from app.services.internal_verifier    import run_bulk_verification
from app.services.student_memory       import (
    generate_longitudinal_context,
    save_assessment_session,
    build_longitudinal_summary,
)
from app.services.avatar_emotion_engine import generate_emotion_metadata
from app.services.audit_trail          import (
    AuditTrail, AuditEventType, load_audit_trail,
)
from app.services.conversational_agent import (
    store_for_appeal,
    process_appeal,
)

logger = logging.getLogger("nexus.ip")

router = APIRouter(prefix="/api/v1/nexus", tags=["NEXUS IP"])


# ─── Request / Response models ───────────────────────────────────────────────

class VerifiedGradeRequest(BaseModel):
    assignment_text: str = Field(..., min_length=10)
    student_text:    str = Field(..., min_length=10)
    student_id:      Optional[str] = Field(None, description="ID الطالب — لتفعيل الذاكرة الطولية")
    subject:         Optional[str] = Field(None, description="اسم المادة للتسجيل في السجل")
    skip_verifier:   bool = Field(False, description="تخطي الناقد الداخلي (للاختبار السريع)")


class AppealRequest(BaseModel):
    job_id:          str = Field(..., description="معرّف جلسة التقييم التي تُعترض عليها")
    student_message: str = Field(..., min_length=5)
    criterion_code:  str = Field(..., description="كود المعيار المُعترَض عليه، مثل P1 أو M2")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_job_id(assignment: str, student: str) -> str:
    raw = f"{assignment[:500]}|{student[:500]}|{time.time()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ─── POST /grade-verified ────────────────────────────────────────────────────

@router.post("/grade-verified")
async def grade_verified(req: VerifiedGradeRequest):
    """
    Full verified grading pipeline:
      1. Extract criteria + descriptions + quantitative constraints
      2. Inject longitudinal context (if student_id provided)
      3. Run primary evaluation (forensic_engine)
      4. Run Internal Verifier Agent on all criteria concurrently
      5. Recalculate staircase grade after corrections
      6. Generate Avatar Emotion metadata
      7. Save to student memory
      8. Flush XAI Audit Trail
      9. Return everything
    """
    start_t = time.monotonic()
    job_id  = _make_job_id(req.assignment_text, req.student_text)
    audit   = AuditTrail(job_id, student_id=req.student_id)

    # ── Step 1: Extract structure ─────────────────────────────────────────────
    codes = extract_criteria_codes(req.assignment_text)
    if len(codes) < 2:
        raise HTTPException(
            status_code=400,
            detail="لم يتم العثور على معيارين على الأقل (P/M/D) في نص الواجب.",
        )

    descs = extract_criteria_descriptions(req.assignment_text, codes)
    try:
        adv_constraints = extract_quantitative_requirements_advanced(req.assignment_text)
    except Exception:
        adv_constraints = {}

    await audit.log(
        AuditEventType.CRITERIA_EXTRACTED,
        input_summary=f"{len(codes)} معيار: {', '.join(codes)}",
        decision=codes,
    )
    await audit.log(
        AuditEventType.QUANTITATIVE_PARSED,
        decision=adv_constraints if adv_constraints else "لا توجد متطلبات كمية صريحة",
    )

    # ── Step 2: Longitudinal context ─────────────────────────────────────────
    longitudinal_ctx = ""
    previous_grade: Optional[str] = None

    if req.student_id:
        longitudinal_ctx = generate_longitudinal_context(req.student_id, codes)
        await audit.log(
            AuditEventType.MEMORY_LOADED,
            metadata={"student_id": req.student_id, "context_length": len(longitudinal_ctx)},
        )

    # If longitudinal context exists, inject it into the assignment text
    # so the AI prompt includes prior-attempt notes for every criterion
    augmented_assignment = req.assignment_text
    if longitudinal_ctx:
        augmented_assignment = req.assignment_text + "\n\n" + longitudinal_ctx

    # ── Step 3: Primary evaluation ────────────────────────────────────────────
    try:
        primary_result = await forensic_grade(augmented_assignment, req.student_text)
    except Exception as e:
        await audit.log(AuditEventType.ERROR, decision=str(e))
        await audit.flush()
        raise HTTPException(status_code=503, detail=f"فشل التقييم الأولي: {e}")

    primary_criteria: dict = (
        primary_result.get("criteria")
        or primary_result.get("criteria_results")
        or {}
    )

    # Log each criterion
    for code, res in primary_criteria.items():
        audit.log_criterion(
            code,
            res.get("achieved", False),
            res.get("reasoning", ""),
            ai_model=GRADER_MODEL,
        )

    # ── Step 4: Internal Verifier ─────────────────────────────────────────────
    verification_reports: dict = {}
    final_criteria = dict(primary_criteria)

    if not req.skip_verifier and primary_criteria:
        final_criteria, verification_reports = await run_bulk_verification(
            codes=list(primary_criteria.keys()),
            descriptions=descs,
            assignment_text=augmented_assignment,
            student_text=req.student_text,
            adv_constraints=adv_constraints,
            primary_results=primary_criteria,
        )

        # Log verification outcomes
        for code, report in verification_reports.items():
            score       = report.get("hallucination_score", 0.0)
            correction  = final_criteria.get(code, {}).get("_correction_applied", False)
            evt_type    = AuditEventType.CORRECTION_APPLIED if correction else AuditEventType.VERIFICATION_RUN
            await audit.log(
                evt_type,
                criterion_code=code,
                confidence=1.0 - score,
                decision={
                    "hallucination_score": score,
                    "correction_applied":  correction,
                    "issues":              report.get("issues", []),
                },
            )

    # ── Step 5: Staircase grade ───────────────────────────────────────────────
    final_grade = calculate_final_grade_btec(final_criteria)
    await audit.log(
        AuditEventType.STAIRCASE_APPLIED,
        decision=final_grade,
        reasoning_chain=[
            f"P achieved: {all(v.get('achieved') for k,v in final_criteria.items() if k.upper().lstrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ.').startswith('P'))}",
            f"Final grade: {final_grade}",
        ],
    )

    # ── Step 6: Avatar emotion metadata ──────────────────────────────────────
    emotion_data = generate_emotion_metadata(
        {"final_grade": final_grade, "criteria": final_criteria},
        previous_grade=previous_grade,
    )
    await audit.log(AuditEventType.EMOTION_GENERATED, decision=emotion_data.get("teaching_tone"))

    # ── Step 7: Save to student memory ───────────────────────────────────────
    if req.student_id:
        save_assessment_session(
            student_id=req.student_id,
            job_id=job_id,
            subject=req.subject or "غير محدد",
            final_grade=final_grade,
            criteria_results=final_criteria,
        )
        await audit.log(AuditEventType.MEMORY_SAVED, metadata={"student_id": req.student_id})

    # ── Step 8: Register for appeal + flush audit ─────────────────────────────
    store_for_appeal(
        job_id=job_id,
        assignment_text=req.assignment_text,
        student_text=req.student_text,
        criteria_results=final_criteria,
        adv_constraints=adv_constraints,
        descriptions=descs,
    )

    await audit.log(
        AuditEventType.FINAL_GRADE,
        decision=final_grade,
        metadata={"execution_seconds": round(time.monotonic() - start_t, 2)},
    )
    await audit.flush()

    # ── Step 9: Build response ────────────────────────────────────────────────
    achieved_count = sum(1 for r in final_criteria.values() if r.get("achieved"))
    total_count    = len(final_criteria)

    return {
        "success":     True,
        "job_id":      job_id,
        "final_grade": final_grade,
        "summary": {
            "totalCriteria":    total_count,
            "achievedCount":    achieved_count,
            "achievedPercent":  round(achieved_count / total_count * 100, 1) if total_count else 0,
        },
        "criteria":             final_criteria,
        "verification_reports": verification_reports,
        "emotion_metadata":     emotion_data,
        "audit":                audit.get_summary(),
        "execution_seconds":    round(time.monotonic() - start_t, 2),
    }


# ─── POST /appeal ────────────────────────────────────────────────────────────

@router.post("/appeal")
async def student_appeal(req: AppealRequest):
    """
    Process a student objection to a specific criterion verdict.
    The agent locates the referenced content and re-evaluates independently.
    """
    result = await process_appeal(
        job_id=req.job_id,
        student_message=req.student_message,
        criterion_code=req.criterion_code,
    )

    if "error" in result:
        code = 404 if result["error"] == "job_not_found" else 400
        raise HTTPException(status_code=code, detail=result["message"])

    return result


# ─── GET /student/{student_id}/history ───────────────────────────────────────

@router.get("/student/{student_id}/history")
async def get_student_history(student_id: str):
    """Return the full longitudinal progress report for a student."""
    summary = build_longitudinal_summary(student_id)
    if summary.get("status") == "no_history":
        return JSONResponse(status_code=404, content=summary)
    return summary


# ─── GET /audit/{job_id} ──────────────────────────────────────────────────────

@router.get("/audit/{job_id}")
async def get_audit_trail(job_id: str):
    """
    Return the full XAI audit trail for a grading job.
    Every Chain-of-Thought step is included for inspector review.
    """
    events = load_audit_trail(job_id)
    if events is None:
        raise HTTPException(
            status_code=404,
            detail=f"لم يتم العثور على سجل التدقيق للجلسة '{job_id}'.",
        )
    return {
        "job_id":       job_id,
        "event_count":  len(events),
        "events":       events,
        "xai_standard": "ISO/IEC 22989:2022 + IEEE 7001-2021",
    }
