# -*- coding: utf-8 -*-
"""Phase C: usage_log, audit_log, invite_codes, consent_records; user commercial columns.

Revision ID: 0005_phase_c
Revises: 0004_phase_b
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0005_phase_c"
down_revision = "0004_phase_b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(32) DEFAULT 'free'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS model_tier VARCHAR(32) DEFAULT 'standard'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email VARCHAR(255)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE")

    op.create_table(
        "usage_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("service", sa.String(32), nullable=False),
        sa.Column("tokens_used", sa.Integer(), nullable=True),
        sa.Column("cost", sa.Numeric(12, 6), nullable=True),
        sa.Column("meta", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_usage_log_user_id", "usage_log", ["user_id"])
    op.create_index("ix_usage_log_created_at", "usage_log", ["created_at"])

    op.create_table(
        "audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("resource", sa.String(512), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("details", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_audit_log_actor_id", "audit_log", ["actor_id"])

    op.create_table(
        "invite_codes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(64), unique=True, nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("role_hint", sa.String(32), nullable=True),
        sa.Column("uses_remaining", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )

    op.create_table(
        "consent_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("consent_type", sa.String(64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("meta", JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index("ix_consent_records_user_id", "consent_records", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_consent_records_user_id", table_name="consent_records")
    op.drop_table("consent_records")
    op.drop_table("invite_codes")
    op.drop_index("ix_audit_log_actor_id", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_usage_log_created_at", table_name="usage_log")
    op.drop_index("ix_usage_log_user_id", table_name="usage_log")
    op.drop_table("usage_log")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS consent_given_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS parent_email")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS model_tier")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS subscription_plan")
