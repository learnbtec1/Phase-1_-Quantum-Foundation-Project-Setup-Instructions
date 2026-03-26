# -*- coding: utf-8 -*-
"""Post-session reflection + timeline row (V28)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db_models import StudentTimeline, UserMemory

logger = logging.getLogger(__name__)


def append_session_timeline(
    db: Session,
    user_id: uuid.UUID,
    summary: str,
    topics: Optional[list[str]] = None,
) -> None:
    if not settings.ENABLE_SESSION_TIMELINE:
        return
    try:
        today = date.today()
        row = (
            db.query(StudentTimeline)
            .filter(StudentTimeline.user_id == user_id, StudentTimeline.day_date == today)
            .first()
        )
        if row:
            prev = (row.summary or "").strip()
            row.summary = (prev + "\n" if prev else "") + (summary or "")[:1200]
            if topics:
                tc = row.topics_covered or []
                if isinstance(tc, list):
                    row.topics_covered = list({*tc, *topics})[:40]
                else:
                    row.topics_covered = topics
        else:
            db.add(
                StudentTimeline(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    day_date=today,
                    summary=(summary or "")[:2000],
                    topics_covered=topics or [],
                )
            )
        db.commit()
    except Exception as e:
        logger.warning("timeline append: %s", e)
        db.rollback()


def store_reflection_note(db: Session, user_id: uuid.UUID, note: str) -> None:
    if not settings.ENABLE_POST_SESSION_REFLECTION:
        return
    try:
        db.add(
            UserMemory(
                id=uuid.uuid4(),
                user_id=user_id,
                memory_type="reflection_note",
                content=(note or "")[:8000],
            )
        )
        db.commit()
    except Exception as e:
        logger.warning("reflection note: %s", e)
        db.rollback()


async def generate_reflection_note_async(
    user_id: uuid.UUID,
    session_id: str,
    history_snippet: str,
) -> Optional[str]:
    """Optional LLM call — lightweight; returns None on failure."""
    if not settings.ENABLE_POST_SESSION_REFLECTION:
        return None
    try:
        from app.services.llm_client import cogni_chat_completion

        messages = [
            {
                "role": "system",
                "content": "أنت محلل تعليمي. لخّص الجلسة في 3 جمل عربية فقط: نقاط قوة، نقاط ضعف، اقتراح للجلسة القادمة. بدون مقدمة.",
            },
            {"role": "user", "content": f"session={session_id}\n{history_snippet[:4000]}"},
        ]
        raw = await cogni_chat_completion(
            messages,
            model=settings.TUTOR_MODEL_FREE,
            max_tokens=200,
            temperature=0.4,
            user_id=user_id,
        )
        return (raw or "").strip()[:2000]
    except Exception as e:
        logger.debug("reflection LLM skip: %s", e)
        return None
