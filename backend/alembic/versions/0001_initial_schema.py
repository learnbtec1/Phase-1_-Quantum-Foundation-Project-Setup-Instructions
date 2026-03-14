"""Initial schema — users, assignments, evaluations

Revision ID: 0001_initial
Revises: (none)
Create Date: 2026-03-14 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision     = "0001_initial"
down_revision = None
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id",         sa.String(36),   nullable=False),
        sa.Column("name",       sa.String(120),  nullable=False),
        sa.Column("email",      sa.String(255),  nullable=False),
        sa.Column("role",       sa.Enum("student", "teacher", name="user_role"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    # ── assignments ───────────────────────────────────────────────────────────
    op.create_table(
        "assignments",
        sa.Column("id",            sa.String(36),  nullable=False),
        sa.Column("student_id",    sa.String(36),  nullable=False),
        sa.Column("title",         sa.String(255), nullable=False),
        sa.Column("original_text", sa.Text(),      nullable=True),
        sa.Column("file_path",     sa.String(512), nullable=True),
        sa.Column("status",        sa.Enum("pending", "evaluated", name="assignment_status"), nullable=False),
        sa.Column("created_at",    sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── evaluations ───────────────────────────────────────────────────────────
    op.create_table(
        "evaluations",
        sa.Column("id",               sa.String(36),  nullable=False),
        sa.Column("assignment_id",    sa.String(36),  nullable=False),
        sa.Column("student_id",       sa.String(36),  nullable=True),
        sa.Column("title",            sa.String(255), nullable=False, server_default=""),
        sa.Column("original_text",    sa.Text(),      nullable=True),
        sa.Column("status",           sa.String(32),  nullable=False, server_default="evaluated"),
        sa.Column("final_grade",      sa.Enum("P", "M", "D", "R", name="final_grade_enum"), nullable=False),
        sa.Column(
            "criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("feedback_summary", sa.Text(),      nullable=False, server_default=""),
        sa.Column("created_at",       sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"],    ["users.id"],       ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assignment_id", name="uq_evaluations_assignment_id"),
    )


def downgrade() -> None:
    op.drop_table("evaluations")
    op.drop_table("assignments")
    op.drop_table("users")
    # Drop enums (Postgres only)
    op.execute("DROP TYPE IF EXISTS final_grade_enum")
    op.execute("DROP TYPE IF EXISTS assignment_status")
    op.execute("DROP TYPE IF EXISTS user_role")
