# -*- coding: utf-8 -*-
"""Teacher dashboard API — students + last memory snapshot."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_teacher_user
from app.database import get_db
from app.models.db_models import (
    Answer,
    Lesson,
    LessonAssignment,
    StudentTimeline,
    Subject,
    Topic,
    User,
    UserMemory,
    UserRole,
    UserTopicMastery,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class StudentRow(BaseModel):
    id: str
    email: str
    name: str
    last_emotional_summary: Optional[str] = None
    topics_hint: Optional[List[str]] = None


def _latest_memory_row(db: Session, user_id, memory_type: str) -> Optional[UserMemory]:
    return (
        db.query(UserMemory)
        .filter(UserMemory.user_id == user_id, UserMemory.memory_type == memory_type)
        .order_by(desc(UserMemory.created_at))
        .first()
    )


def _extract_topics_from_emotional(content: str) -> List[str]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return []
    topics: List[str] = []
    for e in entries[-8:]:
        if not isinstance(e, dict):
            continue
        s = (e.get("summary") or "")[:120]
        if s:
            topics.append(s)
    return topics[:12]


@router.get("/students", response_model=List[StudentRow])
def list_students(
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> List[StudentRow]:
    try:
        students = db.query(User).filter(User.role == UserRole.student).order_by(User.email).all()
        out: List[StudentRow] = []
        for s in students:
            row_em = _latest_memory_row(db, s.id, "emotional")
            summary: Optional[str] = None
            topics: Optional[List[str]] = None
            if row_em and row_em.content:
                try:
                    data = json.loads(row_em.content)
                    if isinstance(data, dict):
                        entries = data.get("entries")
                        if isinstance(entries, list) and entries:
                            last = entries[-1]
                            if isinstance(last, dict):
                                summary = (last.get("summary") or "")[:500] or None
                except json.JSONDecodeError:
                    summary = row_em.content[:500]
                topics = _extract_topics_from_emotional(row_em.content) or None
            out.append(
                StudentRow(
                    id=str(s.id),
                    email=s.email,
                    name=s.name,
                    last_emotional_summary=summary,
                    topics_hint=topics,
                )
            )
        return out
    except Exception as e:
        logger.exception("dashboard students failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not load students") from e


# ── Phase B — progress, assignments, analytics ───────────────────────────────


class TopicMasteryRow(BaseModel):
    topic_id: int
    topic_name: str
    subject_name: str
    score: float
    mastered: bool
    attempted: int
    correct: int


class AnswerRow(BaseModel):
    answer_id: str
    question_text: str
    score: Optional[float] = None
    feedback: Optional[str] = None
    created_at: Optional[str] = None


class StudentProgressOut(BaseModel):
    student_id: str
    topics: List[TopicMasteryRow]
    recent_answers: List[AnswerRow]


@router.get("/students/{student_id}/progress", response_model=StudentProgressOut)
def student_progress(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> StudentProgressOut:
    try:
        suid = uuid.UUID(student_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid student id") from e
    stu = db.query(User).filter(User.id == suid, User.role == UserRole.student).first()
    if not stu:
        raise HTTPException(status_code=404, detail="Student not found")

    mastery_rows = db.query(UserTopicMastery).filter(UserTopicMastery.user_id == suid).all()
    topics_out: List[TopicMasteryRow] = []
    for m in mastery_rows:
        top = db.query(Topic).filter(Topic.id == m.topic_id).first()
        subj_name = ""
        if top:
            sj = db.query(Subject).filter(Subject.id == top.subject_id).first()
            subj_name = sj.name if sj else ""
        topics_out.append(
            TopicMasteryRow(
                topic_id=m.topic_id,
                topic_name=top.name if top else "?",
                subject_name=subj_name,
                score=float(m.score or 0),
                mastered=bool(m.mastered),
                attempted=int(m.questions_attempted or 0),
                correct=int(m.questions_correct or 0),
            )
        )

    ans_rows = (
        db.query(Answer)
        .options(joinedload(Answer.question))
        .filter(Answer.user_id == suid)
        .order_by(desc(Answer.created_at))
        .limit(25)
        .all()
    )
    recent: List[AnswerRow] = []
    for a in ans_rows:
        qt = ""
        if a.question:
            qt = (a.question.text or "")[:500]
        recent.append(
            AnswerRow(
                answer_id=str(a.id),
                question_text=qt,
                score=a.score,
                feedback=(a.feedback or "")[:800] if a.feedback else None,
                created_at=a.created_at.isoformat() if a.created_at else None,
            )
        )

    return StudentProgressOut(student_id=str(suid), topics=topics_out, recent_answers=recent)


class TimelineRow(BaseModel):
    day: str
    summary: Optional[str] = None
    topics_covered: Optional[Any] = None


@router.get("/students/{student_id}/timeline", response_model=List[TimelineRow])
def student_timeline(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
    limit: int = 60,
) -> List[TimelineRow]:
    try:
        suid = uuid.UUID(student_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid student id") from e
    stu = db.query(User).filter(User.id == suid, User.role == UserRole.student).first()
    if not stu:
        raise HTTPException(status_code=404, detail="Student not found")
    rows = (
        db.query(StudentTimeline)
        .filter(StudentTimeline.user_id == suid)
        .order_by(desc(StudentTimeline.day_date))
        .limit(min(200, max(1, limit)))
        .all()
    )
    out: List[TimelineRow] = []
    for r in rows:
        out.append(
            TimelineRow(
                day=str(r.day_date),
                summary=(r.summary or "")[:2000] or None,
                topics_covered=r.topics_covered,
            )
        )
    return out


class LessonAssignmentOut(BaseModel):
    id: str
    teacher_id: str
    student_id: str
    lesson_id: int
    assigned_at: Optional[str] = None
    completed_at: Optional[str] = None
    lesson_title: Optional[str] = None


@router.get("/lesson-assignments", response_model=List[LessonAssignmentOut])
def list_lesson_assignments(
    db: Session = Depends(get_db),
    user: User = Depends(get_teacher_user),
) -> List[LessonAssignmentOut]:
    q = db.query(LessonAssignment).order_by(desc(LessonAssignment.assigned_at)).limit(200).all()
    out: List[LessonAssignmentOut] = []
    for row in q:
        les = db.query(Lesson).filter(Lesson.id == row.lesson_id).first()
        out.append(
            LessonAssignmentOut(
                id=str(row.id),
                teacher_id=str(row.teacher_id),
                student_id=str(row.student_id),
                lesson_id=row.lesson_id,
                assigned_at=row.assigned_at.isoformat() if row.assigned_at else None,
                completed_at=row.completed_at.isoformat() if row.completed_at else None,
                lesson_title=les.title if les else None,
            )
        )
    return out


class AssignLessonBody(BaseModel):
    student_id: str = Field(..., min_length=8)
    lesson_id: int


@router.post("/assign", response_model=LessonAssignmentOut)
def assign_lesson(
    body: AssignLessonBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_teacher_user),
) -> LessonAssignmentOut:
    try:
        stu_id = uuid.UUID(body.student_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid student_id") from e
    stu = db.query(User).filter(User.id == stu_id, User.role == UserRole.student).first()
    if not stu:
        raise HTTPException(status_code=404, detail="Student not found")
    les = db.query(Lesson).filter(Lesson.id == body.lesson_id).first()
    if not les:
        raise HTTPException(status_code=404, detail="Lesson not found")
    row = LessonAssignment(
        teacher_id=user.id,
        student_id=stu_id,
        lesson_id=body.lesson_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return LessonAssignmentOut(
        id=str(row.id),
        teacher_id=str(row.teacher_id),
        student_id=str(row.student_id),
        lesson_id=row.lesson_id,
        assigned_at=row.assigned_at.isoformat() if row.assigned_at else None,
        completed_at=None,
        lesson_title=les.title,
    )


class AnalyticsOut(BaseModel):
    total_answers: int
    average_score: Optional[float] = None
    lesson_assignments_open: int
    students_with_mastery_rows: int


@router.get("/analytics", response_model=AnalyticsOut)
def dashboard_analytics(
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> AnalyticsOut:
    total_ans = db.query(func.count(Answer.id)).scalar() or 0
    avg = db.query(func.avg(Answer.score)).filter(Answer.score.isnot(None)).scalar()
    open_assign = (
        db.query(func.count(LessonAssignment.id))
        .filter(LessonAssignment.completed_at.is_(None))
        .scalar()
        or 0
    )
    mastery_users = db.query(func.count(func.distinct(UserTopicMastery.user_id))).scalar() or 0
    return AnalyticsOut(
        total_answers=int(total_ans),
        average_score=float(avg) if avg is not None else None,
        lesson_assignments_open=int(open_assign),
        students_with_mastery_rows=int(mastery_users),
    )
