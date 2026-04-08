# -*- coding: utf-8 -*-
"""Latest assignment evaluation snapshot for proactive tutor nudges (Checkpoint #46)."""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.db_models import Assignment, Evaluation

_BTEC_CODE_RE = re.compile(r"^\s*([PMD])(\d{1,2})\s*$", re.I)


def grade_warrants_proactive_nudge(grade_code: str) -> bool:
    """True when we should motivate improvement (skip Distinction / empty / pending)."""
    g = (grade_code or "").strip().upper()
    if not g or g in ("PENDING", "ERROR", "—", "-"):
        return False
    if g in ("D", "DISTINCTION", "D1"):
        return False
    return True


def build_criteria_summary_for_nudge(criteria: Any) -> Optional[Dict[str, List[str]]]:
    """
    يستخرج من حقل criteria المحفوظ (مخرجات forensic: code -> {achieved: bool, ...})
    قوائم رموز محققة وغير محققة. يعيد None إن لم يكن الشكل قابلاً للتحليل.
    """
    if not isinstance(criteria, dict) or not criteria:
        return None
    achieved: List[str] = []
    missing: List[str] = []

    def _norm_code(key: str) -> Optional[str]:
        k = (key or "").strip().upper()
        if not k:
            return None
        m = _BTEC_CODE_RE.match(k)
        if m:
            return f"{m.group(1).upper()}{m.group(2)}"
        if len(k) <= 8 and k.replace(".", "").isalnum():
            return k
        return k[:16]

    for raw_key, raw_val in criteria.items():
        code = _norm_code(str(raw_key))
        if not code:
            continue
        ok = False
        if isinstance(raw_val, dict):
            ok = bool(raw_val.get("achieved"))
        elif isinstance(raw_val, bool):
            ok = raw_val
        (achieved if ok else missing).append(code)

    achieved = sorted(set(achieved))
    missing = sorted(set(missing))
    if not achieved and not missing:
        return None
    return {"achieved": achieved, "missing": missing}


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
    crit_raw = ev.criteria if isinstance(ev.criteria, dict) else {}
    crit_summary = build_criteria_summary_for_nudge(crit_raw)
    return {
        "evaluation_id": str(ev.id),
        "grade": letter,
        "final_grade": letter,
        "unit": title,
        "subject": sub if sub else title[:120],
        "source": "db",
        "criteria_summary": crit_summary,
    }
