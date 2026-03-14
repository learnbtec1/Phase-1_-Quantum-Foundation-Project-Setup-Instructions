# -*- coding: utf-8 -*-
"""
0002_add_conversations_table.py — Alembic migration.

Adds the `conversations` table used by ConversationRepository.

Schema:
  conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL UNIQUE,    ← unique for ON CONFLICT upsert
    started_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at    TIMESTAMP WITH TIME ZONE,
    summary     TEXT,
    exchanges   JSONB NOT NULL DEFAULT '[]'
  )

Revision chain: 0001_initial_schema → 0002_add_conversations_table
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# ── Alembic identity ──────────────────────────────────────────────────────────
revision = "0002"
down_revision = "0001"   # set to the actual revision id of your 0001 migration
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")  # needed for gen_random_uuid()

    op.create_table(
        "conversations",
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
            nullable=True,
        ),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "ended_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "summary",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "exchanges",
            JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )

    # Unique constraint on session_id enables the ON CONFLICT upsert in PostgresConversationRepository
    op.create_unique_constraint(
        "uq_conversations_session_id",
        "conversations",
        ["session_id"],
    )

    # Index for fast user-history queries
    op.create_index(
        "ix_conversations_user_id_started",
        "conversations",
        ["user_id", sa.text("started_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_conversations_user_id_started", table_name="conversations")
    op.drop_constraint("uq_conversations_session_id", "conversations", type_="unique")
    op.drop_table("conversations")
