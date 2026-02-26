"""
Main FastAPI app for NEXUS.
"""

import logging
import sys
import os
import time
import uuid
from collections import defaultdict

# Ensure the backend directory is in the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.assessment import router as assessment_router
from app.api.v1.endpoints.websocket import router as websocket_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Simple in-memory rate limit: (ip -> [(timestamp, count)])
_rate_store: defaultdict = defaultdict(list)
RATE_LIMIT_REQUESTS = 60
RATE_LIMIT_WINDOW_SEC = 60


def _rate_limit_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_rate_limit(key: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW_SEC
    _rate_store[key] = [(t, c) for t, c in _rate_store[key] if t > window_start]
    total = sum(c for _, c in _rate_store[key])
    if total >= RATE_LIMIT_REQUESTS:
        return False
    _rate_store[key].append((now, 1))
    return True


app = FastAPI(
    title="NEXUS Assessment API",
    description="Smart grading engine for P/M/D criteria using OpenAI.",
    version="4.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_and_rate_limit(request: Request, call_next):
    """إرفاق Request-ID وتطبيق حد الطلبات على نقاط التقييم."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    path = request.url.path
    if path.startswith("/api/v1/assessment/") and request.method == "POST":
        if not _check_rate_limit(_rate_limit_key(request)):
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={"detail": "تجاوز حد الطلبات. حاول لاحقاً."},
                headers={"X-Request-ID": request_id},
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# Include routers
app.include_router(assessment_router)
app.include_router(websocket_router)

@app.get("/")
async def health_check():
    return {
        "status": "Online",
        "engine": "Forensic Engine v4.0 (OpenAI)",
        "model": "gpt-4o",
        "system": "Connected to Next.js Frontend"
    }