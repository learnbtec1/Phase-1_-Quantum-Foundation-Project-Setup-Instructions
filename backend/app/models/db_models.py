# -*- coding: utf-8 -*-
"""
SQLAlchemy models for NEXUS — users, assignments, evaluations
"""

from __future__ import annotations
import uuid
import enum
from datetime import datetime
from sqlalchemy import Boolean, Column, Float, Integer, Numeric, String, Text, DateTime, Date, ForeignKey, Enum, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin = "admin"


class AssignmentStatus(str, enum.Enum):
    pending = "pending"
    evaluated = "evaluated"


class GradeEnum(str, enum.Enum):
    P = "P"
    M = "M"
    D = "D"
    R = "R"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    role = Column(
        Enum(UserRole, name="user_role", values_callable=lambda obj: [e.value for e in obj]),
        default=UserRole.student,
    )
    hashed_password = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Phase C — commercial / compliance
    subscription_plan = Column(String(32), nullable=True, default="free")  # free | premium | school
    model_tier = Column(String(32), nullable=True, default="standard")  # standard | premium (LLM routing)
    parent_email = Column(String(255), nullable=True)
    consent_given_at = Column(DateTime, nullable=True)
    terms_accepted_at = Column(DateTime, nullable=True)
    # V28 — do not disturb: suppress proactive / welcome ice-breakers
    dnd_mode = Column(Boolean, nullable=False, default=False)

    memories = relationship("UserMemory", back_populates="user", cascade="all, delete-orphan")


class UserMemory(Base):
    """Persistent snapshots per user (emotional log, lesson plan, goal)."""

    __tablename__ = "user_memory"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    memory_type = Column(String(64), nullable=False)  # emotional | lesson_plan | goal
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="memories")


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String(512), nullable=False)
    original_text = Column(Text, nullable=True)
    file_path = Column(String(1024), nullable=True)
    status = Column(Enum(AssignmentStatus), default=AssignmentStatus.pending)
    created_at = Column(DateTime, default=datetime.utcnow)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id = Column(UUID(as_uuid=True), ForeignKey("assignments.id"), unique=True, nullable=False)
    final_grade = Column(Enum(GradeEnum), nullable=False)
    criteria = Column(JSONB, nullable=False, default=dict)
    feedback_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── Phase B — Curriculum CMS (LMS) ───────────────────────────────────────────


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    grade_level = Column(String(64), nullable=True)

    topics = relationship("Topic", back_populates="subject", cascade="all, delete-orphan")


class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(512), nullable=False)
    order_index = Column(Integer, default=0)

    subject = relationship("Subject", back_populates="topics")
    lessons = relationship("Lesson", back_populates="topic", cascade="all, delete-orphan")


class Lesson(Base):
    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(512), nullable=False)
    content = Column(Text, nullable=True)
    learning_objectives = Column(Text, nullable=True)
    estimated_duration_min = Column(Integer, nullable=True)

    topic = relationship("Topic", back_populates="lessons")
    questions = relationship("Question", back_populates="lesson", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    type = Column(String(32), nullable=False)  # mcq | short_answer | essay
    correct_answer = Column(Text, nullable=True)
    options = Column(JSONB, nullable=True)
    rubric = Column(Text, nullable=True)
    difficulty = Column(Float, nullable=True, default=0.5)

    lesson = relationship("Lesson", back_populates="questions")


class Answer(Base):
    __tablename__ = "answers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    graded_at = Column(DateTime, nullable=True)
    score = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)

    question = relationship("Question")


class UserTopicMastery(Base):
    __tablename__ = "user_topic_mastery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    topic_id = Column(Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False)
    mastered = Column(Boolean, nullable=False, default=False)
    score = Column(Float, nullable=True, default=0.0)
    questions_attempted = Column(Integer, nullable=False, default=0)
    questions_correct = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "topic_id", name="uq_user_topic_mastery"),)


class LessonAssignment(Base):
    """Teacher assigns a structured lesson to a student (distinct from BTEC file `assignments`)."""

    __tablename__ = "lesson_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    lesson_id = Column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


# ── Phase C — usage, audit, invites ─────────────────────────────────────────


class UsageLog(Base):
    __tablename__ = "usage_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    service = Column(String(32), nullable=False)  # openai | azure_tts
    tokens_used = Column(Integer, nullable=True)
    cost = Column(Numeric(12, 6), nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(128), nullable=False)
    resource = Column(String(512), nullable=True)
    ip_address = Column(String(64), nullable=True)
    request_id = Column(String(64), nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role_hint = Column(String(32), nullable=True)
    uses_remaining = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    consent_type = Column(String(64), nullable=False)
    accepted_at = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(64), nullable=True)
    meta = Column(JSONB, nullable=True)


# ── V28 Digital Human layers ─────────────────────────────────────────────────


class UserContextRow(Base):
    """Device / timezone / locale snapshot for tutor personalization."""

    __tablename__ = "user_context"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    device_type = Column(String(32), nullable=True)  # mobile | tablet | desktop
    timezone = Column(String(128), nullable=True)
    country_code = Column(String(8), nullable=True)
    locale_hint = Column(String(64), nullable=True)
    prefs = Column(JSONB, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class StudentPersonaPreference(Base):
    __tablename__ = "student_persona_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    trait = Column(String(64), nullable=False)
    value = Column(Float, nullable=False, default=0.5)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "trait", name="uq_student_persona_user_trait"),)


class StudentTimeline(Base):
    __tablename__ = "student_timeline"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    day_date = Column(Date, nullable=False)
    summary = Column(Text, nullable=True)
    mastery_changes = Column(JSONB, nullable=True)
    topics_covered = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "day_date", name="uq_timeline_user_day"),)


class TrainingData(Base):
    __tablename__ = "training_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    prompt = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    score = Column(Float, nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TutorialProgress(Base):
    """Persistent BTEC tutorial / scaffolding position per user and unit (V44)."""

    __tablename__ = "tutorial_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(String(64), nullable=False)
    current_criterion = Column(String(64), nullable=False, default="A.P1")
    last_mini_check_question = Column(Text, nullable=True)
    last_mini_check_attempts = Column(Integer, nullable=False, default=0)
    completed_criteria = Column(JSONB, nullable=False, default=lambda: [])
    expects_mini_answer = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "unit_id", name="uq_tutorial_progress_user_unit"),)
