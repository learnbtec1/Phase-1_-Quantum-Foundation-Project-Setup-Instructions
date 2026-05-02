# -*- coding: utf-8 -*-
"""Application settings — text/RAG/assessment only; no TTS, avatars, or 3D."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Final, List, Optional, Union

from dotenv import load_dotenv
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_backend_dir = Path(__file__).resolve().parent.parent.parent
_repo_root = _backend_dir.parent
for _env in (_repo_root / ".env", _backend_dir / ".env"):
    if _env.is_file():
        load_dotenv(_env, override=True)
load_dotenv()

# OpenAI id defaults: single import path for string fallbacks (use Field() + resolved_* on settings).
_OPENAI_DEFAULT_EMBEDDING: Final[str] = "text-embedding-3-small"
_OPENAI_DEFAULT_CHAT: Final[str] = "gpt-4o"
_OPENAI_DEFAULT_MINI: Final[str] = "gpt-4o-mini"


class Settings(BaseSettings):
    API_V1_STR: str = Field("/api/v1", description="All versioned JSON APIs live under this path.")

    BACKEND_CORS_ORIGINS: Union[List[str], str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ],
    )

    DATABASE_URL: str = Field("postgresql://eduvor:eduvor_dev_change_me@localhost:5432/eduvor_core")

    OPENAI_API_KEY: str = Field("")

    # Google AI (optional): assignment-brief P/M/D ladder via Gemini
    GOOGLE_API_KEY: str = Field(
        "",
        description="Generative Language API key (AI Studio) for BTEC brief decoder.",
    )
    GEMINI_ASSIGNMENT_BRIEF_MODEL: str = Field(
        "gemini-2.0-flash",
        validation_alias=AliasChoices(
            "GEMINI_ASSIGNMENT_BRIEF_MODEL",
            "GEMINI_BRIEF_MODEL",
            "GOOGLE_GEMINI_MODEL",
        ),
        description="Model id for /assessment/analyze-assignment-brief (e.g. gemini-2.0-flash, gemini-1.5-pro).",
    )
    GEMINI_API_KEY: str = Field(
        "",
        validation_alias=AliasChoices("GEMINI_API_KEY"),
        description="Optional; Ultra Tutor uses this or GOOGLE_API_KEY.",
    )
    GEMINI_ULTRA_MODEL: str = Field(
        "gemini-1.5-pro",
        validation_alias=AliasChoices("GEMINI_ULTRA_MODEL", "ULTRA_TUTOR_GEMINI_MODEL"),
        description="Model for POST /ultra/session (Socratic tutor).",
    )

    OPENAI_EMBEDDING_MODEL: str = Field(
        _OPENAI_DEFAULT_EMBEDDING,
        validation_alias=AliasChoices("OPENAI_EMBEDDING_MODEL", "EMBEDDING_MODEL"),
    )
    OPENAI_CHAT_MODEL: str = Field(
        _OPENAI_DEFAULT_CHAT,
        validation_alias=AliasChoices("OPENAI_CHAT_MODEL", "GRADER_MODEL", "TUTOR_MODEL"),
    )
    OPENAI_ASSESSMENT_MODEL: str = Field(
        _OPENAI_DEFAULT_MINI,
        validation_alias=AliasChoices(
            "OPENAI_ASSESSMENT_MODEL",
            "TUTOR_MODEL_FREE",
        ),
    )

    EMBEDDING_DIMENSIONS: int = Field(1536)
    OPENAI_EMBED_TIMEOUT_SECONDS: float = Field(
        8.0,
        ge=0.5,
        le=120.0,
        description="Hard cap on each OpenAI embeddings.create call (ThreadPool timeout).",
    )
    VECTOR_INGEST_MAX_CHARS: int = Field(25_000)
    VECTOR_CHUNK_CHARS: int = Field(1500)
    VECTOR_CHUNK_OVERLAP: int = Field(200)

    ASSESSMENT_RETRIEVAL_TOP_K: int = Field(8)
    ASSESSMENT_MAX_CONTEXT_CHARS: int = Field(12_000)
    # Multi-step pipeline: chunking + per-chunk calls (safety cap)
    ASSESSMENT_PIPELINE_MAX_CHUNKS: int = Field(50)
    ASSESSMENT_MIN_WORDS: int = Field(150, description="Min words to run RAG or pipeline grading.")
    # RAG / grader cost control (default keeps fairness: full student text; trims reference excerpts only).
    ASSESSMENT_GRADER_SPLIT_ENABLED: bool = Field(
        False,
        description="If true: eligible requests may use the split grader (see ROLLOUT_PERCENT).",
    )
    ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT: int = Field(
        10,
        ge=0,
        le=100,
        description="When SPLIT_ENABLED, 0-100; sticky bucket 0-99 < this → split path. 100 = always, 0 = never.",
    )
    ASSESSMENT_GRADER_FORCE_SINGLE_MODE: bool = Field(
        False,
        description="If true: always single-stage (overrides split rollout and FORCE_SPLIT).",
    )
    ASSESSMENT_GRADER_FORCE_SPLIT_MODE: bool = Field(
        False,
        description="If true: always try split (unless FORCE_SINGLE), even if SPLIT_ENABLED is false.",
    )
    ASSESSMENT_AB_TRACKING_ENABLED: bool = Field(
        False,
        description="If true: eligible split responses may run async shadow single for A/B (see MAX_SHADOW_*).",
    )
    ASSESSMENT_AB_MAX_SHADOW_PERCENT: int = Field(
        5,
        ge=0,
        le=100,
        description="Subsample: only this % of split+tracking requests actually run shadow (0 = none).",
    )
    ASSESSMENT_AB_SHADOW_MAX_PER_MINUTE: int = Field(
        30,
        ge=0,
        le=5_000,
        description="Max shadow grader calls per process per minute (0 = no cap by counter).",
    )
    ASSESSMENT_AB_STORE_PATH: str = Field(
        "data/grader_ab_store.json",
        description="Path under backend/ or absolute: persisted A/B ring buffer.",
    )
    ASSESSMENT_AB_STORE_MAX_SAMPLES: int = Field(
        1000,
        ge=200,
        le=10_000,
        description="Max persisted A/B sample rows (rotation by tail keep).",
    )
    ASSESSMENT_AB_READINESS_MIN_SAMPLES: int = Field(
        0,
        ge=0,
        le=1_000_000,
        description="Min samples for readiness; 0 = use ASSESSMENT_AB_MIN_SAMPLES_FOR_RECOMMENDATION.",
    )
    ASSESSMENT_AB_MIN_SAMPLES_FOR_RECOMMENDATION: int = Field(
        20,
        ge=5,
        le=10_000,
        description="Min rolling A/B samples before emitting recommendation log.",
    )
    ASSESSMENT_AB_MAX_MISMATCH_PCT: float = Field(
        5.0,
        ge=0.0,
        le=100.0,
        description="If rolling mismatch rate exceeds this, log caution about rollout.",
    )
    ASSESSMENT_AB_USE_REDIS: bool = Field(
        True,
        description="If true: use Redis (when URL set) for distributed A/B counters; if false, JSON file only.",
    )
    ASSESSMENT_AB_MIGRATE_JSON_TO_REDIS: bool = Field(
        True,
        description="If true: on startup path, if Redis A/B hash empty but JSON has rows, HSET once then set migrated flag (idempotent).",
    )
    ASSESSMENT_RAG_REF_CONTEXT_FRACTION: float = Field(
        0.62,
        ge=0.35,
        le=1.0,
        description="Fraction of ASSESSMENT_MAX_CONTEXT_CHARS for retrieved reference text (reduces ref tokens, not student work).",
    )
    ASSESSMENT_RAG_REF_PER_BLOCK_MAX_CHARS: int = Field(
        3200,
        ge=500,
        le=50_000,
        description="Per-source cap on each reference block before the global RAG cap.",
    )
    ASSESSMENT_PASS0_DISK_TTL_SECONDS: int = Field(
        3600,
        ge=60,
        le=7 * 24 * 3600,
        description="Max age of PASS0 entries in pass0_spec.sqlite; older rows ignored.",
    )
    ASSESSMENT_QUERY_EMBED_CACHE_TTL_SECONDS: float = Field(
        3600.0,
        ge=60.0,
        le=86400.0,
        description="TTL for in-process query embedding cache (vector search).",
    )
    ASSESSMENT_QUERY_EMBED_CACHE_MAX_ENTRIES: int = Field(
        500,
        ge=10,
        le=10_000,
        description="Max entries in query embedding LRU.",
    )
    # Same inputs → replay stored per-criterion result (audit determinism); in-process only.
    ASSESSMENT_EVAL_CACHE_ENABLED: bool = Field(True)
    ASSESSMENT_EVAL_CACHE_MAX_ENTRIES: int = Field(2000)
    # L2: distributed cache (e.g. Docker Redis). L1 in-process always used when cache enabled.
    # When set, also used to initialize FastAPILimiter (per-user LLM rate limits). In Docker, set
    # REDIS_URL=redis://redis:6379 (or leave empty: rate limiter falls back in main to localhost:6379).
    ASSESSMENT_REDIS_URL: str = Field(
        "",
        validation_alias=AliasChoices("ASSESSMENT_REDIS_URL", "REDIS_URL", "RATE_LIMIT_REDIS_URL"),
        description="Optional redis:// for shared assessment cache and LLM rate limiting.",
    )
    ASSESSMENT_REDIS_TTL_SECONDS: int = Field(604_800)  # 7 days
    ASSESSMENT_REDIS_KEY_PREFIX: str = Field("eduvor:assessment")
    ASSESSMENT_REDIS_SOCKET_TIMEOUT: float = Field(
        2.0,
        ge=0.5,
        le=30.0,
        description="Redis read/write timeout (s) for optional services (A/B, cache client usage).",
    )
    # Auto split-grader rollout (A/B-gated; state in Redis/JSON; does not touch grading prompts).
    AUTO_ROLLOUT_ENABLED: bool = Field(
        False,
        description="If true: may adjust effective split rollout from stored state; never overrides FORCE_SINGLE/SPLIT in step()",
    )
    AUTO_ROLLOUT_MIN_SAMPLES: int = Field(50, ge=0, le=10_000_000)
    AUTO_ROLLOUT_MAX_ROLLOUT_PERCENT: int = Field(80, ge=0, le=99, description="Auto engine never sets rollout above this (never 100).")
    AUTO_ROLLOUT_STEP_UP: int = Field(10, ge=0, le=100)
    AUTO_ROLLOUT_STEP_DOWN: int = Field(10, ge=0, le=100)
    AUTO_ROLLOUT_COOLDOWN_SECONDS: int = Field(600, ge=0, le=864_000)
    AUTO_ROLLOUT_MAX_MISMATCH_PCT: float = Field(
        5.0,
        ge=0.0,
        le=100.0,
        description="If rolling mismatch % exceeds this, prefer DECREASE (same scale as A/B metrics).",
    )
    AUTO_ROLLOUT_MIN_CONF_DELTA: float = Field(
        -0.02,
        ge=-1.0,
        le=1.0,
        description="signed mean (split - single) confidence; if below and mismatch OK → HOLD (conservative).",
    )
    AUTO_ROLLOUT_STATE_PATH: str = Field(
        "data/auto_rollout_state.json",
        description="When Redis unavailable, persist effective rollout and last run metadata here (under backend/).",
    )

    # Guided rewrite (next-level nudge, style guard) — only when grade_band is Pass or Merit
    STUDENT_REWRITE_ENABLED: bool = Field(True, description="If false, skip second LLM pass for example improvement.")
    FEATURE_ALLOW_AI_REWRITE: bool = Field(
        True,
        description=(
            "Institution/school policy: if false, disable all guided text improvement (standalone API and post-grade example)."
        ),
    )
    STUDENT_REWRITE_MAX_CHARS: int = Field(12_000, description="Max student text chars sent to rewrite model.")
    STUDENT_REWRITE_SIMILARITY_FLOOR: float = Field(
        0.7,
        description="If SequenceMatcher ratio vs original is below this, return original (style guard).",
    )
    OPENAI_REWRITE_MODEL: str = Field(
        _OPENAI_DEFAULT_MINI,
        validation_alias=AliasChoices("OPENAI_REWRITE_MODEL", "STUDENT_REWRITE_MODEL"),
    )
    # Load aggregated teacher style → optional soft hints in guided rewrite (never affects grading)
    TEACHER_MEMORY_ENABLED: bool = Field(True, description="If false, skip loading style priors in rewrite prompt.")
    # Global (all teachers) + per-subject buckets; weight = min(1, count / divisor); only >= min_weight is used
    TEACHER_MEMORY_MIN_WEIGHT: float = Field(0.4, description="Ignore pattern signals below this weight in rewrite prompt.")
    TEACHER_MEMORY_WEIGHT_COUNT_DIVISOR: int = Field(
        20,
        description="weight = min(1.0, count / divisor) for aggregated global/subject memory.",
    )
    # Blend subject vs global when both exist (subject weighted higher; never affects grading)
    TEACHER_MEMORY_BLEND_GLOBAL: float = Field(0.4, description="Part of base weight from __global__ bucket.")
    TEACHER_MEMORY_BLEND_SUBJECT: float = Field(0.6, description="Part of base weight from subject/assignment scope.")
    TEACHER_MEMORY_MAX_PATTERN_WEIGHT: float = Field(
        0.85,
        description="Cap per-pattern weight after blending to reduce single-pattern dominance in rewrite prompt.",
    )
    # Time-based decay: effective_count ≈ count * (per_30d ** (age_days/30)) using row updated_at; 1.0 = off
    TEACHER_MEMORY_TIME_DECAY_PER_30D: float = Field(
        0.98,
        description="Multiply weight by this factor every ~30d since row was updated; set 1.0 to disable.",
    )
    # Reject global learning updates from extreme / off-level teacher edits
    TEACHER_EDIT_MIN_SIMILARITY: float = Field(
        0.5,
        description="Do not use teacher edit to update shared memory if SequenceMatcher text similarity (orig vs final) is below this.",
    )
    # Gentle decay for all global rows when a *quality-passing* edit is stored (1.0 = skip)
    TEACHER_MEMORY_DECAY_ON_VALID_SAVE: float = Field(
        0.9995,
        description="Multiply all global memory frequencies by this on each quality-approved edit; 1.0 disables.",
    )

    JWT_SECRET_KEY: str = Field(
        "change_me",
        validation_alias=AliasChoices("JWT_SECRET_KEY", "JWT_SECRET"),
    )
    JWT_ALGORITHM: str = Field(
        "HS256",
        validation_alias=AliasChoices("JWT_ALGORITHM", "ALGORITHM"),
    )
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(60)
    AUTH_COOKIE_NAME: str = Field(
        "eduvor_token",
        description="HttpOnly session cookie; keep in sync with the Next.js middleware (if any).",
    )
    AUTH_COOKIE_SECURE: bool = Field(
        False,
        description="Set True in production (HTTPS) for Secure flag on the session cookie.",
    )

    # Emergency localhost/dev only — NEVER enable in production. Matches frontend NEXT_PUBLIC_AUTH_DEV_INJECT flow.
    AUTH_DEV_BYPASS: bool = Field(
        False,
        description="If True, AUTH_DEV_STATIC_TOKEN authenticates as AUTH_DEV_STATIC_USER_ID without JWT verification.",
    )
    AUTH_DEV_STATIC_TOKEN: str = Field(
        "",
        description="Opaque shared secret (e.g. test-token-123) accepted when AUTH_DEV_BYPASS is True.",
    )
    AUTH_DEV_STATIC_USER_ID: int = Field(
        1,
        ge=1,
        description="DB user id for AUTH_DEV_STATIC_TOKEN (user must exist and be active/verified).",
    )

    # WebSocket `/ws/agent` — optional aliases for stakeholder demos (matches frontend env names).
    # When True with COGNI_WS_DEV_STATIC_TOKEN (default test-token-123), WS auth accepts that opaque token without JWT.
    COGNI_WS_ALLOW_ANONYMOUS: bool = Field(
        False,
        description="Dev/demo only: accept COGNI_WS_DEV_STATIC_TOKEN on WS auth without JWT verification.",
    )
    COGNI_BFF_DEV_BYPASS_AUTH: bool = Field(
        False,
        description="Alias intent with COGNI_WS_ALLOW_ANONYMOUS — OR'd for WS demo token bypass.",
    )
    COGNI_WS_DEV_STATIC_TOKEN: str = Field(
        "test-token-123",
        description="Opaque token accepted when COGNI_WS_ALLOW_ANONYMOUS or COGNI_BFF_DEV_BYPASS_AUTH is True.",
    )

    ENABLE_REGISTRATION: bool = Field(True)

    # Public site URL (password-reset links, Stripe success/cancel, verify-email redirect)
    FRONTEND_URL: str = Field("http://localhost:3000")
    # Public base URL of this API (verification links in email hit the API, then redirect to FRONTEND_URL)
    BACKEND_PUBLIC_URL: str = Field(
        "http://localhost:8001",
        description="Used to build /api/v1/auth/verify-email?token=... in outbound mail (Mailtrap, production).",
    )

    # --- Mail (Mailtrap sandbox / Resend; fastapi-mail) ---
    # Paste credentials from Mailtrap Inbox → SMTP. Legacy SMTP_* still used for password reset if set.
    MAIL_USERNAME: str = Field("")
    MAIL_PASSWORD: str = Field("")
    MAIL_SERVER: str = Field("sandbox.smtp.mailtrap.io")
    MAIL_PORT: int = Field(2525, ge=1, le=65535)
    MAIL_FROM: str = Field("support@eduversejo.com")
    MAIL_FROM_NAME: str = Field("EduVerse")

    # Stripe (subscriptions + one-time checkout). Leave empty to disable /billing/* checkout.
    STRIPE_SECRET_KEY: str = Field("")
    STRIPE_WEBHOOK_SECRET: str = Field("")
    STRIPE_API_VERSION: str = Field("2023-10-16")
    # Price IDs from Stripe Dashboard (recurring or one-time, per product)
    STRIPE_PRICE_BASIC: str = Field("")
    STRIPE_PRICE_ADVANCED: str = Field("")
    STRIPE_PRICE_PRO: str = Field(
        "",
        validation_alias=AliasChoices("STRIPE_PRICE_PRO", "STRIPE_PRICE_ID_PRO"),
        description="Monthly Pro plan price id (alias: STRIPE_PRICE_ID_PRO).",
    )
    STRIPE_PRICE_ID_UNLIMITED: str = Field(
        "",
        validation_alias=AliasChoices("STRIPE_PRICE_ID_UNLIMITED", "STRIPE_PRICE_UNLIMITED"),
        description="Monthly Unlimited plan price id.",
    )

    # Email verification (hash-only storage; see User.verification_token_hash in DB)
    EMAIL_VERIFICATION_TTL_HOURS: int = Field(48, ge=1, le=14 * 24, description="Signed URL window for /auth/verify-email")
    REQUIRE_EMAIL_VERIFICATION_FOR_LOGIN: bool = Field(
        True,
        description=(
            "If True (default): POST /auth/login rejects unverified accounts (EMAIL_NOT_VERIFIED). "
            "Set False only for staging/recovery when accounts cannot receive mail. Production should stay True."
        ),
    )
    # Password reset (optional SMTP — if unset, reset links are logged at INFO for dev)
    PASSWORD_RESET_TOKEN_TTL_MINUTES: int = Field(60, ge=5, le=7 * 24 * 60)
    SMTP_HOST: str = Field("")
    SMTP_PORT: int = Field(587)
    SMTP_USER: str = Field("")
    SMTP_PASSWORD: str = Field("")
    SMTP_FROM: str = Field("")

    # Sentry (optional; empty = disabled)
    SENTRY_DSN: str = Field("")

    # Postgres logical backups: mount Docker named volume (see docker-compose) at this path
    BACKUP_DIR: str = Field(
        "/backups",
        description="Directory for *.sql pg_dump output (shared with db-backup service).",
    )
    BACKUP_RETAIN_COUNT: int = Field(
        7,
        ge=1,
        le=200,
        description="After each new backup, keep the newest N matching backup_*.sql files.",
    )

    # Integrity: optional learned linear weights (see /api/v1/integrity/*)
    INTEGRITY_USE_LEARNED_WEIGHTS: bool = Field(
        False,
        description="If true, use latest active row from integrity_weight_config in composite (when present).",
    )
    INTEGRITY_RETRAIN_MIN_SAMPLES: int = Field(8, ge=3, le=50_000, description="Min training rows to run /integrity/retrain.")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    def resolved_openai_embedding_model(self) -> str:
        m = (self.OPENAI_EMBEDDING_MODEL or "").strip()
        return m or _OPENAI_DEFAULT_EMBEDDING

    def resolved_openai_chat_model(self) -> str:
        m = (self.OPENAI_CHAT_MODEL or "").strip()
        return m or _OPENAI_DEFAULT_CHAT

    def resolved_openai_assessment_model(self) -> str:
        m = (self.OPENAI_ASSESSMENT_MODEL or "").strip()
        return m or _OPENAI_DEFAULT_MINI

    def resolved_openai_rewrite_model(self) -> str:
        m = (self.OPENAI_REWRITE_MODEL or self.OPENAI_ASSESSMENT_MODEL or "").strip()
        return m or _OPENAI_DEFAULT_MINI

    def get_cors_origins(self) -> List[str]:
        v = self.BACKEND_CORS_ORIGINS
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        raw = str(v or "").strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                arr = json.loads(raw)
                if isinstance(arr, list):
                    return [str(x).strip() for x in arr if x]
            except json.JSONDecodeError:
                pass
        return [x.strip() for x in raw.split(",") if x.strip()]

    def require_openai(self) -> None:
        if not (self.OPENAI_API_KEY or "").strip():
            raise ValueError("OPENAI_API_KEY is not set.")

    @model_validator(mode="after")
    def _normalize_postgres_dsn(self) -> "Settings":
        # SQLAlchemy uses postgresql+psycopg://; libpq/psycopg want postgresql://
        dsn = (self.DATABASE_URL or "").strip()
        if dsn.startswith("postgresql+psycopg://"):
            self.DATABASE_URL = "postgresql://" + dsn.removeprefix("postgresql+psycopg://")
        return self


settings = Settings()
