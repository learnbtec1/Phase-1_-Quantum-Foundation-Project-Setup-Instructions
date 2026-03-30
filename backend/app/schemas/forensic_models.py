# app/schemas/forensic_models.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ConceptCoverage(BaseModel):
    relevance: str = Field(default="unknown")
    accuracy: str = Field(default="unknown")
    depth: str = Field(default="unknown")
    completeness: str = Field(default="unknown")


class CriterionResult(BaseModel):
    band: str = Field(default="UNSET")
    achieved: bool = Field(default=False)
    feedback: str = Field(default="")
    evidence_quote: str = Field(default="")
    concept_coverage: ConceptCoverage = Field(default_factory=ConceptCoverage)
    missing_requirements: List[str] = Field(default_factory=list)
    scaffolding_questions: List[str] = Field(default_factory=list)
    needs_review: bool = Field(default=False)


class Telemetry(BaseModel):
    execution_time: float = Field(default=0.0)
    criteria_count: int = Field(default=0)


class ForensicGradeRequest(BaseModel):
    assignment_text: str
    student_text: str
    hard_deadline_sec: Optional[int] = Field(default=None, ge=10, le=600)
    self_consistency: Optional[int] = Field(default=None, ge=1, le=5)
    max_tokens: Optional[int] = Field(default=None, ge=256, le=8000)
    model: Optional[str] = None
    allow_criteria_extraction: bool = True


class ForensicGradeResponse(BaseModel):
    job_id: str
    prompt_version: str
    final_grade: str
    summary: str
    topic_match: bool
    mismatch_reason: str
    needs_manual_review: bool
    criteria: Dict[str, CriterionResult]
    parsed: Dict[str, Any]
    criteria_results: Dict[str, CriterionResult]
    telemetry: Telemetry