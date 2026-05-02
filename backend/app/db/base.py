# -*- coding: utf-8 -*-
"""
Shared database constants and DDL helpers for the relational core (users, documents).
Embedding store DDL lives in `app.services.vector_service` (pgvector, vector(1536)).
"""
from __future__ import annotations

# Must match `text-embedding-3-small` with dimensions=1536
EMBEDDING_DIMENSION: int = 1536

USERS_AND_DOCUMENTS_DDL: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id            BIGSERIAL PRIMARY KEY,
        email         TEXT        NOT NULL UNIQUE,
        password_hash TEXT        NOT NULL,
        is_active     BOOLEAN     NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS documents (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
        title      TEXT,
        file_path  TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);",
    # --- Auth, billing, services (additive migrations) ---
    """
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';
    """,
    """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'users' AND c.conname = 'users_role_check'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_role_check
          CHECK (role IN ('student', 'teacher', 'admin'));
      END IF;
    END$$;
    """,
    """
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free';
    """,
    """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'users' AND c.conname = 'users_subscription_plan_check'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_subscription_plan_check
          CHECK (subscription_plan IN ('free', 'basic', 'advanced', 'pro'));
      END IF;
    END$$;
    """,
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;""",
    """CREATE INDEX IF NOT EXISTS users_stripe_customer_id_idx ON users(stripe_customer_id);""",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;""",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;""",
    """
    CREATE TABLE IF NOT EXISTS password_resets (
        id           BIGSERIAL PRIMARY KEY,
        user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   TEXT        NOT NULL,
        expires_at   TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets(token_hash);",
    "CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets(user_id);",
    """
    CREATE TABLE IF NOT EXISTS invoices (
        id                        BIGSERIAL PRIMARY KEY,
        user_id                   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_cents              INTEGER     NOT NULL,
        currency                  TEXT        NOT NULL DEFAULT 'usd',
        status                    TEXT        NOT NULL,
        stripe_checkout_session_id TEXT,
        stripe_invoice_id         TEXT,
        stripe_payment_intent_id  TEXT,
        plan_key                  TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS invoices_user_id_idx ON invoices(user_id);",
    "CREATE INDEX IF NOT EXISTS invoices_stripe_checkout_idx ON invoices(stripe_checkout_session_id);",
    """
    CREATE TABLE IF NOT EXISTS service_catalog (
        id           BIGSERIAL PRIMARY KEY,
        service_key  TEXT        NOT NULL UNIQUE,
        display_name TEXT        NOT NULL,
        min_plan     TEXT        NOT NULL DEFAULT 'free',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    """
    INSERT INTO service_catalog (service_key, display_name, min_plan) VALUES
        ('plagiarism_check', 'Plagiarism & similarity (RAG)', 'free'),
        ('assessment_btec', 'BTEC-style assessment (RAG)', 'free'),
        ('priority_grading', 'Priority grading queue', 'basic'),
        ('advanced_insights', 'Advanced performance insights', 'advanced'),
        ('api_integrations', 'API & bulk exports', 'pro')
    ON CONFLICT (service_key) DO NOTHING;
    """,
    # Monthly usage (assessment + plagiarism) — one row per user per calendar month (UTC)
    """
    CREATE TABLE IF NOT EXISTS usage_stats (
        id                BIGSERIAL PRIMARY KEY,
        user_id           TEXT         NOT NULL,
        period_start      TIMESTAMPTZ  NOT NULL,
        period_end        TIMESTAMPTZ  NOT NULL,
        assessments_used  INTEGER      NOT NULL DEFAULT 0,
        plagiarism_used   INTEGER      NOT NULL DEFAULT 0,
        total_requests    INTEGER      NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT usage_stats_user_period_ux UNIQUE (user_id, period_start)
    );
    """,
    "CREATE INDEX IF NOT EXISTS usage_stats_user_id_idx ON usage_stats (user_id);",
    "CREATE INDEX IF NOT EXISTS usage_stats_period_start_idx ON usage_stats (period_start);",
    # Event-level usage (append-only) for accurate daily analytics; usage_stats remains quota source of truth
    """
    CREATE TABLE IF NOT EXISTS usage_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type  TEXT         NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT usage_events_type_check
          CHECK (event_type IN ('assessment', 'plagiarism'))
    );
    """,
    "CREATE INDEX IF NOT EXISTS usage_events_user_id_idx ON usage_events (user_id);",
    "CREATE INDEX IF NOT EXISTS usage_events_created_at_idx ON usage_events (created_at);",
    "CREATE INDEX IF NOT EXISTS usage_events_type_created_idx ON usage_events (event_type, created_at);",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;""",
    "CREATE INDEX IF NOT EXISTS users_stripe_subscription_id_idx ON users(stripe_subscription_id);",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_status TEXT;""",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_period_end TIMESTAMPTZ;""",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_cancel_at_end BOOLEAN NOT NULL DEFAULT false;""",
    # Allow "unlimited" plan (Stripe subscriptions)
    r"""
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'users' AND c.conname = 'users_subscription_plan_check'
      ) THEN
        ALTER TABLE users DROP CONSTRAINT users_subscription_plan_check;
      END IF;
      ALTER TABLE users
        ADD CONSTRAINT users_subscription_plan_check
        CHECK (subscription_plan IN ('free', 'basic', 'advanced', 'pro', 'unlimited'));
    END$$;
    """,
    # Email verification (raw token is never stored; only SHA-256 of secrets.token_urlsafe(32) bytes)
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;""",
    """ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;""",
    "CREATE INDEX IF NOT EXISTS users_verification_token_hash_idx ON users(verification_token_hash) WHERE verification_token_hash IS NOT NULL;",
    # Legacy rows: backfill and enforce NOT NULL; new signups get is_verified false in application INSERT
    """
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN;
    """,
    """UPDATE users SET is_verified = true WHERE is_verified IS NULL;""",
    """ALTER TABLE users ALTER COLUMN is_verified SET NOT NULL;""",
    """ALTER TABLE users ALTER COLUMN is_verified SET DEFAULT false;""",
)
