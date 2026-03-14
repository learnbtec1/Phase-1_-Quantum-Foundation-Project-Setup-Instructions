# -*- coding: utf-8 -*-
"""
reports.py — Academic Progress Report API endpoints.

Routes:
  GET /api/v1/reports/student/{student_id}
    → Generates and streams a PDF progress report.
    → Returns 404 if no evaluations found for the student.
    → Returns 503 if PDF generation fails.

  GET /api/v1/reports/student/{student_id}/json
    → Returns the raw evaluation list as JSON (useful for testing).
"""
from __future__ import annotations

import io
import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])


def _get_repo():
    """Lazy-import so the repo factory isn't hit at import time."""
    import sys, os
    _root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..")
    )
    if _root not in sys.path:
        sys.path.insert(0, _root)
    from repository.evaluations import get_evaluation_repo   # type: ignore[import]
    return get_evaluation_repo()


def _get_all_by_student(student_id: str) -> list[dict]:
    """
    Pull all evaluations for a student from the repository.
    InMemoryEvaluationRepository doesn't have a list-by-student method yet,
    so we provide a thin adapter that calls create on a get-all-compatible interface.
    """
    repo = _get_repo()
    # Try protocol extension: get_all_by_student (Postgres impl)
    if hasattr(repo, "get_all_by_student"):
        return repo.get_all_by_student(student_id)   # type: ignore[attr-defined]
    # InMemory fallback: scan the internal store
    if hasattr(repo, "_store"):
        store: dict = repo._store                     # type: ignore[attr-defined]
        return [v for v in store.values() if v.get("student_id") == student_id]
    return []


@router.get("/student/{student_id}")
async def get_student_report(
    student_id: Annotated[str, Path(min_length=1, max_length=128)],
    name: str = "",
) -> Response:
    """
    Generate and return a PDF progress report for a student.

    Query params:
      name — optional display name to embed in the PDF header.
    """
    evaluations = _get_all_by_student(student_id)
    if not evaluations:
        raise HTTPException(
            status_code=404,
            detail=f"No evaluations found for student_id={student_id!r}",
        )

    display_name = name.strip() or student_id

    try:
        from app.services.pdf_service import generate_student_report  # type: ignore[import]
        pdf_bytes = generate_student_report(
            student_id=student_id,
            student_name=display_name,
            evaluations=evaluations,
        )
    except ImportError as ie:
        logger.error("[Reports] PDF service unavailable: %s", ie)
        raise HTTPException(
            status_code=503,
            detail="PDF generation unavailable — install reportlab: pip install reportlab arabic-reshaper python-bidi",
        )
    except Exception as exc:
        logger.exception("[Reports] PDF generation failed for student=%s: %s", student_id, exc)
        raise HTTPException(status_code=503, detail="Failed to generate report. See server logs.")

    filename = f"nexus_report_{student_id[:12]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.get("/student/{student_id}/json")
async def get_student_evaluations_json(
    student_id: Annotated[str, Path(min_length=1, max_length=128)],
) -> list[dict]:
    """Return raw evaluation records as JSON (debug / testing)."""
    evals = _get_all_by_student(student_id)
    if not evals:
        raise HTTPException(status_code=404, detail=f"No evaluations for student_id={student_id!r}")
    # Scrub internal ephemeral flag from responses
    return [{k: v for k, v in ev.items() if k != "ephemeral"} for ev in evals]
