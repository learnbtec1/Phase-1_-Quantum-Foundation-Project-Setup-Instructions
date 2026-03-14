# -*- coding: utf-8 -*-
"""
Evaluation Repository
═════════════════════════════════════════════════════════════════════════════
Implements the Repository Pattern for BTEC evaluation storage.

Two concrete implementations are provided:
  • InMemoryEvaluationRepository  — stores in a dict; ephemeral (USE_DB=false).
  • PostgresEvaluationRepository  — stores in PostgreSQL via SQLAlchemy ORM.

A `get_evaluation_repo()` factory reads the USE_DB env-var and returns the
correct implementation. If USE_DB=true but the DB is unreachable, it raises
an HTTP 503 with a friendly Arabic message.

Protocol (structural typing — no ABC inheritance required):
  create(*, student_id, title, original_text, status, criteria, final_grade, feedback) → str
  get_by_id(evaluation_id) → dict | None
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Protocol (structural interface — type-checked, no ABC overhead)
# ─────────────────────────────────────────────────────────────────────────────

@runtime_checkable
class EvaluationRepository(Protocol):
    """Minimal BTEC evaluation storage interface."""

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: Optional[str],
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
    ) -> str:
        """Persist a new evaluation; returns the generated evaluation_id."""
        ...

    def get_by_id(self, evaluation_id: str) -> Optional[dict]:
        """Return the evaluation dict, or None if not found."""
        ...

    def get_by_student(self, student_id: str) -> list[dict]:
        """Return all evaluations for a student, newest first."""
        ...

    # Alias used by reports.py
    def get_all_by_student(self, student_id: str) -> list[dict]:
        """Alias for get_by_student (backward compat)."""
        ...


# ─────────────────────────────────────────────────────────────────────────────
# InMemory implementation  (USE_DB=false)
# ─────────────────────────────────────────────────────────────────────────────

class InMemoryEvaluationRepository:
    """Thread-safe enough for single-process dev; not suitable for production."""

    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: Optional[str],
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
    ) -> str:
        eid = f"mem_{uuid.uuid4()}"   # "mem_" prefix signals ephemeral to the frontend
        self._store[eid] = {
            "id":            eid,
            "student_id":    student_id,
            "title":         title,
            "original_text": original_text,
            "status":        status,
            "criteria":      criteria,
            "final_grade":   final_grade,
            "feedback":      feedback,
            "ephemeral":     True,   # signals to caller that this won't survive restart
        }
        logger.info("[Repo:Memory] Evaluation created id=%s grade=%s", eid, final_grade)
        return eid

    def get_by_id(self, evaluation_id: str) -> Optional[dict]:
        return self._store.get(evaluation_id)

    def get_by_student(self, student_id: str) -> list[dict]:
        """Return all evaluations for student_id, sorted newest first."""
        rows = [
            v for v in self._store.values()
            if v.get("student_id") == student_id
        ]
        # Sort by evaluation id (mem_ prefix + uuid timestamp component)
        return sorted(rows, key=lambda r: r.get("id", ""), reverse=True)

    def get_all_by_student(self, student_id: str) -> list[dict]:
        """Alias for get_by_student (reports.py compatibility)."""
        return self.get_by_student(student_id)


# ─────────────────────────────────────────────────────────────────────────────
# PostgreSQL implementation  (USE_DB=true)
# ─────────────────────────────────────────────────────────────────────────────

class PostgresEvaluationRepository:
    """
    Stores evaluations in PostgreSQL via SQLAlchemy ORM.
    Requires `database.py` (SessionLocal) and `models.py` (Evaluation ORM model).
    """

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: Optional[str],
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
    ) -> str:
        from database import SessionLocal          # type: ignore[import]
        from models import Evaluation as EvalModel  # type: ignore[import]

        db = SessionLocal()
        try:
            eid = str(uuid.uuid4())
            row = EvalModel(
                id=eid,
                student_id=student_id,
                title=title,
                original_text=original_text,
                status=status,
                criteria=criteria,
                final_grade=final_grade,
                feedback_summary=feedback,
            )
            db.add(row)
            db.commit()
            logger.info("[Repo:Postgres] Evaluation created id=%s grade=%s", eid, final_grade)
            return eid
        except Exception as exc:
            db.rollback()
            logger.exception("[Repo:Postgres] create failed: %s", exc)
            raise
        finally:
            db.close()

    def get_by_id(self, evaluation_id: str) -> Optional[dict]:
        from database import SessionLocal          # type: ignore[import]
        from models import Evaluation as EvalModel  # type: ignore[import]

        db = SessionLocal()
        try:
            row = db.query(EvalModel).filter(EvalModel.id == evaluation_id).first()
            if row is None:
                return None
            return {
                "id":            row.id,
                "student_id":    row.student_id,
                "title":         row.title,
                "original_text": row.original_text,
                "status":        row.status,
                "criteria":      row.criteria,
                "final_grade":   row.final_grade,
                "feedback":      row.feedback_summary,
                "ephemeral":     False,
            }
        finally:
            db.close()

    def get_by_student(self, student_id: str) -> list[dict]:
        """Return all evaluations for student_id, sorted by created_at desc."""
        from database import SessionLocal          # type: ignore[import]
        from models import Evaluation as EvalModel  # type: ignore[import]

        db = SessionLocal()
        try:
            rows = (
                db.query(EvalModel)
                .filter(EvalModel.student_id == student_id)
                .order_by(EvalModel.id.desc())
                .all()
            )
            return [
                {
                    "id":            r.id,
                    "student_id":    r.student_id,
                    "title":         r.title,
                    "original_text": r.original_text,
                    "status":        r.status,
                    "criteria":      r.criteria,
                    "final_grade":   r.final_grade,
                    "feedback":      r.feedback_summary,
                    "ephemeral":     False,
                }
                for r in rows
            ]
        finally:
            db.close()

    def get_all_by_student(self, student_id: str) -> list[dict]:
        """Alias for get_by_student (reports.py compatibility)."""
        return self.get_by_student(student_id)


# ─────────────────────────────────────────────────────────────────────────────
# Factory  (reads USE_DB env-var)
# ─────────────────────────────────────────────────────────────────────────────

_repo_instance: Optional[EvaluationRepository] = None


def get_evaluation_repo() -> EvaluationRepository:
    """
    Return the singleton repository.

    • USE_DB=false (default) → InMemoryEvaluationRepository
    • USE_DB=true            → PostgresEvaluationRepository
      If Postgres is unreachable, raises fastapi.HTTPException(503).
    """
    global _repo_instance
    if _repo_instance is not None:
        return _repo_instance

    use_db = os.getenv("USE_DB", "false").lower() in ("true", "1", "yes")

    if not use_db:
        _repo_instance = InMemoryEvaluationRepository()
        logger.info("[Repo] Using InMemoryEvaluationRepository (USE_DB=false)")
        return _repo_instance

    # Postgres path — test the connection before returning
    try:
        from database import engine  # type: ignore[import]
        with engine.connect():
            pass
        _repo_instance = PostgresEvaluationRepository()
        logger.info("[Repo] Using PostgresEvaluationRepository (USE_DB=true)")
    except Exception as exc:
        logger.error("[Repo] PostgreSQL unreachable: %s", exc)
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail=(
                "قاعدة البيانات غير متاحة حالياً. "
                "يرجى التحقق من إعدادات DATABASE_URL أو تشغيل: docker-compose up -d db"
            ),
        )

    return _repo_instance
