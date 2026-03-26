"""
Main FastAPI app for NEXUS.
"""

import asyncio
import logging
import sys
import os
import time as _time

# Force UTF-8 on stdout/stderr — prevents charmap/cp1252 errors on Windows when logging Arabic text
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Ensure the backend directory is in the Python path
_backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.assessment import router as assessment_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.stt import router as stt_router
from app.api.v1.endpoints.tts import router as tts_router
from app.api.v1.endpoints.tts_timing import router as tts_timing_router
from app.api.v1.endpoints.agent_ws import router as agent_ws_router
from app.api.v1.endpoints.nexus_ip import router as nexus_ip_router
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
from app.api.memory import router as memory_router

from app.core.config import settings
from app.core.middleware_request_id import RequestIdMiddleware
from app.core.rate_limit import ApiRateLimitMiddleware
from app.services.tts_service import AzureTTSService

logger = logging.getLogger(__name__)

# ── TTS health-ping cache ─────────────────────────────────────────────────────
# Updated every _TTS_PING_EVERY_SEC by the background task started in lifespan.
# The /api/health endpoint reads from this dict instead of rechecking live on
# every call.
_tts_health: dict = {"ok": None, "latency_ms": None, "ts": 0}
_TTS_PING_EVERY_SEC = 300   # 5 minutes


async def _tts_ping_loop() -> None:
    """Background task: perform a short Azure TTS synthesis every 5 minutes,
    cache the result so /api/health can return live audio availability."""
    await asyncio.sleep(8)   # slight startup delay — let the app warm up first
    while True:
        try:
            from app.api.v1.endpoints.tts_timing import _synthesize_azure_sync
            key    = settings.AZURE_SPEECH_KEY
            region = settings.AZURE_SPEECH_REGION
            voice  = settings.TTS_ARABIC_VOICE
            if key and region:
                t0 = _time.monotonic()
                loop = asyncio.get_running_loop()
                wav, _, _, _ = await loop.run_in_executor(
                    None, _synthesize_azure_sync, "اختبار", key, region, voice
                )
                latency_ms = int((_time.monotonic() - t0) * 1000)
                _tts_health.update({
                    "ok":         bool(wav),
                    "latency_ms": latency_ms,
                    "ts":         int(_time.time() * 1000),
                })
                logger.info("TTS ping OK — latency=%d ms", latency_ms)
            else:
                _tts_health.update({"ok": False, "latency_ms": None,
                                    "ts": int(_time.time() * 1000)})
        except Exception as exc:
            _tts_health.update({"ok": False, "latency_ms": None,
                                 "ts": int(_time.time() * 1000)})
            logger.warning("TTS ping failed: %s", exc)
        await asyncio.sleep(_TTS_PING_EVERY_SEC)


@asynccontextmanager
async def lifespan(app_instance):
    """Pre‑warm TTS and STT models on startup and initialize Azure TTS service."""
    import asyncio
    loop = asyncio.get_running_loop()

    # 0) Re-patch logging handlers that uvicorn registered AFTER our module-top
    #    patch ran.  This prevents cp1252 UnicodeEncodeError in Windows consoles.
    try:
        from app.services.whisper_stt import _patch_logging_handlers
        _patch_logging_handlers()
    except Exception:
        pass

    # 1) Kokoro TTS (local)
    try:
        from app.services.kokoro_tts import _init_kokoro
        await loop.run_in_executor(None, _init_kokoro)
        logger.info("Kokoro TTS pre‑warmed")
    except Exception as e:
        logger.warning("Kokoro pre‑warm failed: %s", e)

    # 2) Whisper STT (local)
    try:
        from app.services.whisper_stt import _init_whisper
        await loop.run_in_executor(None, _init_whisper)
        logger.info("Whisper STT pre‑warmed")
    except Exception as e:
        logger.warning("Whisper pre‑warm failed: %s", e)

    # 3) Azure Neural TTS (cloud) – store in app.state for dependency injection
    try:
        app_instance.state.tts_service = AzureTTSService(
            speech_key=settings.AZURE_SPEECH_KEY,
            speech_region=settings.AZURE_SPEECH_REGION,
            default_voice=settings.TTS_ARABIC_VOICE,
            prosody_rate=0.95,
            request_timeout=15.0,
        )
        logger.info(
            "Azure TTS service initialized | region=%s | default_voice=%s",
            settings.AZURE_SPEECH_REGION,
            settings.TTS_ARABIC_VOICE,
        )
    except Exception as e:
        logger.error("Azure TTS service initialization failed: %s", e)
        app_instance.state.tts_service = None

    # 4) TTS health-ping background task — updates _tts_health every 5 min
    _ping_task = asyncio.create_task(_tts_ping_loop())
    app_instance.state.tts_ping_task = _ping_task

    # AutonomousThinker («الفص الجبهي») runs per WebSocket session in agent_ws (session memory +
    # idle/LLM-busy guards). It is not started here to avoid a global singleton sharing one memory.

    # Dev: ensure Phase A tables (users extensions, user_memory) exist — production should use Alembic.
    if os.getenv("AUTO_CREATE_TABLES", "true").lower() in ("1", "true", "yes"):
        try:
            from app.database import Base, engine
            import app.models.db_models  # noqa: F401 — register models on Base.metadata

            Base.metadata.create_all(bind=engine)
            logger.info("AUTO_CREATE_TABLES: SQLAlchemy metadata applied")
        except Exception as _meta_err:
            logger.warning("AUTO_CREATE_TABLES skipped: %s", _meta_err)

    yield

    # Cleanup
    _ping_task.cancel()
    if hasattr(app_instance.state, "tts_service") and app_instance.state.tts_service:
        logger.info("Azure TTS service released (garbage collected).")


app = FastAPI(
    lifespan=lifespan,
    title="NEXUS Assessment API",
    description="Smart grading engine for P/M/D criteria (GPT-4o / Claude via GRADER_MODEL env var).",
    version="4.0.0",
)

# ─── Allowed origins ─────────────────────────────────────────────────────────
# IMPORTANT: allow_origins=["*"] + allow_credentials=True is invalid per the
# CORS spec — browsers reject such responses. Explicit origins are required.
ALLOW_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
# Allow extra origins via env var (space-separated) for deployment flexibility
_extra_origins = os.getenv("EXTRA_ORIGINS", "").split()
if _extra_origins:
    ALLOW_ORIGINS.extend(_extra_origins)

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

# Include routers
app.include_router(assessment_router)
app.include_router(chat_router, prefix="/api/v1")
app.include_router(stt_router, prefix="/api/v1")
app.include_router(tts_router, prefix="/api/v1")
app.include_router(tts_timing_router, prefix="/api/v1")
app.include_router(agent_ws_router)  # mounts at /ws/agent (no prefix — path defined by router)
app.include_router(nexus_ip_router)  # NEXUS IP: /api/v1/nexus/*
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

    ``audio`` reflects a live TTS ping performed every 5 minutes by the
    background task.  On first startup (before the first ping fires) it
    falls back to a credential-presence check so health returns ``true``
    immediately if Azure is configured.
    """
    credentials_ok = (
        os.getenv("TTS_PROVIDER", "").lower() == "azure"
        and bool(os.getenv("AZURE_SPEECH_KEY") or settings.AZURE_SPEECH_KEY)
        and bool(os.getenv("AZURE_SPEECH_REGION") or settings.AZURE_SPEECH_REGION)
    )
    # Use live ping result once available, otherwise fall back to credential check
    ping_result = _tts_health.get("ok")
    audio = ping_result if ping_result is not None else credentials_ok

    try:
        from app.core.redis_client import redis_ping

        redis_ok = redis_ping()
    except Exception:
        redis_ok = None

    return {
        "ok":            True,
        "env":           bool(os.getenv("OPENAI_API_KEY") or settings.OPENAI_API_KEY),
        "audio":         audio,
        "reach":         True,
        "redis":         redis_ok,
        "last_tts_ms":   _tts_health.get("latency_ms"),
        "last_check_ts": _tts_health.get("ts") or None,
    }


@app.get("/")
async def health_check():
    """Health‑check / status endpoint consumed by the Next.js frontend."""
    try:
        from app.services.forensic_engine import MODEL_NAME  # type: ignore
    except ImportError:
        MODEL_NAME = "gpt-4o"
    return {
        "status": "Online",
        "engine": f"NEXUS Forensic Engine v4.0 ({MODEL_NAME})",
        "model": MODEL_NAME,
        "system": "Connected to Next.js Frontend",
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)