# -*- coding: utf-8 -*-
"""
models.py — SQLAlchemy ORM models for the EDUVERSE BTEC platform.

Tables:
  users        — platform users (students / teachers)
  assignments  — student assignment submissions
  evaluations  — BTEC grading results linked to assignments

Run `alembic upgrade head` to create these tables in the database.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, Enum as SAEnum, ForeignKey,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON  # SQLite fallback

from database import Base


# ── Helper ────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"


class AssignmentStatus(str, enum.Enum):
    pending   = "pending"
    evaluated = "evaluated"


class FinalGrade(str, enum.Enum):
    P = "P"
    M = "M"
    D = "D"
    R = "R"


# ── Models ────────────────────────────────────────────────────────────────────

class User(Base):
    """Platform users. Role determines access rights in the frontend."""

    __tablename__ = "users"

    id         = Column(String(36), primary_key=True, default=_uuid)
    name       = Column(String(120), nullable=False)
    email      = Column(String(255), nullable=False)
    role       = Column(SAEnum(UserRole, name="user_role"), nullable=False, default=UserRole.student)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    assignments = relationship("Assignment", back_populates="student", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email} role={self.role}>"


class Assignment(Base):
    """A student submission awaiting or having received evaluation."""

    __tablename__ = "assignments"

    id            = Column(String(36), primary_key=True, default=_uuid)
    student_id    = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title         = Column(String(255), nullable=False)
    original_text = Column(Text, nullable=True)
    file_path     = Column(String(512), nullable=True)
    status        = Column(
        SAEnum(AssignmentStatus, name="assignment_status"),
        nullable=False,
        default=AssignmentStatus.pending,
    )
    created_at    = Column(DateTime(timezone=True), nullable=False, default=_now)

    student    = relationship("User", back_populates="assignments")
    evaluation = relationship("Evaluation", back_populates="assignment", uselist=False)

    def __repr__(self) -> str:
        return f"<Assignment id={self.id} title={self.title!r} status={self.status}>"


class Evaluation(Base):
    """
    BTEC grading result. One-to-one with Assignment.

    `criteria` stores the per-criterion JSON blob:
        { "P1": {"achieved": true, "feedback": "..."}, ... }
    """

    __tablename__ = "evaluations"

    id            = Column(String(36), primary_key=True, default=_uuid)
    assignment_id = Column(
        String(36),
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # student_id is denormalised here so queries don't always need a join.
    student_id    = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title         = Column(String(255), nullable=False, default="")
    original_text = Column(Text, nullable=True)
    status        = Column(String(32), nullable=False, default="evaluated")
    final_grade   = Column(
        SAEnum(FinalGrade, name="final_grade_enum"),
        nullable=False,
    )
    # JSONB on Postgres; plain JSON on SQLite (for local dev without Docker)
    criteria        = Column(JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=dict)
    feedback_summary = Column(Text, nullable=False, default="")
    created_at      = Column(DateTime(timezone=True), nullable=False, default=_now)

    assignment = relationship("Assignment", back_populates="evaluation")

    def __repr__(self) -> str:
        return f"<Evaluation id={self.id} grade={self.final_grade}>"
