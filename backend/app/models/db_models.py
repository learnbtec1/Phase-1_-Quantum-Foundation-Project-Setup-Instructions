# -*- coding: utf-8 -*-
"""
SQLAlchemy models for NEXUS — users, assignments, evaluations
"""

from __future__ import annotations
import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"


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
    role = Column(Enum(UserRole), default=UserRole.student)
    created_at = Column(DateTime, default=datetime.utcnow)


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
