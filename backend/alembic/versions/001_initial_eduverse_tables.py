# -*- coding: utf-8 -*-
"""Initial EDUVERSE tables — users, assignments, evaluations

Revision ID: 001
Revises:
Create Date: 2025-03-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('role', sa.Enum('student', 'teacher', name='userrole'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    op.create_table(
        'assignments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(512), nullable=False),
        sa.Column('original_text', sa.Text(), nullable=True),
        sa.Column('file_path', sa.String(1024), nullable=True),
        sa.Column('status', sa.Enum('pending', 'evaluated', name='assignmentstatus'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'evaluations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assignment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('final_grade', sa.Enum('P', 'M', 'D', 'R', name='gradeenum'), nullable=False),
        sa.Column('criteria', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('feedback_summary', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('assignment_id')
    )


def downgrade() -> None:
    op.drop_table('evaluations')
    op.drop_table('assignments')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.execute('DROP TYPE IF EXISTS gradeenum')
    op.execute('DROP TYPE IF EXISTS assignmentstatus')
    op.execute('DROP TYPE IF EXISTS userrole')
