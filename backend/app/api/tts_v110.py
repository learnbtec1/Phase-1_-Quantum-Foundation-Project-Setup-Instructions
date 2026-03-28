# -*- coding: utf-8 -*-
"""
V110.1 Sovereign TTS Routes
=============================
GET  /health/tts  — live Azure smoke-test + avg_latency_ms (dev-only stat)
POST /tts/speak   — raw RIFF WAV (audio/wav) from JSON {text, voice?, type?}

Hardening additions (V110.1):
  • Circuit breaker: 3 consecutive failures → 60-second automatic pause.
  • SSML: body.type == "ssml" (or text begins with <speak) routes to speak_ssml_async.
  • Per-request text length guard: ≤ 3000 chars (prevents abuse / huge latency spikes).
  • Unique req_id per call, passed to service for telemetry.
  • /health/tts returns avg_latency_ms from rolling-window stats.

Routes are intentionally mounted WITHOUT a prefix (see app/main.py include)
so they are reachable at exactly /health/tts and /tts/speak.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

log = logging.getLogger("tts_v110")

router = APIRouter(tags=["tts-v110"])

# ── Circuit breaker (module-level, thread-safe) ───────────────────────────────
_CB_LOCK           = threading.Lock()
_CB_FAILURES       = 0          # consecutive failures
_CB_OPEN_UNTIL     = 0.0        # epoch-seconds; 0 = closed
_CB_WINDOW_FAILS   = 3          # failures before open
_CB_OPEN_DURATION  = 60.0       # seconds the breaker stays open


def _cb_check() -> None:
    """Raise 503 immediately when circuit is open."""
    with _CB_LOCK:
        if time.monotonic() < _CB_OPEN_UNTIL:
            remaining = round(_CB_OPEN_UNTIL - time.monotonic(), 1)
            raise HTTPException(
                status_code=503,
                detail=f"TTS circuit breaker OPEN — retry in {remaining}s",
            )


def _cb_success() -> None:
    global _CB_FAILURES, _CB_OPEN_UNTIL
    with _CB_LOCK:
        _CB_FAILURES   = 0
        _CB_OPEN_UNTIL = 0.0


def _cb_failure() -> None:
    global _CB_FAILURES, _CB_OPEN_UNTIL
    with _CB_LOCK:
        _CB_FAILURES += 1
        if _CB_FAILURES >= _CB_WINDOW_FAILS:
            _CB_OPEN_UNTIL = time.monotonic() + _CB_OPEN_DURATION
            log.warning(
                "[TTS CB] Circuit OPEN after %d consecutive failures — pausing %.0fs",
                _CB_FAILURES, _CB_OPEN_DURATION,
            )
            _CB_FAILURES = 0


# ── Request / Response models ─────────────────────────────────────────────────

class _SpeakBody(BaseModel):
    text: str = Field(..., max_length=3000,
                      description="Plain text or SSML document (≤ 3000 chars)")
    voice: Optional[str] = None
    type: Literal["text", "ssml"] = Field(
        "text",
        description="'ssml' → routed to speak_ssml_async; 'text' → speak_text_async",
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/health/tts", summary="Azure TTS live health check")
async def health_tts() -> dict:
    """Synthesize a short test phrase with Azure and return health summary.

    Returns 200 + ``{ok, provider, voice, len, avg_latency_ms}`` on success,
    or 500 with error detail on failure.
    """
    from tts.service import synthesize as _syn, avg_latency_ms as _avg  # noqa: PLC0415
    from tts.config import TTSConfig as _cfg                             # noqa: PLC0415

    _req_id = str(uuid.uuid4())
    try:
        loop = asyncio.get_running_loop()
        b = await loop.run_in_executor(
            None,
            lambda: _syn("اختبار الصوت — تيم الأردني", req_id=_req_id),
        )
        _cb_success()
        return {
            "ok":             True,
            "provider":       "azure",
            "voice":          _cfg.default_voice,
            "len":            len(b),
            "avg_latency_ms": _avg(),
            "req_id":         _req_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _cb_failure()
        log.error("[health/tts] failed | req_id=%s | %s", _req_id, exc)
        raise HTTPException(status_code=500, detail=f"TTS health failed: {exc}")


@router.post("/tts/speak", summary="Synthesize text/SSML to RIFF WAV (Azure, no fallback)")
async def tts_speak(body: _SpeakBody) -> Response:
    """Synthesize *text* (or SSML) via Azure Neural TTS.

    - Default voice:  ``ar-JO-TaimNeural``
    - Output format:  RIFF 24 kHz / 16-bit / mono PCM
    - Max text length: 3 000 chars
    - No fallback — hard-fails with 500 on any Azure error.
    - Circuit breaker opens after 3 consecutive failures for 60 s.
    """
    _cb_check()

    from tts.service import synthesize as _syn  # noqa: PLC0415

    _req_id  = str(uuid.uuid4())
    _is_ssml = body.type == "ssml" or body.text.lstrip().startswith("<speak")

    try:
        loop  = asyncio.get_running_loop()
        audio = await loop.run_in_executor(
            None,
            lambda: _syn(body.text, body.voice, is_ssml=_is_ssml, req_id=_req_id),
        )
        _cb_success()
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"X-TTS-Req-Id": _req_id},
        )
    except HTTPException:
        raise
    except Exception as exc:
        _cb_failure()
        log.error("[tts/speak] failed | req_id=%s | %s", _req_id, exc)
        raise HTTPException(status_code=500, detail=f"Azure TTS error: {exc}")
