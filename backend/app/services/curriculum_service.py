# -*- coding: utf-8 -*-
"""Curriculum CMS helpers: adaptive question selection, mastery updates."""

from __future__ import annotations

import logging
import random
from typing import List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from app.models.db_models import Answer, Lesson, Question, Topic, UserTopicMastery

logger = logging.getLogger(__name__)


def get_or_create_mastery(db: Session, user_id, topic_id) -> UserTopicMastery:
    row = (
        db.query(UserTopicMastery)
        .filter(UserTopicMastery.user_id == user_id, UserTopicMastery.topic_id == topic_id)
        .first()
    )
    if row:
        return row
    row = UserTopicMastery(user_id=user_id, topic_id=topic_id, questions_attempted=0, questions_correct=0, score=0.0, mastered=False)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_mastery_after_answer(db: Session, user_id, topic_id: int, correct: bool) -> UserTopicMastery:
    m = get_or_create_mastery(db, user_id, topic_id)
    m.questions_attempted = (m.questions_attempted or 0) + 1
    if correct:
        m.questions_correct = (m.questions_correct or 0) + 1
    att = max(1, m.questions_attempted)
    m.score = (m.questions_correct or 0) / float(att)
    m.mastered = m.score >= 0.8 and att >= 3
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def select_question_for_user(db: Session, user_id, topic_id: int) -> Optional[Question]:
    """Pick a question whose difficulty matches inferred mastery on the topic."""
    qs: List[Question] = db.query(Question).join(Lesson).filter(Lesson.topic_id == topic_id).all()
    if not qs:
        return None

    m = get_or_create_mastery(db, user_id, topic_id)
    mastery = float(m.score or 0.0)
    if (m.questions_attempted or 0) < 1:
        mastery = 0.45

    def band(d: float) -> str:
        if d < 0.35:
            return "easy"
        if d < 0.65:
            return "mid"
        return "hard"

    want = "easy"
    if mastery >= 0.5:
        want = "mid"
    if mastery >= 0.8:
        want = "hard"

    buckets: dict[str, List[Question]] = {"easy": [], "mid": [], "hard": []}
    for q in qs:
        d = float(q.difficulty or 0.5)
        buckets[band(d)].append(q)

    pool = buckets.get(want) or []
    if not pool:
        pool = qs
    return random.choice(pool)


def infer_topic_id_from_lesson_plan(db: Session, active_lesson_plan: Optional[str]) -> Optional[int]:
    """Best-effort: no structured link yet — return None (caller uses default/first topic)."""
    return None


def first_topic_id(db: Session) -> Optional[int]:
    t = db.query(Topic).order_by(Topic.subject_id, Topic.order_index, Topic.id).first()
    return int(t.id) if t else None


def recent_assessment_lines(db: Session, user_id, limit: int = 5) -> str:
    """Arabic lines for tutor system prompt."""
    rows = (
        db.query(Answer)
        .options(joinedload(Answer.question))
        .filter(Answer.user_id == user_id)
        .order_by(desc(Answer.created_at))
        .limit(limit)
        .all()
    )
    if not rows:
        return ""
    lines: List[str] = []
    for a in rows:
        qtext = ""
        try:
            if a.question:
                qtext = (a.question.text or "")[:160]
        except Exception:
            qtext = ""
        sc = a.score if a.score is not None else 0.0
        fb = (a.feedback or "")[:220]
        lines.append(f"• سؤال: {qtext} — الدرجة: {sc:.2f} — ملاحظة: {fb}")
    return "\n".join(lines)
