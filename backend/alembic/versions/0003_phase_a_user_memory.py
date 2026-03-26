# -*- coding: utf-8 -*-
"""Phase A: user auth columns, admin role, user_memory table.

Revision ID: 0003_phase_a
Revises: 0002
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003_phase_a"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")

    # Extend role enum (Postgres) — ignore if value already exists
    op.execute(
        """
        DO $$ BEGIN
            ALTER TYPE user_role ADD VALUE 'admin';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
        """
    )

    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL"
    )

    op.create_table(
        "user_memory",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("memory_type", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_index("ix_user_memory_user_id", "user_memory", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_memory_user_id", table_name="user_memory")
    op.drop_table("user_memory")
    op.drop_column("users", "is_active")
    op.drop_column("users", "hashed_password")
