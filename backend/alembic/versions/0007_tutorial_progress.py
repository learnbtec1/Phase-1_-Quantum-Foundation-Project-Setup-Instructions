# -*- coding: utf-8 -*-
"""Tutorial progress persistence (BTEC scaffolding state per user + unit).

Revision ID: 0007_tutorial_progress
Revises: 0006_digital_human
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0007_tutorial_progress"
down_revision = "0006_digital_human"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tutorial_progress",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("current_criterion", sa.String(64), nullable=False, server_default="A.P1"),
        sa.Column("last_mini_check_question", sa.Text(), nullable=True),
        sa.Column("last_mini_check_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "completed_criteria",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("expects_mini_answer", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "unit_id", name="uq_tutorial_progress_user_unit"),
    )


def downgrade() -> None:
    op.drop_table("tutorial_progress")
