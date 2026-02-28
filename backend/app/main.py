"""
Main FastAPI app for NEXUS.
"""

import logging
import sys
import os

# Ensure the backend directory is in the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.assessment import router as assessment_router
from app.api.v1.endpoints.chat import router as chat_router
from app.api.v1.endpoints.tts_timing import router as tts_timing_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="NEXUS Assessment API",
    description="Smart grading engine for P/M/D criteria using Anthropic Claude.",
    version="4.0.0",
)

# Debugging: Print Python path to verify module resolution
print("Python Path:", sys.path)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(assessment_router)
app.include_router(chat_router, prefix="/api/v1")
app.include_router(tts_timing_router, prefix="/api/v1")

@app.get("/")
async def health_check():
    return {
        "status": "Online",
        "engine": "Claude Forensic Engine v4.0",
        "model": "claude-sonnet-4-20250514",
        "system": "Connected to Next.js Frontend"
    }