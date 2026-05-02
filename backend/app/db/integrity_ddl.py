# -*- coding: utf-8 -*-
"""DDL for integrity: teacher feedback, training rows, optional learned weight rows."""

from __future__ import annotations

INTEGRITY_DDL: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS integrity_teacher_feedback (
        id                 BIGSERIAL PRIMARY KEY,
        user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_id         TEXT,
        feedback_text      TEXT        NOT NULL DEFAULT '',
        action_taken       TEXT,
        teacher_label      TEXT,
        integrity_snapshot JSONB,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS itf_user_id_idx ON integrity_teacher_feedback(user_id);",
    "CREATE INDEX IF NOT EXISTS itf_created_idx ON integrity_teacher_feedback(created_at DESC);",
    """
    CREATE TABLE IF NOT EXISTS integrity_training_sample (
        id                  BIGSERIAL PRIMARY KEY,
        semantic            REAL        NOT NULL,
        ngram               REAL        NOT NULL,
        ai_signal           REAL        NOT NULL,
        citation            REAL        NOT NULL,
        behavioral          REAL        NOT NULL,
        target_score        REAL        NOT NULL,
        source_feedback_id  BIGINT      REFERENCES integrity_teacher_feedback(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS its_target_idx ON integrity_training_sample(created_at DESC);",
    """
    CREATE TABLE IF NOT EXISTS integrity_weight_config (
        id            SERIAL PRIMARY KEY,
        version       TEXT         NOT NULL,
        w_semantic    REAL         NOT NULL,
        w_ngram       REAL         NOT NULL,
        w_ai          REAL         NOT NULL,
        w_citation    REAL         NOT NULL,
        w_behavioral  REAL         NOT NULL,
        n_samples     INT          NOT NULL DEFAULT 0,
        is_active     BOOLEAN      NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS iwc_active_idx ON integrity_weight_config(is_active) WHERE is_active = true;",
)
