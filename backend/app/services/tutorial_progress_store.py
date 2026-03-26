# -*- coding: utf-8 -*-
"""PostgreSQL persistence for BTEC tutorial / scaffolding progress (per user + unit)."""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_CRIT_RE = re.compile(r"\b([A-Z]\.[PMD]\d+)\b")


def tutorial_persistence_enabled() -> bool:
    return os.getenv("ENABLE_TUTORIAL_PERSISTENCE", "true").lower() in ("1", "true", "yes")


def extract_criterion_codes_ordered(text: str) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for m in _CRIT_RE.finditer(text or ""):
        c = m.group(1)
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def extract_unit_id_from_text(text: str) -> Optional[str]:
    t = (text or "").strip()
    if not t:
        return None
    m = re.search(r"(?:unit|وحدة|u)\s*[:#]?\s*(\d{1,3})\b", t, re.I)
    if m:
        return m.group(1).strip()
    m2 = re.search(r"\b(?:الوحدة)\s+(\d{1,3})\b", t, re.I)
    if m2:
        return m2.group(1).strip()
    return None


def sort_criteria_codes(codes: List[str]) -> List[str]:
    def sort_key(c: str) -> tuple:
        m = re.match(r"([A-Z])\.([PMD])(\d+)", c.upper())
        if not m:
            return (99, 99, 99, c)
        letter = ord(m.group(1)) - ord("A")
        band = {"P": 0, "M": 1, "D": 2}.get(m.group(2), 9)
        num = int(m.group(3))
        return (letter, band, num)

    return sorted(set(codes), key=sort_key)


def next_criterion_after(current: str, ordered: List[str], completed: List[str]) -> Optional[str]:
    done = set(str(x).upper() for x in (completed or []))
    seq = sort_criteria_codes(ordered) if ordered else []
    if not seq:
        return None
    cur_u = (current or "").upper()
    try:
        idx = seq.index(cur_u)
    except ValueError:
        return seq[0] if seq else None
    for j in range(idx + 1, len(seq)):
        if seq[j] not in done:
            return seq[j]
    return None


def row_to_dict(row: Any) -> Dict[str, Any]:
    return {
        "unit_id": str(row.unit_id),
        "current_criterion": str(row.current_criterion or "A.P1"),
        "last_mini_check_question": row.last_mini_check_question,
        "last_mini_check_attempts": int(row.last_mini_check_attempts or 0),
        "completed_criteria": list(row.completed_criteria or []),
        "expects_mini_answer": bool(row.expects_mini_answer),
    }


def get_tutorial_row(user_id: uuid.UUID, unit_id: str) -> Optional[Any]:
    if not tutorial_persistence_enabled() or not user_id or not (unit_id or "").strip():
        return None
    try:
        from app.database import SessionLocal
        from app.models.db_models import TutorialProgress

        db = SessionLocal()
        try:
            return (
                db.query(TutorialProgress)
                .filter(
                    TutorialProgress.user_id == user_id,
                    TutorialProgress.unit_id == str(unit_id).strip()[:64],
                )
                .first()
            )
        finally:
            db.close()
    except Exception as ex:
        logger.warning("[tutorial_progress_store] get_tutorial_row failed: %s", ex)
        return None


def get_or_create_tutorial_row(
    user_id: uuid.UUID,
    unit_id: str,
    reference_text: str,
) -> Optional[Any]:
    if not tutorial_persistence_enabled() or not user_id:
        return None
    uid = str(unit_id or "").strip()[:64]
    if not uid:
        return None
    try:
        from app.database import SessionLocal
        from app.models.db_models import TutorialProgress

        db = SessionLocal()
        try:
            row = (
                db.query(TutorialProgress)
                .filter(TutorialProgress.user_id == user_id, TutorialProgress.unit_id == uid)
                .first()
            )
            codes = extract_criterion_codes_ordered(reference_text)
            first_crit = codes[0] if codes else "A.P1"
            if row is None:
                row = TutorialProgress(
                    user_id=user_id,
                    unit_id=uid,
                    current_criterion=first_crit,
                    last_mini_check_attempts=0,
                    completed_criteria=[],
                    expects_mini_answer=False,
                )
                db.add(row)
                db.commit()
                db.refresh(row)
            return row
        finally:
            db.close()
    except Exception as ex:
        logger.warning("[tutorial_progress_store] get_or_create failed: %s", ex)
        return None


def update_tutorial_row(user_id: uuid.UUID, unit_id: str, **fields: Any) -> None:
    if not tutorial_persistence_enabled() or not user_id:
        return
    uid = str(unit_id or "").strip()[:64]
    if not uid:
        return
    try:
        from app.database import SessionLocal
        from app.models.db_models import TutorialProgress

        db = SessionLocal()
        try:
            row = (
                db.query(TutorialProgress)
                .filter(TutorialProgress.user_id == user_id, TutorialProgress.unit_id == uid)
                .first()
            )
            if not row:
                return
            for k, v in fields.items():
                if hasattr(row, k):
                    setattr(row, k, v)
            row.updated_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()
    except Exception as ex:
        logger.warning("[tutorial_progress_store] update failed: %s", ex)


def set_expects_mini_answer(user_id: uuid.UUID, unit_id: str, question_snippet: str) -> None:
    update_tutorial_row(
        user_id,
        unit_id,
        expects_mini_answer=True,
        last_mini_check_question=(question_snippet or "")[:2000],
    )


def clear_expects_mini_answer(user_id: uuid.UUID, unit_id: str) -> None:
    update_tutorial_row(user_id, unit_id, expects_mini_answer=False)


def clear_tutorial_state(user_id: uuid.UUID, unit_id: str) -> None:
    if not tutorial_persistence_enabled() or not user_id:
        return
    uid = str(unit_id or "").strip()[:64]
    if not uid:
        return
    try:
        from app.database import SessionLocal
        from app.models.db_models import TutorialProgress

        db = SessionLocal()
        try:
            db.query(TutorialProgress).filter(
                TutorialProgress.user_id == user_id,
                TutorialProgress.unit_id == uid,
            ).delete()
            db.commit()
        finally:
            db.close()
    except Exception as ex:
        logger.warning("[tutorial_progress_store] clear failed: %s", ex)
