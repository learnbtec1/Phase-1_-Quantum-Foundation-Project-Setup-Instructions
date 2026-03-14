# -*- coding: utf-8 -*-
"""
Evaluation Repository — Protocol + InMemory + Postgres
------------------------------------------------------
نمط المستودع لحفظ نتائج BTEC مع إمكانية التبديل بين الذاكرة المؤقتة وقاعدة البيانات.
"""

from __future__ import annotations
import os
import uuid
import logging
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


class DatabaseUnavailableError(RuntimeError):
    """قاعدة البيانات غير متاحة — يُستخدم لإرجاع 503."""
    pass


@runtime_checkable
class EvaluationRepository(Protocol):
    """واجهة المستودع لحفظ واسترجاع التقييمات."""

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: str | None,
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
        file_path: str | None = None,
    ) -> str:
        """يحفظ تقييماً ويرجع evaluation_id."""
        ...

    def get_by_id(self, evaluation_id: str) -> dict | None:
        """يرجع التقييم بالمعرف أو None."""
        ...


class InMemoryEvaluationRepository:
    """
    تخزين مؤقت داخل العملية.
    المعرفات عشوائية (uuid4)، الاستجابة تحتوي ephemeral: true.
    """

    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: str | None,
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
        file_path: str | None = None,
    ) -> str:
        eid = str(uuid.uuid4())
        self._store[eid] = {
            "id": eid,
            "student_id": student_id,
            "title": title,
            "original_text": original_text,
            "status": status,
            "criteria": criteria,
            "final_grade": final_grade,
            "feedback": feedback,
            "file_path": file_path,
            "ephemeral": True,
        }
        return eid

    def get_by_id(self, evaluation_id: str) -> dict | None:
        return self._store.get(evaluation_id)


class PostgresEvaluationRepository:
    """
    تخزين دائم في PostgreSQL عبر SQLAlchemy.
    """

    def __init__(self) -> None:
        from app.database import SessionLocal
        from app.models.db_models import User, Assignment, Evaluation, AssignmentStatus, GradeEnum
        self.SessionLocal = SessionLocal
        self.User = User
        self.Assignment = Assignment
        self.Evaluation = Evaluation
        self.AssignmentStatus = AssignmentStatus
        self.GradeEnum = GradeEnum

    def _get_or_create_user(self, session, student_id: str):
        """يرجع المستخدم أو ينشئ واحداً افتراضياً للضيوف."""
        try:
            uid = uuid.UUID(student_id)
        except (ValueError, TypeError):
            uid = uuid.uuid4()
        user = session.query(self.User).filter(self.User.id == uid).first()
        if user:
            return user
        user = self.User(
            id=uid,
            name="مستخدم ضيف",
            email=f"guest-{uid}@nexus.local",  # فريد لأن uid عشوائي
            role="student",
        )
        session.add(user)
        session.flush()
        return user

    def create(
        self,
        *,
        student_id: str,
        title: str,
        original_text: str | None,
        status: str,
        criteria: dict,
        final_grade: str,
        feedback: str,
        file_path: str | None = None,
    ) -> str:
        db = self.SessionLocal()
        try:
            user = self._get_or_create_user(db, student_id)
            assignment = self.Assignment(
                id=str(uuid.uuid4()),
                student_id=user.id,
                title=title,
                original_text=original_text,
                file_path=file_path,
                status=self.AssignmentStatus.evaluated if status == "evaluated" else self.AssignmentStatus.pending,
            )
            db.add(assignment)
            db.flush()

            grade_enum = self.GradeEnum(final_grade) if final_grade in ("P", "M", "D", "R") else self.GradeEnum.R
            evaluation = self.Evaluation(
                id=str(uuid.uuid4()),
                assignment_id=assignment.id,
                final_grade=grade_enum,
                criteria=criteria,
                feedback_summary=feedback,
            )
            db.add(evaluation)
            db.commit()
            return str(evaluation.id)
        except Exception as e:
            db.rollback()
            logger.exception("PostgresEvaluationRepository.create failed: %s", e)
            raise
        finally:
            db.close()

    def get_by_id(self, evaluation_id: str) -> dict | None:
        db = self.SessionLocal()
        try:
            ev = db.query(self.Evaluation).filter(self.Evaluation.id == evaluation_id).first()
            if not ev:
                return None
            return {
                "id": str(ev.id),
                "final_grade": ev.final_grade.value if hasattr(ev.final_grade, "value") else str(ev.final_grade),
                "criteria": ev.criteria or {},
                "feedback": ev.feedback_summary or "",
                "ephemeral": False,
            }
        finally:
            db.close()


def get_evaluation_repo() -> EvaluationRepository:
    """
    مصنع المستودع حسب مفتاح الميزة USE_DB.
    USE_DB=false (افتراضي) → InMemory
    USE_DB=true → Postgres (مع فحص الاتصال عند البدء)
    """
    use_db = os.getenv("USE_DB", "false").lower() in ("true", "1", "yes")
    if not use_db:
        return InMemoryEvaluationRepository()

    # فحص الاتصال بقاعدة البيانات
    try:
        from app.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("PostgreSQL connection verified.")
    except Exception as e:
        logger.error("PostgreSQL connection failed: %s", e)
        raise DatabaseUnavailableError(
            "قاعدة البيانات غير متاحة، يرجى التحقق من الإعدادات. "
            "تأكد من تشغيل docker-compose up -d db وتنفيذ alembic upgrade head."
        ) from e

    return PostgresEvaluationRepository()
