# -*- coding: utf-8 -*-
"""Cast legacy VARCHAR(36) user/assignment keys to UUID (matches SQLAlchemy models).

Old 0001 used String(36) for ids; downstream migrations FK to UUID. This revision
runs after 0001_initial on databases created with the old VARCHAR schema.

Fresh installs: users.id is already uuid — this revision no-ops.

Revision ID: 0001b_convert_legacy_uuids
Revises: 0001_initial
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001b_convert_legacy_uuids"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    r = conn.execute(
        sa.text(
            """
            SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
            """
        ),
    ).first()
    if not r or r[0] != "character varying":
        return

    op.execute("ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_student_id_fkey")
    op.execute("ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_assignment_id_fkey")
    op.execute("ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_student_id_fkey")

    op.execute("ALTER TABLE users ALTER COLUMN id TYPE uuid USING id::uuid")
    op.execute("ALTER TABLE assignments ALTER COLUMN id TYPE uuid USING id::uuid")
    op.execute("ALTER TABLE assignments ALTER COLUMN student_id TYPE uuid USING student_id::uuid")
    op.execute("ALTER TABLE evaluations ALTER COLUMN id TYPE uuid USING id::uuid")
    op.execute("ALTER TABLE evaluations ALTER COLUMN assignment_id TYPE uuid USING assignment_id::uuid")
    op.execute(
        "ALTER TABLE evaluations ALTER COLUMN student_id TYPE uuid USING student_id::uuid"
    )

    op.execute(
        """
        ALTER TABLE evaluations
          ADD CONSTRAINT evaluations_assignment_id_fkey
          FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE;
        ALTER TABLE evaluations
          ADD CONSTRAINT evaluations_student_id_fkey
          FOREIGN KEY (student_id) REFERENCES users (id) ON DELETE SET NULL;
        ALTER TABLE assignments
          ADD CONSTRAINT assignments_student_id_fkey
          FOREIGN KEY (student_id) REFERENCES users (id) ON DELETE CASCADE;
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Legacy UUID downgrade not supported")

