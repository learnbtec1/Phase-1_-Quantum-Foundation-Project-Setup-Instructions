# -*- coding: utf-8 -*-
"""V28 Digital Human: persona prefs, timeline, training data, user context, DND.

Revision ID: 0006_digital_human
Revises: 0005_phase_c
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0006_digital_human"
down_revision = "0005_phase_c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_mode BOOLEAN DEFAULT FALSE NOT NULL")

    op.create_table(
        "user_context",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("device_type", sa.String(32), nullable=True),
        sa.Column("timezone", sa.String(128), nullable=True),
        sa.Column("country_code", sa.String(8), nullable=True),
        sa.Column("locale_hint", sa.String(64), nullable=True),
        sa.Column("prefs", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )

    op.create_table(
        "student_persona_preferences",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trait", sa.String(64), nullable=False),
        sa.Column("value", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("user_id", "trait", name="uq_student_persona_user_trait"),
    )
    op.create_index("ix_student_persona_user", "student_persona_preferences", ["user_id"])

    op.create_table(
        "student_timeline",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_date", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("mastery_changes", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("topics_covered", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("user_id", "day_date", name="uq_timeline_user_day"),
    )
    op.create_index("ix_student_timeline_user_day", "student_timeline", ["user_id", "day_date"])

    op.create_table(
        "training_data",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("response", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("meta", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_training_data_user", "training_data", ["user_id"])
    op.create_index("ix_training_data_created", "training_data", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_training_data_created", table_name="training_data")
    op.drop_index("ix_training_data_user", table_name="training_data")
    op.drop_table("training_data")
    op.drop_index("ix_student_timeline_user_day", table_name="student_timeline")
    op.drop_table("student_timeline")
    op.drop_index("ix_student_persona_user", table_name="student_persona_preferences")
    op.drop_table("student_persona_preferences")
    op.drop_table("user_context")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS dnd_mode")
