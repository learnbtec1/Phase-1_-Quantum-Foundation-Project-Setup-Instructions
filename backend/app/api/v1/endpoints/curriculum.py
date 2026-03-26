# -*- coding: utf-8 -*-
"""Curriculum CMS — subjects, topics, lessons, questions (Phase B)."""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_teacher_user
from app.database import get_db
from app.models.db_models import Lesson, Question, Subject, Topic, User, UserRole
from app.services.curriculum_service import select_question_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/curriculum", tags=["curriculum"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class SubjectOut(BaseModel):
    id: int
    name: str
    grade_level: Optional[str] = None


class SubjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    grade_level: Optional[str] = None


class TopicOut(BaseModel):
    id: int
    subject_id: int
    name: str
    order_index: int = 0


class TopicCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=512)
    order_index: int = 0


class LessonOut(BaseModel):
    id: int
    topic_id: int
    title: str
    content: Optional[str] = None
    learning_objectives: Optional[str] = None
    estimated_duration_min: Optional[int] = None


class LessonCreate(BaseModel):
    title: str
    content: Optional[str] = None
    learning_objectives: Optional[str] = None
    estimated_duration_min: Optional[int] = None


class QuestionOut(BaseModel):
    id: int
    lesson_id: int
    text: str
    type: str
    correct_answer: Optional[str] = None
    options: Optional[Any] = None
    rubric: Optional[str] = None
    difficulty: Optional[float] = None


class QuestionCreate(BaseModel):
    text: str
    type: str  # mcq | short_answer | essay
    correct_answer: Optional[str] = None
    options: Optional[Any] = None
    rubric: Optional[str] = None
    difficulty: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)


# ── Read (any authenticated user) ───────────────────────────────────────────


@router.get("/subjects", response_model=List[SubjectOut])
def list_subjects(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[SubjectOut]:
    rows = db.query(Subject).order_by(Subject.name).all()
    return [SubjectOut(id=r.id, name=r.name, grade_level=r.grade_level) for r in rows]


@router.get("/subjects/{subject_id}/topics", response_model=List[TopicOut])
def list_topics(
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[TopicOut]:
    rows = (
        db.query(Topic)
        .filter(Topic.subject_id == subject_id)
        .order_by(Topic.order_index, Topic.id)
        .all()
    )
    return [
        TopicOut(id=r.id, subject_id=r.subject_id, name=r.name, order_index=r.order_index or 0)
        for r in rows
    ]


@router.get("/topics/{topic_id}/lessons", response_model=List[LessonOut])
def list_lessons(
    topic_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[LessonOut]:
    rows = db.query(Lesson).filter(Lesson.topic_id == topic_id).order_by(Lesson.id).all()
    return [
        LessonOut(
            id=r.id,
            topic_id=r.topic_id,
            title=r.title,
            content=r.content,
            learning_objectives=r.learning_objectives,
            estimated_duration_min=r.estimated_duration_min,
        )
        for r in rows
    ]


@router.get("/lessons/{lesson_id}/questions", response_model=List[QuestionOut])
def list_questions(
    lesson_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[QuestionOut]:
    rows = db.query(Question).filter(Question.lesson_id == lesson_id).order_by(Question.id).all()
    return [
        QuestionOut(
            id=r.id,
            lesson_id=r.lesson_id,
            text=r.text,
            type=r.type,
            correct_answer=r.correct_answer,
            options=r.options,
            rubric=r.rubric,
            difficulty=r.difficulty,
        )
        for r in rows
    ]


@router.get("/topics/{topic_id}/select-question", response_model=QuestionOut)
def api_select_question(
    topic_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> QuestionOut:
    q = select_question_for_user(db, user.id, topic_id)
    if not q:
        raise HTTPException(status_code=404, detail="No question available for this topic")
    return QuestionOut(
        id=q.id,
        lesson_id=q.lesson_id,
        text=q.text,
        type=q.type,
        correct_answer=q.correct_answer,
        options=q.options,
        rubric=q.rubric,
        difficulty=q.difficulty,
    )


# ── Write (teacher / admin) ──────────────────────────────────────────────────


@router.post("/subjects", response_model=SubjectOut)
def create_subject(
    body: SubjectCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> SubjectOut:
    s = Subject(name=body.name.strip(), grade_level=body.grade_level)
    db.add(s)
    db.commit()
    db.refresh(s)
    return SubjectOut(id=s.id, name=s.name, grade_level=s.grade_level)


@router.post("/subjects/{subject_id}/topics", response_model=TopicOut)
def create_topic(
    subject_id: int,
    body: TopicCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> TopicOut:
    t = Topic(subject_id=subject_id, name=body.name.strip(), order_index=body.order_index)
    db.add(t)
    db.commit()
    db.refresh(t)
    return TopicOut(id=t.id, subject_id=t.subject_id, name=t.name, order_index=t.order_index or 0)


@router.post("/topics/{topic_id}/lessons", response_model=LessonOut)
def create_lesson(
    topic_id: int,
    body: LessonCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> LessonOut:
    L = Lesson(
        topic_id=topic_id,
        title=body.title.strip(),
        content=body.content,
        learning_objectives=body.learning_objectives,
        estimated_duration_min=body.estimated_duration_min,
    )
    db.add(L)
    db.commit()
    db.refresh(L)
    return LessonOut(
        id=L.id,
        topic_id=L.topic_id,
        title=L.title,
        content=L.content,
        learning_objectives=L.learning_objectives,
        estimated_duration_min=L.estimated_duration_min,
    )


@router.post("/lessons/{lesson_id}/questions", response_model=QuestionOut)
def create_question(
    lesson_id: int,
    body: QuestionCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_teacher_user),
) -> QuestionOut:
    if body.type not in ("mcq", "short_answer", "essay"):
        raise HTTPException(status_code=400, detail="type must be mcq, short_answer, or essay")
    q = Question(
        lesson_id=lesson_id,
        text=body.text.strip(),
        type=body.type,
        correct_answer=body.correct_answer,
        options=body.options,
        rubric=body.rubric,
        difficulty=body.difficulty,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return QuestionOut(
        id=q.id,
        lesson_id=q.lesson_id,
        text=q.text,
        type=q.type,
        correct_answer=q.correct_answer,
        options=q.options,
        rubric=q.rubric,
        difficulty=q.difficulty,
    )
