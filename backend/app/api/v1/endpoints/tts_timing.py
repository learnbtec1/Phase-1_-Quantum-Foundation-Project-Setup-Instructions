# -*- coding: utf-8 -*-
"""
TTS-with-timing: POST /api/v1/tts-with-timing

Microsoft Edge TTS (edge-tts) — MP3 + stub viseme timeline (no native visemes).
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from collections import deque
from threading import Lock
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user, get_teacher_user
from app.api.v1.dependencies.phase2_gates import gate_tts_user
from app.models.db_models import User
from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts
from app.services.tts_service import (
    _EDGE_TTS_AVAILABLE,
    edge_tts_voice_name,
    stub_viseme_timeline_for_text,
    synthesize_edge_tts_async,
    synthesize_elevenlabs_async,
)
from app.services.conversation_store import get_store as _get_store

try:
    _store = _get_store()
except Exception as _store_exc:  # pragma: no cover
    import logging as _log
    _log.getLogger(__name__).warning("ConversationStore init failed: %s", _store_exc)
    _store = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CB_LOCK = Lock()
_cb_failures: int = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD = 5
_CB_COOLDOWN = 20.0


def _tts_cb_ok() -> bool:
    return time.monotonic() >= _cb_open_until


def _tts_cb_record_failure() -> None:
    global _cb_failures, _cb_open_until
    with _CB_LOCK:
        _cb_failures += 1
        if _cb_failures >= _CB_THRESHOLD:
            _cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(
                "Edge TTS circuit OPENED — %d consecutive failures, cooldown %.0fs",
                _cb_failures, _CB_COOLDOWN,
            )


def _tts_cb_record_success() -> None:
    global _cb_failures, _cb_open_until
    with _CB_LOCK:
        if _cb_failures:
            logger.info("Edge TTS circuit CLOSED after %d failure(s)", _cb_failures)
        _cb_failures = 0
        _cb_open_until = 0.0


_RL_LOCK = Lock()
_rl_store: Dict[str, deque] = {}
_RL_WINDOW = 1.0
_RL_MAX = 3


def _rate_limit_ok(ip: str) -> bool:
    now = time.monotonic()
    with _RL_LOCK:
        q = _rl_store.setdefault(ip, deque())
        while q and (now - q[0]) > _RL_WINDOW:
            q.popleft()
        if len(q) >= _RL_MAX:
            return False
        q.append(now)
        return True


router = APIRouter()

_OBS_LOCK = Lock()
_tts_obs_counters: Dict[str, int] = {
    "requests_total": 0,
    "success_edge": 0,
    "errors_rate_limited": 0,
    "errors_edge": 0,
}


def _tts_obs_inc(key: str) -> None:
    with _OBS_LOCK:
        _tts_obs_counters[key] = _tts_obs_counters.get(key, 0) + 1


@router.get("/tts-observability")
async def tts_observability(_auth: User = Depends(get_current_user)):
    with _OBS_LOCK:
        snap = dict(_tts_obs_counters)
    with _CB_LOCK:
        cb = {
            "failures": _cb_failures,
            "open_until_monotonic": _cb_open_until,
            "circuit_closed": _tts_cb_ok(),
        }
    env_prov = (os.getenv("TTS_PROVIDER", "edge") or "edge").lower().strip()
    return {
        "ok": True,
        "counters": snap,
        "tts_circuit": cb,
        "tts_provider_env": env_prov,
    }


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voice: Optional[str] = Field(default="am_michael")
    speed: Optional[float] = Field(default=1.0, ge=0.25, le=4.0)
    emotion: Optional[str] = Field(default="neutral")
    emotion_intensity: Optional[float] = Field(
        default=0.72,
        ge=0.0,
        le=1.0,
        description="Ignored for Edge TTS (kept for API compatibility)",
    )
    pitch: Optional[str] = Field(default=None)
    ar_voice: Optional[str] = Field(default=None)
    provider: Optional[str] = Field(default=None)
    language: Optional[str] = Field(default=None)
    format: Optional[str] = Field(default="mp3")
    sample_rate: Optional[int] = Field(default=24000)
    with_timing: Optional[bool] = Field(default=True)

    @field_validator("provider", mode="before")
    @classmethod
    def _provider_allowed(cls, v: object) -> Optional[str]:
        if v is None or v == "":
            return None
        s = str(v).strip().lower()
        if s in ("edge", "auto", "elevenlabs"):
            return s
        raise ValueError(
            f"TTS provider {v!r} is not allowed — use 'edge', 'auto', or 'elevenlabs' (or omit). "
        )


class TTSResponse(BaseModel):
    audio_base64: str
    audio_wav_base64: Optional[str] = None
    audio_mp3_base64: Optional[str] = None
    word_timings: List[Dict[str, Any]] = []
    viseme_events: List[Dict[str, Any]] = []
    sample_rate: int = 24000
    format: str = "mp3"
    timing_mode: str = "stub"
    provider: Optional[str] = None
    voice: Optional[str] = None


@router.post("/tts-reset-circuit")
async def tts_reset_circuit(_auth: User = Depends(get_teacher_user)):
    _tts_cb_record_success()
    return {"ok": True, "message": "Edge TTS circuit breaker reset"}


@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(
    payload: TTSRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(gate_tts_user),
):
    text = (payload.text or "").strip()
    text = maybe_correct_egyptian_for_tts(text, context="tts_with_timing")
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    if not _rate_limit_ok(str(user.id)):
        _tts_obs_inc("errors_rate_limited")
        raise HTTPException(status_code=429, detail="Rate limit exceeded (3 req/s per user)")

    env_prov = (os.getenv("TTS_PROVIDER", "edge") or "edge").lower().strip()
    if env_prov not in ("edge", "auto", "elevenlabs"):
        logger.error("tts-with-timing: TTS_PROVIDER env=%r is not allowed", env_prov)
        raise HTTPException(
            status_code=503,
            detail="Server misconfiguration: TTS_PROVIDER must be 'edge', 'auto', or 'elevenlabs'.",
        )

    if env_prov == "elevenlabs":
        _tts_obs_inc("requests_total")
        t_start = time.monotonic()
        _el_voice = (os.getenv("ELEVENLABS_VOICE_ID") or "").strip() or "elevenlabs"
        try:
            mp3_bytes = await asyncio.wait_for(
                synthesize_elevenlabs_async(text),
                timeout=float(os.getenv("ELEVENLABS_TTS_TIMEOUT_SEC", "120")),
            )
        except Exception as e:
            logger.exception("ElevenLabs TTS failed: %s", e)
            raise HTTPException(
                status_code=502,
                detail=f"ElevenLabs TTS failed: {e!s}",
            ) from e

        if not mp3_bytes or len(mp3_bytes) < 32:
            raise HTTPException(
                status_code=502,
                detail="ElevenLabs returned empty audio — synthesis integrity check failed.",
            )

        viseme_events = stub_viseme_timeline_for_text(text)
        word_timings: List[Dict[str, Any]] = []

        b64 = base64.b64encode(mp3_bytes).decode("ascii")
        if not b64:
            raise HTTPException(status_code=502, detail="ElevenLabs audio encoding failed.")

        t_mode = "stub"
        ms = int((time.monotonic() - t_start) * 1000)
        audio_b = len(mp3_bytes)
        vis_n = len(viseme_events)
        logger.info(
            "TTS provider=elevenlabs | format=mp3 | timing=%s | duration_ms=%d | audio_bytes=%d | viseme_count=%d | word_count=%d",
            t_mode,
            ms,
            audio_b,
            vis_n,
            len(word_timings),
        )

        _resp = TTSResponse(
            audio_base64=b64,
            audio_wav_base64=None,
            audio_mp3_base64=b64,
            word_timings=word_timings,
            viseme_events=viseme_events,
            sample_rate=44100,
            format="mp3",
            timing_mode=t_mode,
            provider="elevenlabs",
            voice=_el_voice,
        )
        if _store is not None:
            background_tasks.add_task(
                _store.append_from_response,
                text, "elevenlabs", _resp.timing_mode, _resp.sample_rate,
                _resp.audio_mp3_base64, _resp.word_timings, _resp.viseme_events,
                int((time.monotonic() - t_start) * 1000),
            )
        _tts_obs_inc("success_elevenlabs")
        return _resp

    # --- Microsoft Edge TTS (TTS_PROVIDER=edge|auto) ---
    if not _EDGE_TTS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="edge-tts is not installed on the server.",
        )

    if not _tts_cb_ok():
        logger.warning("Edge TTS circuit open — rejecting request")
        raise HTTPException(
            status_code=503,
            detail="Edge TTS temporarily unavailable (circuit open). Retry shortly or POST /tts-reset-circuit.",
        )

    _tts_obs_inc("requests_total")
    t_start = time.monotonic()

    _ar_voice_req = (payload.ar_voice or "").strip().lower()
    if _ar_voice_req == "female":
        logger.warning("tts-with-timing: ar_voice=female — set EDGE_TTS_VOICE=ar-JO-SanaNeural if needed")

    _voice = edge_tts_voice_name()

    try:
        mp3_bytes = await asyncio.wait_for(
            synthesize_edge_tts_async(text, _voice),
            timeout=float(os.getenv("EDGE_TTS_TIMEOUT_SEC", "120")),
        )
        _tts_cb_record_success()
    except Exception as e:
        _tts_cb_record_failure()
        _tts_obs_inc("errors_edge")
        logger.exception("Edge TTS synthesis failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail=f"Edge TTS failed: {e!s}",
        ) from e

    if not mp3_bytes or len(mp3_bytes) < 32:
        logger.error("Edge TTS returned empty or invalid MP3 payload")
        raise HTTPException(
            status_code=502,
            detail="Edge TTS returned empty audio — synthesis integrity check failed.",
        )

    viseme_events = stub_viseme_timeline_for_text(text)
    word_timings: List[Dict[str, Any]] = []

    b64 = base64.b64encode(mp3_bytes).decode("ascii")
    if not b64:
        raise HTTPException(status_code=502, detail="Edge TTS audio encoding failed.")

    t_mode = "stub"
    ms = int((time.monotonic() - t_start) * 1000)
    audio_b = len(mp3_bytes)
    vis_n = len(viseme_events)
    logger.info(
        "TTS provider=edge | format=mp3 | timing=%s | duration_ms=%d | audio_bytes=%d | viseme_count=%d | word_count=%d",
        t_mode,
        ms,
        audio_b,
        vis_n,
        len(word_timings),
    )

    _resp = TTSResponse(
        audio_base64=b64,
        audio_wav_base64=None,
        audio_mp3_base64=b64,
        word_timings=word_timings,
        viseme_events=viseme_events,
        sample_rate=24000,
        format="mp3",
        timing_mode=t_mode,
        provider=None,
        voice=_voice,
    )
    if _store is not None:
        background_tasks.add_task(
            _store.append_from_response,
            text, "edge", _resp.timing_mode, _resp.sample_rate,
            _resp.audio_mp3_base64, _resp.word_timings, _resp.viseme_events,
            int((time.monotonic() - t_start) * 1000),
        )
    _tts_obs_inc("success_edge")
    return _resp
