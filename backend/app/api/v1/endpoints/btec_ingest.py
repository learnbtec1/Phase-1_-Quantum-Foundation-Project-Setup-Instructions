# -*- coding: utf-8 -*-
"""
btec_ingest.py — BTEC Unit Spec REST API
=========================================
Endpoints for Dr. Hamza to manage BTEC unit specifications:

  GET  /api/v1/btec/units              → list all available unit specs
  GET  /api/v1/btec/units/{unit_id}    → get full criteria for a specific unit
  POST /api/v1/btec/units              → ingest (upload) a new unit spec JSON
  POST /api/v1/btec/progress           → resolve teaching level from student progress

These endpoints power:
1. The teacher admin panel (unit management)
2. The frontend progress reporter (sends btec_context to Cogni)
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user, get_teacher_user
from app.models.db_models import User

from app.services.btec_knowledge import (
    list_units,
    load_unit,
    infer_teaching_level,
    get_next_criterion,
    get_achieved_summary,
    invalidate_cache,
    _specs_dir,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/btec", tags=["BTEC Knowledge"])

# ── Regex for safe unit_id / criterion code validation ───────────────────────
_UNIT_ID_RE   = re.compile(r'^[a-z0-9_-]{1,40}$')
_CODE_RE      = re.compile(r'^[A-Z]{1,3}\d{1,2}$')


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic models
# ══════════════════════════════════════════════════════════════════════════════

class CriterionIn(BaseModel):
    code: str = Field(..., description="e.g. P1, M2, D1")
    level: str = Field(..., description="pass | merit | distinction")
    description: str = Field(..., min_length=5)
    scaffold_question: str = Field("", description="Arabic scaffolding question for Cogni")
    keywords: List[str] = Field(default_factory=list)

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not _CODE_RE.match(v):
            raise ValueError(f"Invalid criterion code: {v!r} — expected format like P1, M2, D1")
        return v

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("pass", "merit", "distinction"):
            raise ValueError(f"Invalid level: {v!r} — must be pass, merit, or distinction")
        return v


class UnitIn(BaseModel):
    unit_id: str = Field(..., description="Unique identifier, e.g. unit25")
    title: str   = Field(..., min_length=3)
    qualification: str = Field("", description="e.g. BTEC Level 3 Business")
    description: str   = Field("")
    criteria: List[CriterionIn] = Field(..., min_length=2)

    @field_validator("unit_id")
    @classmethod
    def validate_unit_id(cls, v: str) -> str:
        v = v.strip().lower()
        if not _UNIT_ID_RE.match(v):
            raise ValueError(f"Invalid unit_id: {v!r} — use lowercase alphanumeric + hyphens/underscores only")
        return v


class ProgressIn(BaseModel):
    unit_id: str = Field(..., description="Unit to evaluate against")
    achieved: List[str] = Field(default_factory=list, description="List of achieved criterion codes, e.g. ['P1','P2']")


class ProgressOut(BaseModel):
    unit_id: str
    current_level: str
    next_criterion: Optional[dict]
    summary: dict


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/units", summary="List all available BTEC unit specs")
async def get_units() -> list[dict]:
    """Return a summary list of all unit specs in backend/data/btec_specs/."""
    return list_units()


@router.get("/units/{unit_id}", summary="Get full criteria for a BTEC unit")
async def get_unit(unit_id: str) -> dict:
    """Return the full specification for a single BTEC unit by its ID."""
    # Validate unit_id to prevent path traversal
    unit_id_clean = unit_id.strip().lower()
    if not _UNIT_ID_RE.match(unit_id_clean):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid unit_id format")

    unit = load_unit(unit_id_clean)
    if unit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unit '{unit_id_clean}' not found")
    return unit


@router.post("/units", status_code=status.HTTP_201_CREATED, summary="Ingest a new BTEC unit spec")
async def ingest_unit(
    payload: UnitIn,
    _: User = Depends(get_teacher_user),
) -> dict:
    """Upload and persist a new BTEC unit specification.

    The spec is saved as JSON in backend/data/btec_specs/{unit_id}.json.
    Overwrites existing spec for the same unit_id (intentional — allows updates).
    """
    specs_dir = _specs_dir()
    specs_dir.mkdir(parents=True, exist_ok=True)

    # Build safe filename: unit_id already validated (lowercase alphanum + _ -)
    filename = f"{payload.unit_id}.json"
    target = specs_dir / filename

    # Prevent path traversal — ensure resolved path is inside specs_dir
    try:
        resolved = target.resolve()
        specs_resolved = specs_dir.resolve()
        if not str(resolved).startswith(str(specs_resolved)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid path — security violation"
            )
    except Exception as exc:
        logger.error("[BTECIngest] Path resolution error: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path resolution failed")

    spec_data = payload.model_dump()
    try:
        target.write_text(json.dumps(spec_data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.error("[BTECIngest] Failed to write unit spec %s: %s", filename, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist unit spec"
        )

    # Invalidate LRU cache so the new spec is picked up immediately
    invalidate_cache()
    logger.info("[BTECIngest] Unit spec saved: %s", filename)

    return {
        "status": "created",
        "unit_id": payload.unit_id,
        "filename": filename,
        "criterion_count": len(payload.criteria),
    }


@router.post("/progress", summary="Resolve teaching level from student progress")
async def resolve_progress(
    payload: ProgressIn,
    _: User = Depends(get_current_user),
) -> ProgressOut:
    """Given a unit_id and list of achieved criteria, return:
    - current_level (pass / merit / distinction)
    - next_criterion (the next criterion Cogni should scaffold toward)
    - summary (achieved count per band)

    This endpoint is called by the frontend before/during a tutoring session
    to give Cogni the adaptive teaching context.

    Requires a valid Bearer token (any authenticated role). Rate limiting is handled by global API middleware.
    """
    unit_id_clean = payload.unit_id.strip().lower()
    if not _UNIT_ID_RE.match(unit_id_clean):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid unit_id format")

    unit = load_unit(unit_id_clean)
    if unit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unit '{unit_id_clean}' not found — upload it first via POST /api/v1/btec/units"
        )

    # Validate criterion codes
    achieved_clean = []
    for code in payload.achieved:
        code_upper = code.strip().upper()
        if _CODE_RE.match(code_upper):
            achieved_clean.append(code_upper)
        else:
            logger.warning("[BTECIngest] Ignoring invalid criterion code: %r", code)

    current_level   = infer_teaching_level(achieved_clean, unit)
    next_crit       = get_next_criterion(achieved_clean, unit)
    summary         = get_achieved_summary(achieved_clean, unit)

    return ProgressOut(
        unit_id=unit_id_clean,
        current_level=current_level,
        next_criterion=next_crit,
        summary=summary,
    )
