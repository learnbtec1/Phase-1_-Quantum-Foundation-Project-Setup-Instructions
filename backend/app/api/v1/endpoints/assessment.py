# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from app.api.deps import get_current_user
from app.core.rate_limit import llm_rate_limit
from app.db.models import User
from app.services import usage_service
from app.services.assessment_pipeline import (
    aggregate_criterion_results,
    extract_criteria,
    run_full_grading_pipeline,
    run_single_criterion_evaluation,
)
from app.services.assessment_service import assess_btec_rag
from app.services.assignment_brief_analyzer import run_analyze_assignment_brief
from app.services.brief_decode_service import run_decode_brief
from app.services.guidance_gap_service import run_guidance_gap_analysis
from app.services.submission_merge import MAX_BYTES_PER_FILE, MAX_BYTES_TOTAL, merge_and_log
from app.services.teacher_memory_service import (
    build_memory_payload_for_api,
    load_pattern_counts,
    save_teacher_edit,
)

router = APIRouter(prefix="/assessment", tags=["assessment"])


class SubmissionFilePart(BaseModel):
    filename: str = Field(..., min_length=1, max_length=512)
    content_base64: str = Field(
        ...,
        min_length=1,
        max_length=32_000_000,
    )


def _merge_submission_from_body(
    *,
    student_work: str,
    submission_files: Optional[List[SubmissionFilePart]],
    sort_submission_files_by_name: bool,
) -> str:
    file_parts: List[Tuple[str, bytes]] = []
    total = 0
    for p in submission_files or []:
        try:
            raw = base64.b64decode(p.content_base64, validate=False)
        except Exception:
            raise HTTPException(400, detail=f"Invalid base64: {p.filename}") from None
        if len(raw) > MAX_BYTES_PER_FILE:
            raise HTTPException(400, detail=f"File too large: {p.filename}")
        total += len(raw)
        if total > MAX_BYTES_TOTAL:
            raise HTTPException(400, detail="Total upload size too large")
        file_parts.append((p.filename, raw))
    if sort_submission_files_by_name and file_parts:
        file_parts = sorted(file_parts, key=lambda x: x[0].lower())
    combined = merge_and_log(file_parts=file_parts, student_work=student_work or "")
    if not (combined or "").strip():
        raise HTTPException(400, detail="No student work provided")
    return combined


class ExtractCriteriaBody(BaseModel):
    assignment_context: str = Field(..., min_length=1, description="Full assignment brief / rubric text.")


class CriterionSpec(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=8000)


class EvaluateCriterionBody(BaseModel):
    criterion: CriterionSpec
    student_work: str = Field(..., min_length=1)


class AggregateBody(BaseModel):
    """Per-criterion rows with at least code and achieved (same shape as criteria_results)."""

    criteria_results: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Rows with 'code' and 'achieved' at minimum; use output shape from the pipeline.",
    )



class _WorkPayload(BaseModel):
    """Typed + optional base64 files → one merged `student_work` string server-side."""

    student_work: str = Field(
        default="",
        max_length=2_000_000,
        description="Pasted/typed work; may be empty if submission_files is set.",
    )
    submission_files: Optional[List[SubmissionFilePart]] = Field(
        default=None,
        description="PDF / DOCX / PPTX (or txt/md); merged in list order.",
    )
    sort_submission_files_by_name: bool = Field(
        default=False,
        description="If true, order merged files by filename (when upload order is unknown).",
    )

    @model_validator(mode="after")
    def _at_least_one_source(self) -> "_WorkPayload":
        if not (self.student_work or "").strip() and not (self.submission_files):
            raise ValueError("No student work provided")
        return self


class PipelineBody(_WorkPayload):
    btec_unit: str = Field(..., min_length=1, max_length=256)
    assignment_criteria: Optional[str] = Field(
        default=None,
        description="Rubric / P M D lines — required for meaningful pipeline extraction.",
    )
    enable_final_review: bool = Field(
        default=False,
        description="Optional GPT-4o consistency pass (does not change achieved flags).",
    )
    academic_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="e.g. {grade, term, subject} for scoped extraction in the pipeline.",
        validation_alias=AliasChoices("academic_context", "academicContext"),
    )


class TeacherEditBody(BaseModel):
    """Record teacher's own improved text; system learns *style* nudges only (does not re-grade)."""

    original_text: str = Field(..., min_length=1, max_length=2_000_000)
    ai_suggestion: str = Field(
        default="",
        max_length=2_000_000,
        description="Optional: model-guided improvement text the teacher saw; may be empty.",
    )
    teacher_edited_text: str = Field(..., min_length=1, max_length=2_000_000)
    grade_band: str = Field(default="Pass", max_length=64)
    target_band: str = Field(default="Merit", max_length=64)
    assignment_type: str = Field(default="general", max_length=128)


class DecodedScaffoldStep(BaseModel):
    """Socratic scaffold step (60/40): structure + [أكمل أنت] gaps; decode-brief /brief."""

    title: str = Field(..., min_length=1, max_length=1_000)
    instructions: str = Field(..., min_length=1, max_length=20_000)
    partial_solution: str = Field(
        default="",
        max_length=25_000,
        description="Optional partial scaffold with [أكمل أنت] gaps only — never a full final submission.",
    )
    type: Literal["breakdown", "theory", "application", "bridging", "checklist"] = Field(
        ...,
        description="Pedagogical step type for icon mapping on the client.",
    )


class DecodeBriefResponse(BaseModel):
    """Structured scaffold steps for the BTEC brief decoder (no copy-paste final answers)."""

    steps: List[DecodedScaffoldStep]


class BtecBriefLadderOut(BaseModel):
    """P/M/D ladder lines for the visual scale; JSON key `pass` (Python: pass_)."""

    model_config = ConfigDict(populate_by_name=True)

    pass_: List[str] = Field(alias="pass", description="مستوى Pass — نصوص مبسّطة (عربي).")
    merit: List[str] = Field(..., description="مستوى Merit")
    distinction: List[str] = Field(..., description="مستوى Distinction")


class DecodeBriefRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=20,
        max_length=200_000,
        description="Extracted assignment brief / criteria text.",
    )


class GapInputGuidanceSections(BaseModel):
    what: str = Field(default="", max_length=8_000)
    how: str = Field(default="", max_length=8_000)
    link_to_scenario: str = Field(default="", max_length=8_000)


class GapInputCriterion(BaseModel):
    criterion: str = Field(..., min_length=1, max_length=64)
    level: Optional[Literal["pass", "merit", "distinction"]] = None
    guidance: GapInputGuidanceSections = Field(default_factory=GapInputGuidanceSections)
    achieved: bool
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class GapGuidanceBridgeRequest(BaseModel):
    """Bridge: brief-style guidance + graded row → gap analysis (explanations only; no new grades)."""

    submission: str = Field(..., min_length=1, max_length=200_000)
    criteria: List[GapInputCriterion] = Field(..., min_length=1, max_length=50)


class CriterionGapAnalysisOut(BaseModel):
    criterion: str
    coverage: str
    strengths: str
    gaps: str
    improvement_direction: str


class GapGuidanceBridgeResponse(BaseModel):
    criterion_analysis: List[CriterionGapAnalysisOut]


class GradeBody(_WorkPayload):
    btec_unit: str = Field(..., min_length=1, max_length=256, description="Unit code or label, e.g. Unit 4")
    assignment_criteria: Optional[str] = Field(
        default=None,
        description="Optional extra brief or criteria text from the teacher.",
    )
    metadata_filter: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional JSONB @> filter for retrieval (e.g. btec unit tags in metadata).",
    )
    academic_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="e.g. {grade, term, subject} to route RAG and scope the grader.",
        validation_alias=AliasChoices("academic_context", "academicContext"),
    )


@router.post(
    "/analyze-assignment-brief",
    response_model=BtecBriefLadderOut,
    dependencies=[Depends(llm_rate_limit)],
    summary="AI BTEC Decoder: P/M/D ladder from a brief PDF (Gemini)",
)
async def analyze_assignment_brief(
    file: UploadFile = File(..., description="Assignment brief / criteria as PDF"),
    _user: User = Depends(get_current_user),
) -> BtecBriefLadderOut:
    """
    يستقبل PDF موجز الواجب، يستخرج النص داخلياً، ثم يرجع `pass` / `merit` / `distinction` كقائمات جمل عربية مبسّطة.
    يتطلب `GOOGLE_API_KEY` و`GEMINI_ASSIGNMENT_BRIEF_MODEL` (افتراضي: gemini-2.0-flash).
    """
    name = (file.filename or "brief.pdf").strip()
    if not name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="يُقبل ملف PDF فقط (موجز الواجب).")
    data = await file.read()
    try:
        out = run_analyze_assignment_brief(name, data)
        return BtecBriefLadderOut.model_validate(out)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"تعذّر تحليل الموجز: {e!s}",
        ) from e


@router.post(
    "/decode-brief",
    response_model=DecodeBriefResponse,
    dependencies=[Depends(llm_rate_limit)],
)
def post_decode_brief(
    body: DecodeBriefRequest,
    _user: User = Depends(get_current_user),
) -> DecodeBriefResponse:
    """
    Turn assignment brief text into a Socratic scaffold (60/40; JSON `steps`). Does not consume assessment quota.
    """
    try:
        out = run_decode_brief(body.text)
        return DecodeBriefResponse.model_validate(out)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل في تفكيك الواجب: {e!s}") from e


@router.post(
    "/guidance-gap",
    response_model=GapGuidanceBridgeResponse,
    dependencies=[Depends(llm_rate_limit)],
)
def post_guidance_gap(
    body: GapGuidanceBridgeRequest,
    _user: User = Depends(get_current_user),
) -> GapGuidanceBridgeResponse:
    """
    Explains per-criterion gaps vs guidance (what/how/link_to_scenario) and the submission.
    Does not change grades; does not return model answers.
    """
    try:
        out = run_guidance_gap_analysis(body.model_dump())
        return GapGuidanceBridgeResponse.model_validate(out)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/extract-criteria", dependencies=[Depends(llm_rate_limit)])
def post_extract_criteria(
    body: ExtractCriteriaBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Stage 2: LLM extracts {code, description}[] from assignment text only."""
    crit, und = extract_criteria(body.assignment_context)
    return {"criteria": crit, "criteria_undetected": und}


@router.post("/evaluate-criterion", dependencies=[Depends(llm_rate_limit)])
def post_evaluate_criterion(
    body: EvaluateCriterionBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Stage 3–4: chunk work, pull evidence per chunk (mini), evaluate one criterion (mini)."""
    if len(body.student_work.strip()) < 5:
        raise HTTPException(status_code=400, detail="Student work is too short.")
    return run_single_criterion_evaluation(
        body.student_work,
        {"code": body.criterion.code, "description": body.criterion.description},
    )


@router.post("/aggregate", dependencies=[Depends(llm_rate_limit)])
def post_aggregate(
    body: AggregateBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Stage 6: deterministic BTEC band + short LLM summary from criterion rows."""
    return aggregate_criterion_results(body.criteria_results)


@router.post("/grade-pipeline", dependencies=[Depends(llm_rate_limit)])
def post_grade_pipeline(
    body: PipelineBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Full multi-step pipeline (chunking → extract → evidence → evaluate → aggregate → optional review)."""
    combined = _merge_submission_from_body(
        student_work=body.student_work,
        submission_files=body.submission_files,
        sort_submission_files_by_name=body.sort_submission_files_by_name,
    )
    if len(combined.strip()) < 5:
        raise HTTPException(status_code=400, detail="Student work is too short.")
    try:
        return run_full_grading_pipeline(
            btec_unit=body.btec_unit,
            student_work=combined,
            assignment_criteria=body.assignment_criteria or "",
            enable_final_review=body.enable_final_review,
            academic_context=body.academic_context,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/grade", dependencies=[Depends(llm_rate_limit)])
def grade_btec(
    body: GradeBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    usage_service.require_assessment_allowance(_user)
    combined = _merge_submission_from_body(
        student_work=body.student_work,
        submission_files=body.submission_files,
        sort_submission_files_by_name=body.sort_submission_files_by_name,
    )
    if len(combined.strip()) < 5:
        raise HTTPException(status_code=400, detail="Student work is too short.")
    try:
        out = assess_btec_rag(
            btec_unit=body.btec_unit,
            student_work=combined,
            assignment_criteria=body.assignment_criteria,
            metadata_filter=body.metadata_filter,
            academic_context=body.academic_context,
            user_id=_user.id,
        )
        usage_service.record_assessment_success(_user)
        return out
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/teacher-edit")
def post_teacher_edit(
    body: TeacherEditBody,
    _user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    After the teacher refines a suggested improvement, record the diff to learn
    *types* of edits (add reason, clarify, etc.) for soft rewrite hints. Does not change grades.
    """
    return save_teacher_edit(
        user_id=_user.id,
        original_text=body.original_text,
        ai_suggestion=body.ai_suggestion or "",
        teacher_edited_text=body.teacher_edited_text,
        grade_band=body.grade_band,
        target_band=body.target_band,
        assignment_type=body.assignment_type,
    )


@router.get("/teacher-style-memory")
def get_teacher_style_memory(
    _user: User = Depends(get_current_user),
    scope: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Per-user local counts (for the signed-in account) and global merge {count, weight} for optional subject scope
    (same shape used by the rewrite soft-prompt, aggregated across all teachers).
    """
    return {
        "user_patterns": load_pattern_counts(_user.id),
        "global_merged": build_memory_payload_for_api(scope),
    }
