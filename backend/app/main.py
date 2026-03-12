"""
Main FastAPI app for NEXUS.
"""

import logging
import sys
import os

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

from app.core.config import settings
from app.services.tts_service import AzureTTSService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app_instance):
    """Pre‑warm TTS and STT models on startup and initialize Azure TTS service."""
    import asyncio
    loop = asyncio.get_running_loop()

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
        # The service will raise RuntimeError if used without credentials;
        # we let the endpoint handle it gracefully.
        app_instance.state.tts_service = None

    yield

    # Optional: clean up if needed
    if hasattr(app_instance.state, "tts_service") and app_instance.state.tts_service:
        # The service has no explicit shutdown, but we could call reload_credentials or just let GC handle it.
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
    "http://localhost:3011",
    "http://127.0.0.1:3011",
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

# Include routers
app.include_router(assessment_router)
app.include_router(chat_router, prefix="/api/v1")
app.include_router(stt_router, prefix="/api/v1")
app.include_router(tts_router, prefix="/api/v1")
app.include_router(tts_timing_router, prefix="/api/v1")
app.include_router(agent_ws_router)  # mounts at /ws/agent (no prefix — path defined by router)


@app.get("/api/health")
async def api_health():
    """Standard /api/health endpoint consumed by Next.js health route."""
    return {
        "ok": True,
        "env": bool(os.getenv("OPENAI_API_KEY")),
        "audio": os.path.exists(os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "audio", "ui", "hover.mp3")),
        "reach": True,
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