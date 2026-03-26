# -*- coding: utf-8 -*-
"""Latest assignment evaluation snapshot for proactive tutor nudges (Checkpoint #46)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.db_models import Assignment, Evaluation


def grade_warrants_proactive_nudge(grade_code: str) -> bool:
    """True when we should motivate improvement (skip Distinction / empty / pending)."""
    g = (grade_code or "").strip().upper()
    if not g or g in ("PENDING", "ERROR", "—", "-"):
        return False
    if g in ("D", "DISTINCTION", "D1"):
        return False
    return True


def fetch_latest_evaluation_nudge_payload(
    db: Session,
    student_id: uuid.UUID,
    subject_substr: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Join Evaluation + Assignment for this student; optional fuzzy filter on assignment title.
    Falls back to latest unfiltered row if filter matches nothing.
    """
    q = (
        db.query(Evaluation, Assignment)
        .join(Assignment, Evaluation.assignment_id == Assignment.id)
        .filter(Assignment.student_id == student_id)
        .order_by(Evaluation.created_at.desc())
    )
    row = None
    sub = (subject_substr or "").strip()
    if sub:
        row = q.filter(Assignment.title.ilike(f"%{sub}%")).first()
    if row is None:
        row = q.first()
    if not row:
        return None
    ev, asn = row
    letter = ev.final_grade.value if hasattr(ev.final_grade, "value") else str(ev.final_grade)
    if not grade_warrants_proactive_nudge(letter):
        return None
    title = (asn.title or "")[:512]
    return {
        "grade": letter,
        "unit": title,
        "subject": sub if sub else title[:120],
        "source": "db",
    }
