# -*- coding: utf-8 -*-
"""
EDUVERS-CORE — FastAPI backend
AI assessment, RAG plagiarism detection, JWT auth (text-only system).

Includes:
- Auth (JWT)
- Vector search (pgvector)
- BTEC assessment pipeline
"""

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from typing import List

import redis.asyncio as redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_limiter import FastAPILimiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Routers
from app.api.v1.endpoints import (
    admin_analytics,
    admin_backup,
    auth,
    assessment,
    billing,
    export,
    integrity,
    student_rewrite,
    tts_timing,
    ultra_tutor,
    usage,
    vectors,
)
from app.api.v1.endpoints.edge_tts_debug import router as edge_tts_debug_router

# Core
from app.core.config import settings
from app.core.limiter import limiter
from app.core.rate_limit import arabic_http_429

# DB & services
from app.db.session import get_db_connection, ensure_user_document_schema
from app.services.integrity_learning import ensure_integrity_schema
from app.services.rag_documents_service import get_rag_documents_service
from app.services.vector_service import get_vector_service
from app.api.ws_agent import register_ws_agent_route

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if (settings.SENTRY_DSN or "").strip():
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.1,
        )
        logger.info("Sentry initialized")
    except Exception as e:
        logger.warning("Sentry init failed: %s", e)

# Startup diagnostic: host + database (password redacted). Remove or lower level in production.
def _redact_database_url(dsn: str) -> str:
    """Hide password in postgresql(+)://user:pass@... for logs."""
    try:
        return re.sub(
            r"://([^:/?#]+):([^@]+)@",
            r"://\1:***@",
            dsn,
            count=1,
        )
    except Exception:
        return "<?>"

logger.warning("DATABASE_URL (redacted) used by backend: %s", _redact_database_url(settings.DATABASE_URL or ""))

# -----------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# -----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database schema and vector index on startup."""
    # Redis: per-user LLM rate limits. If Redis is down, app still starts; GuardedRateLimiter no-ops.
    _redis_url = (settings.ASSESSMENT_REDIS_URL or "").strip() or "redis://localhost:6379"
    _redis: redis.Redis | None = None
    app.state.limiter_active = False
    try:
        _redis = redis.from_url(
            _redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        await _redis.ping()
        await FastAPILimiter.init(
            _redis,
            http_callback=arabic_http_429,
        )
        app.state.limiter_active = True
        logger.info("FastAPILimiter + Redis connected — LLM rate limiting ACTIVE (%s)", _redis_url)
    except Exception as e:
        logger.warning(
            "Redis unavailable — LLM rate limiting DISABLED (graceful degradation). Error: %s",
            e,
        )
        if _redis is not None:
            try:
                await _redis.close()
            except Exception as close_e:
                logger.debug("Redis client close after failed init: %s", close_e)
        _redis = None
        # Partial FastAPILimiter.init: clear class state so GuardedRateLimiter no-ops cleanly
        FastAPILimiter.redis = None
        FastAPILimiter.lua_sha = None

    try:
        with get_db_connection() as conn:
            ensure_user_document_schema(conn)
        logger.info("User/document schema initialized")
    except Exception as e:
        logger.warning("Schema init failed: %s", e)

    try:
        ensure_integrity_schema()
        logger.info("Integrity (feedback/weights) schema initialized")
    except Exception as e:
        logger.warning("Integrity schema init failed: %s", e)

    try:
        get_vector_service().ensure_schema()
        logger.info("Vector schema initialized (pgvector + embedding_chunks)")
    except Exception as e:
        logger.error(
            "Vector schema init failed: %s. Use a Postgres image with pgvector (e.g. "
            "pgvector/pgvector:pg15 in docker-compose) or run: CREATE EXTENSION vector;",
            e,
        )

    try:
        get_rag_documents_service().ensure_schema()
        logger.info("rag_documents schema initialized")
    except Exception as e:
        logger.warning("rag_documents schema init failed: %s", e)

    yield

    if getattr(FastAPILimiter, "redis", None) is not None:
        try:
            await FastAPILimiter.close()
        except Exception as e:
            logger.warning("FastAPILimiter close: %s", e)

# -----------------------------------------------------------------------------
# FastAPI App
# -----------------------------------------------------------------------------
app = FastAPI(
    title="EDUVERS-CORE API",
    version="0.2.0",
    description=(
        "AI assessment and plagiarism detection (RAG-based). "
        "Supports BTEC-style grading and criterion evaluation."
    ),
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# -----------------------------------------------------------------------------
# CORS Configuration (CRITICAL)
# -----------------------------------------------------------------------------
# Local dev: UI (e.g. :3001) and API (e.g. :8001) = cross-origin. Never rely on
# BACKEND_CORS_ORIGINS env alone (Docker/env typos can yield empty or wrong list).
_CORS_DEV_ORIGINS: List[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3010",
    "http://127.0.0.1:3010",
]


def get_allowed_origins() -> List[str]:
    """
    Merge env-driven origins with dev defaults, deduplicated.
    - Never use '*' with allow_credentials=True (browsers block it).
    - Always include standard localhost/127.0.0.1 UI ports for local work.
    """
    seen: set[str] = set()
    out: List[str] = []
    for o in _CORS_DEV_ORIGINS:
        o = o.strip()
        if o and o not in seen:
            seen.add(o)
            out.append(o)
    extra = settings.get_cors_origins()
    if extra and extra != ["*"]:
        for o in extra:
            o = str(o).strip()
            if not o or o == "*":
                continue
            if o not in seen:
                seen.add(o)
                out.append(o)
    return out if out else list(_CORS_DEV_ORIGINS)


_cors_list = get_allowed_origins()
logger.info("CORS allow_origins (%d): %s", len(_cors_list), _cors_list)

# Do not use allow_origin_regex=... as a catch-all (e.g. ".*") with
# allow_credentials=True — browser CORS + credentials do not work like allow_origins=["*"].
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,  # cache preflight for 10 min
    expose_headers=["*"],
)

# -----------------------------------------------------------------------------
# API Routers
# -----------------------------------------------------------------------------
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(billing.router, prefix=settings.API_V1_STR)
app.include_router(usage.router, prefix=settings.API_V1_STR)
app.include_router(vectors.router, prefix=settings.API_V1_STR)
app.include_router(integrity.router, prefix=settings.API_V1_STR)
app.include_router(assessment.router, prefix=settings.API_V1_STR)
app.include_router(export.router, prefix=settings.API_V1_STR)
app.include_router(student_rewrite.router, prefix=settings.API_V1_STR)
app.include_router(ultra_tutor.router, prefix=settings.API_V1_STR)
app.include_router(admin_analytics.router, prefix=settings.API_V1_STR)
app.include_router(admin_backup.router, prefix=settings.API_V1_STR)
app.include_router(edge_tts_debug_router, prefix=settings.API_V1_STR)
app.include_router(tts_timing.router, prefix=settings.API_V1_STR)

# Cogni realtime client (Next.js avatar) — minimal WebSocket so upgrade succeeds locally / Docker.
register_ws_agent_route(app)

# -----------------------------------------------------------------------------
# Health & Root Endpoints
# -----------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "eduvor-core-backend",
    }


@app.get(f"{settings.API_V1_STR}/health")
def health_under_api_prefix() -> dict[str, str]:
    """Same payload as `/health` — for probes expecting `/api/v1/health`."""
    return health()


@app.get("/")
def root() -> dict[str, str]:
    """API root info."""
    return {
        "name": "EDUVERS-CORE",
        "api": (
            f"{settings.API_V1_STR}/auth, {settings.API_V1_STR}/billing, {settings.API_V1_STR}/usage, "
            f"{settings.API_V1_STR}/vectors, "
            f"{settings.API_V1_STR}/assessment"
        ),
    }