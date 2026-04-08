# -*- coding: utf-8 -*-
"""
Evaluation Repository — Protocol + InMemory + Postgres
------------------------------------------------------
نمط المستودع لحفظ نتائج BTEC مع إمكانية التبديل بين الذاكرة المؤقتة وقاعدة البيانات.
"""

from __future__ import annotations
import os
import time
import uuid
import logging
from typing import Any, Dict, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


class DatabaseUnavailableError(RuntimeError):
    """قاعدة البيانات غير متاحة — يُستخدم لإرجاع 503."""
    pass


# مستخدم ضيف واحد مُعرَّف ثابتاً لجميع القيم غير UUID (anonymous، نص عشوائي، إلخ)
# يمنع إنشاء uuid.uuid4() جديد في كل طلب.
EDUVERSE_EVALUATION_GUEST_UUID = uuid.uuid5(uuid.NAMESPACE_URL, "https://cogni.local/evaluation-guest")


def resolve_evaluation_student_uuid(student_id: Optional[str]) -> uuid.UUID:
    """حلّ معرف الطالب للتخزين: UUID صالح أو المستخدم الضيف المشترك."""
    s = (student_id or "").strip()
    if not s or s.lower() == "anonymous":
        return EDUVERSE_EVALUATION_GUEST_UUID
    try:
        return uuid.UUID(s)
    except (ValueError, TypeError):
        logger.warning(
            "Invalid student_id %r — mapping to EDUVERSE_EVALUATION_GUEST_UUID",
            s[:80] if s else "",
        )
        return EDUVERSE_EVALUATION_GUEST_UUID


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

    def get_latest_nudge_payload_for_student(self, student_id: str) -> Optional[dict[str, Any]]:
        """آخر تقييم يستحق نداءً استباقياً (نفس شكل fetch_latest_evaluation_nudge_payload) أو None."""
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
        uid_key = str(resolve_evaluation_student_uuid(student_id))
        self._store[eid] = {
            "id": eid,
            "student_id": uid_key,
            "title": title,
            "original_text": original_text,
            "status": status,
            "criteria": criteria,
            "final_grade": final_grade,
            "feedback": feedback,
            "file_path": file_path,
            "ephemeral": True,
            "created_at": time.time(),
        }
        return eid

    def get_by_id(self, evaluation_id: str) -> dict | None:
        return self._store.get(evaluation_id)

    def get_latest_nudge_payload_for_student(self, student_id: str) -> Optional[dict[str, Any]]:
        from app.services.assessment_grade_context import (
            build_criteria_summary_for_nudge,
            grade_warrants_proactive_nudge,
        )

        key = str(resolve_evaluation_student_uuid(student_id))
        best: Optional[dict] = None
        best_ts = 0.0
        for v in self._store.values():
            if v.get("student_id") != key:
                continue
            ts = float(v.get("created_at") or 0.0)
            if ts >= best_ts:
                best_ts = ts
                best = v
        if not best:
            return None
        letter = str(best.get("final_grade") or "").strip()
        if not grade_warrants_proactive_nudge(letter):
            return None
        title = str(best.get("title") or "")[:512]
        crit_raw = best.get("criteria") if isinstance(best.get("criteria"), dict) else {}
        crit_summary = build_criteria_summary_for_nudge(crit_raw)
        return {
            "evaluation_id": str(best.get("id") or ""),
            "grade": letter,
            "final_grade": letter,
            "unit": title,
            "subject": title[:120] if title else "—",
            "source": "memory",
            "criteria_summary": crit_summary,
        }


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
        """يرجع المستخدم لـ UUID المُحلّى؛ لا يُنشئ UUID عشوائياً لمعرفات غير صالحة."""
        uid = resolve_evaluation_student_uuid(student_id)
        user = session.query(self.User).filter(self.User.id == uid).first()
        if user:
            return user
        user = self.User(
            id=uid,
            name="مستخدم ضيف",
            email=f"guest-{uid}@eduverse.local",
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
                id=uuid.uuid4(),
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
                id=uuid.uuid4(),
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

    def get_latest_nudge_payload_for_student(self, student_id: str) -> Optional[dict[str, Any]]:
        """يستدعي نفس منطق التقرير: آخر تقييم + فلتر P/M يستحق المتابعة."""
        uid = resolve_evaluation_student_uuid(student_id)
        db = self.SessionLocal()
        try:
            from app.services.assessment_grade_context import fetch_latest_evaluation_nudge_payload

            return fetch_latest_evaluation_nudge_payload(db, uid, None)
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
        logger.debug("EvaluationRepository: InMemoryEvaluationRepository (USE_DB=false)")
        return InMemoryEvaluationRepository()

    # فحص الاتصال بقاعدة البيانات
    try:
        from app.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.debug("PostgreSQL connection verified for evaluation repository.")
    except Exception as e:
        logger.error("PostgreSQL connection failed: %s", e)
        raise DatabaseUnavailableError(
            "قاعدة البيانات غير متاحة، يرجى التحقق من الإعدادات. "
            "تأكد من تشغيل docker-compose up -d db وتنفيذ alembic upgrade head."
        ) from e

    logger.debug("EvaluationRepository: PostgresEvaluationRepository (USE_DB=true)")
    return PostgresEvaluationRepository()
