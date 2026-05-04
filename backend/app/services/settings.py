# -*- coding: utf-8 -*-
"""
settings.py — Runtime configuration for avatar-agent backend services.

All values are read from environment variables with safe defaults.
Copy backend/.env.example to backend/.env and adjust as needed.

Usage (relative import from same package):
    from app.services.settings import (
        WHISPER_DEVICE, STT_MIN_MS, STT_MAX_MB, STT_MIME_OK, STT_DURATION_SLACK_MS,
        HEARTBEAT_INTERVAL_SEC,
    )
"""
from __future__ import annotations

import os

# ─── Whisper STT ──────────────────────────────────────────────────────────────

WHISPER_DEVICE: str = os.getenv("WHISPER_DEVICE", "cpu")     # "cpu" | "cuda" | "auto"
WHISPER_COMPUTE: str = os.getenv("WHISPER_COMPUTE", "int8")  # "int8" | "float32"

# Minimum audio duration in milliseconds — reject clips shorter than this.
STT_MIN_MS: int = int(os.getenv("STT_MIN_MS", "400"))

# Subtracted from STT_MIN_MS for the **duration check only** (after PCM decode).
# Browser WebM→WAV and sample rounding often yields e.g. 397 ms for a clip that should pass a 400 ms policy.
STT_DURATION_SLACK_MS: int = int(os.getenv("STT_DURATION_SLACK_MS", "60"))

# Maximum audio payload in megabytes — reject blobs larger than this.
STT_MAX_MB: int = int(os.getenv("STT_MAX_MB", "8"))

# Allowed MIME types for audio uploads (comma-separated list).
_raw_mime = os.getenv(
    "STT_MIME_OK",
    "audio/webm,audio/ogg,audio/wav,audio/mp4,audio/mpeg,audio/x-wav",
)
STT_MIME_OK: list[str] = [m.strip().lower() for m in _raw_mime.split(",") if m.strip()]

# ─── WebSocket heartbeat ──────────────────────────────────────────────────────

# How often the server sends a heartbeat frame to the client (seconds).
# Must match HEARTBEAT_INTERVAL_SEC in frontend/src/config/avatar.ts.
HEARTBEAT_INTERVAL_SEC: int = int(os.getenv("HEARTBEAT_INTERVAL_SEC", "15"))
