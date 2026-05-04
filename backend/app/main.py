# app/main.py
"""
Main FastAPI app for EDUVERSE.
"""

import sys

# ChromaDB needs SQLite >= 3.35; use bundled lib from pysqlite3-binary before any chromadb import.
try:
    __import__("pysqlite3")
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
except ImportError:
    pass

import os
import asyncio
import logging
import time as _time

# ChromaDB telemetry PostHog hook can error on some dependency pairs (noisy ERROR in logs).
for _ch_log in (
    "chromadb.telemetry.product.posthog",
    "chromadb.telemetry.product",
    "chromadb.telemetry",
):
    logging.getLogger(_ch_log).disabled = True

# Force UTF-8 on stdout/stderr — prevents charmap/cp1252 errors on Windows when logging Arabic text
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ──────────────────────────────────────────────────────────────────────────────
# Sentry initialization (must happen before creating the FastAPI app)
# Keep backend boot resilient: if sentry_sdk is not installed, continue normally.
try:
    import sentry_sdk  # type: ignore
    from sentry_sdk.integrations.fastapi import FastApiIntegration  # type: ignore
    from sentry_sdk.integrations.starlette import StarletteIntegration  # type: ignore
except Exception:
    sentry_sdk = None  # type: ignore
    FastApiIntegration = None  # type: ignore
    StarletteIntegration = None  # type: ignore
    logging.warning("sentry_sdk not installed — backend continues without Sentry")

SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN and sentry_sdk is not None:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.2")),
        send_default_pii=os.getenv("SENTRY_SEND_PII", "false").lower() == "true",
        environment=os.getenv("ENVIRONMENT", "development"),
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
        ],
    )
    logging.info("Sentry initialized for backend")
elif SENTRY_DSN and sentry_sdk is None:
    logging.warning("SENTRY_DSN is set but sentry_sdk is missing — Sentry disabled")
else:
    logging.warning("SENTRY_DSN not set — error monitoring disabled")
# ──────────────────────────────────────────────────────────────────────────────

from app.api.v1.endpoints.assessment import router as assessment_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.stt import router as stt_router
from app.api.v1.endpoints.tts import router as tts_router
from app.api.v1.endpoints.tts_timing import router as tts_timing_router
from app.api.v1.endpoints.agent_ws import router as agent_ws_router
from app.api.v1.endpoints.websocket import router as websocket_world_router
from app.api.v1.endpoints.eduverse_ip import router as eduverse_ip_router
from app.api.v1.endpoints.reports import router as reports_router
from app.api.v1.endpoints.btec_ingest import router as btec_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.dashboard import router as dashboard_router
from app.api.v1.endpoints.curriculum import router as curriculum_router
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.digital_human_api import router as digital_human_router
from app.api.v1.endpoints.stripe_webhook import router as stripe_webhook_router
from app.api.v1.endpoints.saml_auth import router as saml_auth_router
from app.api.v1.endpoints.tutor import router as tutor_http_router
from app.api.v1.endpoints.rag import router as rag_router
from app.api.memory import router as memory_router

from app.core.config import settings
from app.core.middleware_request_id import RequestIdMiddleware
from app.core.rate_limit import ApiRateLimitMiddleware
from app.services.tts_service import (
    EdgeTTSService,
    _EDGE_TTS_AVAILABLE,
    log_critical_if_elevenlabs_misconfigured,
    synthesize_edge_tts_async,
    synthesize_elevenlabs_async,
)

logger = logging.getLogger(__name__)

# ── TTS health-ping cache ─────────────────────────────────────────────────────
# Updated every _TTS_PING_EVERY_SEC by the background task started in lifespan.
# The /api/health endpoint reads from this dict instead of rechecking live on
# every call.
_tts_health: dict = {"ok": None, "latency_ms": None, "ts": 0, "provider": None}
_TTS_PING_EVERY_SEC = 300   # 5 minutes


def _effective_tts_provider() -> str:
    return (os.getenv("TTS_PROVIDER") or settings.TTS_PROVIDER or "edge").lower().strip()


async def _tts_ping_loop() -> None:
    """Background task: TTS reachability ping for /api/health (ElevenLabs or Edge per TTS_PROVIDER)."""
    await asyncio.sleep(8)   # slight startup delay — let the app warm up first
    while True:
        try:
            prov = _effective_tts_provider()
            _tts_health["provider"] = prov
            if prov == "elevenlabs":
                t0 = _time.monotonic()
                mp3 = await asyncio.wait_for(
                    synthesize_elevenlabs_async("ok"),
                    timeout=90.0,
                )
                latency_ms = int((_time.monotonic() - t0) * 1000)
                ok = bool(mp3 and len(mp3) >= 32)
                _tts_health.update({
                    "ok": ok,
                    "latency_ms": latency_ms,
                    "ts": int(_time.time() * 1000),
                })
                logger.info("ElevenLabs TTS ping OK — latency=%d ms", latency_ms)
            elif _EDGE_TTS_AVAILABLE:
                t0 = _time.monotonic()
                mp3 = await asyncio.wait_for(
                    synthesize_edge_tts_async("اختبار"),
                    timeout=45.0,
                )
                latency_ms = int((_time.monotonic() - t0) * 1000)
                _tts_health.update({
                    "ok":         bool(mp3),
                    "latency_ms": latency_ms,
                    "ts":         int(_time.time() * 1000),
                })
                logger.info("Edge TTS ping OK — latency=%d ms", latency_ms)
            else:
                _tts_health.update({"ok": False, "latency_ms": None,
                                    "ts": int(_time.time() * 1000)})
        except Exception as exc:
            _tts_health.update({"ok": False, "latency_ms": None,
                                 "ts": int(_time.time() * 1000)})
            logger.warning("TTS ping failed (%s): %s", _tts_health.get("provider"), exc)
        await asyncio.sleep(_TTS_PING_EVERY_SEC)


@asynccontextmanager
async def lifespan(app_instance):
    """Pre‑warm TTS and STT models on startup and initialize Edge TTS service."""
    import asyncio
    loop = asyncio.get_running_loop()

    _tts_prov = _effective_tts_provider()
    _el_key = bool((os.getenv("ELEVENLABS_API_KEY") or settings.ELEVENLABS_API_KEY or "").strip())
    _el_vid = bool((os.getenv("ELEVENLABS_VOICE_ID") or settings.ELEVENLABS_VOICE_ID or "").strip())
    logger.info(
        "[TTS-STARTUP] Provider: %s | ELEVENLABS_API_KEY set: %s | ELEVENLABS_VOICE_ID set: %s",
        _tts_prov,
        _el_key,
        _el_vid,
    )
    try:
        log_critical_if_elevenlabs_misconfigured()
    except Exception as _el_guard_exc:
        logger.warning("ElevenLabs startup guard failed (non-fatal): %s", _el_guard_exc)

    # 0) Re-patch logging handlers that uvicorn registered AFTER our module-top
    #    patch ran.  This prevents cp1252 UnicodeEncodeError in Windows consoles.
    try:
        from app.services.whisper_stt import _patch_logging_handlers
        _patch_logging_handlers()
    except Exception as _log_patch_exc:
        logger.warning("Whisper logging handler patch skipped: %s", _log_patch_exc, exc_info=True)

    try:
        from app.core.startup_checks import log_startup_security_and_ops_warnings

        log_startup_security_and_ops_warnings(
            environment=settings.ENVIRONMENT,
            jwt_secret=settings.JWT_SECRET,
        )
    except Exception as _su_exc:
        logger.warning("Startup security/ops checks skipped: %s", _su_exc)

    try:
        from app.archive.tts_data_dirs import ensure_tts_data_dirs

        ensure_tts_data_dirs()
    except Exception as e:
        logger.warning("TTS data dirs setup: %s", e)

    # 1) Whisper STT (local)
    try:
        from app.services.whisper_stt import _init_whisper
        await loop.run_in_executor(None, _init_whisper)
        logger.info("Whisper STT pre‑warmed")
    except Exception as e:
        logger.warning("Whisper pre‑warm failed: %s", e)

    # 2) Edge TTS — store in app.state for dependency injection
    try:
        app_instance.state.tts_service = EdgeTTSService(
            default_voice=None,
            prosody_rate=0.95,
            request_timeout=45.0,
        )
        logger.info(
            "Edge TTS service initialized | voice=%s",
            getattr(app_instance.state.tts_service, "_default_voice", ""),
        )
    except Exception as e:
        logger.error("Edge TTS service initialization failed: %s", e)
        app_instance.state.tts_service = None

    try:
        from app.services.local_tts_startup import warmup_local_tts_instances

        await warmup_local_tts_instances()
    except Exception as _lu_exc:
        logger.warning("Local TTS pool startup warmup skipped: %s", _lu_exc)

    # 3) TTS health-ping background task — updates _tts_health every 5 min
    _ping_task = asyncio.create_task(_tts_ping_loop())
    app_instance.state.tts_ping_task = _ping_task

    # AutonomousThinker («الفص الجبهي») runs per WebSocket session in agent_ws (session memory +
    # idle/LLM-busy guards). It is not started here to avoid a global singleton sharing one memory.

    # Dev: optional SQLAlchemy create_all — production defaults to False (see Settings.AUTO_CREATE_TABLES + Alembic).
    if settings.AUTO_CREATE_TABLES:
        try:
            from app.database import Base, engine
            import app.models.db_models  # noqa: F401 — register models on Base.metadata

            Base.metadata.create_all(bind=engine)
            logger.info("AUTO_CREATE_TABLES: SQLAlchemy metadata applied")
        except Exception as _meta_err:
            logger.warning("AUTO_CREATE_TABLES skipped: %s", _meta_err)

    # Evaluation repository mode (BTEC forensic persistence / avatar grade bridge)
    try:
        _use_db_eval = os.getenv("USE_DB", "false").lower() in ("true", "1", "yes")
        if _use_db_eval:
            from app.repository.evaluations import DatabaseUnavailableError, get_evaluation_repo

            try:
                _er = get_evaluation_repo()
                logger.info(
                    "Evaluation persistence at startup: %s (USE_DB=true). "
                    "Ensure DATABASE_URL points to PostgreSQL and migrations are applied.",
                    type(_er).__name__,
                )
            except DatabaseUnavailableError as _dbe:
                logger.warning(
                    "Evaluation persistence: PostgreSQL unavailable (%s). "
                    "Forensic save may return 503 until DB is up.",
                    _dbe,
                )
        else:
            logger.info(
                "Evaluation persistence at startup: InMemoryEvaluationRepository (USE_DB=false). "
                "Grades are not durable across process restarts; set USE_DB=true for production.",
            )
    except Exception as _eval_probe:
        logger.warning("Evaluation repository startup probe failed: %s", _eval_probe)

    yield

    # Cleanup
    _ping_task.cancel()
    if hasattr(app_instance.state, "tts_service") and app_instance.state.tts_service:
        logger.info("Edge TTS service released (garbage collected).")


app = FastAPI(
    lifespan=lifespan,
    title="EDUVERSE Assessment API",
    description="Smart grading engine for P/M/D criteria (GPT-5 / Claude via GRADER_MODEL env var).",
    version="4.0.0",
)

# ─── Allowed origins (single source: Settings.BACKEND_CORS_ORIGINS + EXTRA_ORIGINS) ─
# IMPORTANT: allow_origins=["*"] + allow_credentials=True is invalid per the CORS spec.
ALLOW_ORIGINS: list[str] = []
for _o in settings.get_cors_origins():
    if _o and _o not in ALLOW_ORIGINS:
        ALLOW_ORIGINS.append(_o)
for _o in (x.strip() for x in os.getenv("EXTRA_ORIGINS", "").split() if x.strip()):
    if _o not in ALLOW_ORIGINS:
        ALLOW_ORIGINS.append(_o)

# Wildcard with credentials=True violates the CORS spec and is a common misconfiguration.
if "*" in ALLOW_ORIGINS:
    logger.error(
        "CORS: '*' origin is not allowed with allow_credentials=True — stripping wildcard. "
        "Set explicit BACKEND_CORS_ORIGINS (e.g. http://localhost:3000).",
    )
    ALLOW_ORIGINS = [o for o in ALLOW_ORIGINS if o != "*"]
if not ALLOW_ORIGINS:
    ALLOW_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
    logger.warning("CORS: no valid origins after sanitization — defaulting to localhost:3000")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(ApiRateLimitMiddleware)

_trusted_hosts = [h.strip() for h in (settings.ALLOWED_HOSTS or "").split(",") if h.strip()]
if settings.is_production and _trusted_hosts:
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_trusted_hosts)
elif settings.is_production:
    logger.warning(
        "Production: ALLOWED_HOSTS unset — Host header is not restricted via TrustedHostMiddleware. "
        "Set ALLOWED_HOSTS to comma-separated hostnames (no http://, no port).",
    )

# Include routers
app.include_router(assessment_router)
app.include_router(chat_router, prefix="/api/v1")
app.include_router(rag_router, prefix="/api/v1")
app.include_router(tutor_http_router, prefix="/api/v1/tutor")  # POST /api/v1/tutor/chat (legacy shape + gate_llm)
app.include_router(stt_router, prefix="/api/v1")
app.include_router(tts_router, prefix="/api/v1")
app.include_router(tts_timing_router, prefix="/api/v1")
app.include_router(agent_ws_router)  # mounts at /ws/agent (no prefix — path defined by router)
app.include_router(websocket_world_router)  # /ws/world/{room_id} — virtual room broadcast (optional clients)
app.include_router(eduverse_ip_router)  # EDUVERSE IP: /api/v1/eduverse/*
app.include_router(reports_router)   # Academic PDF reports: /api/v1/reports/*
app.include_router(memory_router)    # Conversation memory: /api/v1/memory/*
app.include_router(btec_router, prefix="/api/v1")  # BTEC Knowledge Ingestion: /api/v1/btec/*
app.include_router(auth_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(curriculum_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(digital_human_router, prefix="/api/v1")
app.include_router(stripe_webhook_router, prefix="/api/v1")
app.include_router(saml_auth_router, prefix="/api/v1")


@app.get("/api/health")
async def api_health():
    """Standard /api/health endpoint consumed by Next.js health route.

    ``audio`` reflects TTS readiness for the configured ``TTS_PROVIDER``:
    ElevenLabs live ping when ``elevenlabs``, otherwise Edge TTS (``edge-tts``)
    when installed. Until the first ping, falls back to credential / import checks.

    Production (ENVIRONMENT=production): minimal JSON ``{\"ok\": true}`` only.
    """
    if settings.is_production:
        return {"ok": True}

    _tts_prov_h = _effective_tts_provider()
    if _tts_prov_h == "elevenlabs":
        _k = (os.getenv("ELEVENLABS_API_KEY") or settings.ELEVENLABS_API_KEY or "").strip()
        _v = (os.getenv("ELEVENLABS_VOICE_ID") or settings.ELEVENLABS_VOICE_ID or "").strip()
        credentials_ok = bool(_k and _v)
    else:
        credentials_ok = _EDGE_TTS_AVAILABLE
    # Use live ping result once available, otherwise fall back to credential check
    ping_result = _tts_health.get("ok")
    audio = ping_result if ping_result is not None else credentials_ok

    try:
        from app.core.redis_client import redis_ping

        redis_ok = redis_ping()
    except Exception:
        redis_ok = None

    tts_snap = None
    try:
        from app.api.v1.endpoints.tts_timing import _OBS_LOCK, _tts_obs_counters

        with _OBS_LOCK:
            tts_snap = dict(_tts_obs_counters)
    except Exception:
        pass

    return {
        "ok":            True,
        "env":           bool(os.getenv("OPENAI_API_KEY") or settings.OPENAI_API_KEY),
        "audio":         audio,
        "tts_provider":  _tts_prov_h,
        "reach":         True,
        "redis":         redis_ok,
        "last_tts_ms":   _tts_health.get("latency_ms"),
        "last_check_ts": _tts_health.get("ts") or None,
        "tts_counters":  tts_snap,
    }