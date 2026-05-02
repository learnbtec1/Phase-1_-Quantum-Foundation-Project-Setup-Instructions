# -*- coding: utf-8 -*-
"""
TTS-with-timing: POST /api/v1/tts-with-timing

Microsoft Edge TTS (`edge-tts`) only — no ElevenLabs, no paid API keys.
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
from app.db.models import User
from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts
from app.services.tts_service import (
    EDGE_TTS_VOICE_LOCKED_GLOBAL,
    estimate_mp3_duration_ms,
    stub_viseme_timeline_for_text,
    synthesize_edge_tts_async,
)
from app.services.conversation_store import get_store as _get_store
from app.core.config import settings as _app_settings

try:
    _store = _get_store()
except Exception as _store_exc:  # pragma: no cover
    import logging as _log

    _log.getLogger(__name__).warning("ConversationStore init failed: %s", _store_exc)
    _store = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

DEFAULT_EDGE_VOICE_PRIMARY = EDGE_TTS_VOICE_LOCKED_GLOBAL


def _tts_env_voice_hint() -> str:
    """Diagnostics only — `/tts-with-timing` never branches routing on ``TTS_PROVIDER``."""
    return (
        os.getenv("TTS_PROVIDER") or getattr(_app_settings, "TTS_PROVIDER", "") or ""
    ).strip()


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
                _cb_failures,
                _CB_COOLDOWN,
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
    "success_elevenlabs": 0,
    "fallback_edge_after_elevenlabs": 0,
    "errors_rate_limited": 0,
    "errors_edge": 0,
    "fallback_voice_after_primary": 0,
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
    return {
        "ok": True,
        "counters": snap,
        "tts_circuit": cb,
        "tts_route": "edge_forced_always",
        "tts_provider_env_hint": _tts_env_voice_hint() or None,
        "tts_allow_fallback": False,
        "tts_primary": "microsoft_edge_online",
    }


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voice: Optional[str] = Field(default=None)
    speed: Optional[float] = Field(default=1.0, ge=0.25, le=4.0)
    emotion: Optional[str] = Field(default="neutral")
    emotion_intensity: Optional[float] = Field(
        default=0.72,
        ge=0.0,
        le=1.0,
        description="Reserved for persona metadata (ignored by Edge synth).",
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
    def _provider_coerce_legacy(cls, v: object) -> Optional[str]:
        """Inbound ``provider`` is ignored for routing — Edge synthesis always."""
        if v is None or v == "":
            return None
        s = str(v).strip().lower()
        return s[:64] if s else None


class TTSResponse(BaseModel):
    audio_base64: str
    audio_wav_base64: Optional[str] = None
    audio_mp3_base64: Optional[str] = None
    word_timings: List[Dict[str, Any]] = []
    viseme_events: List[Dict[str, Any]] = []
    sample_rate: int = 44100
    format: str = "mp3"
    timing_mode: str = "stub"
    provider: Optional[str] = Field(default=None, description="edge")
    provider_used: Optional[str] = Field(default=None)
    duration_ms: Optional[int] = None
    audio_bytes: Optional[int] = None
    wall_ms: Optional[int] = None
    voice: Optional[str] = None


def _resolve_edge_voice(payload: TTSRequest) -> str:
    """Prefer explicit Neural id on request; else EDGE_TTS_VOICE / TTS_ARABIC_VOICE; never fail on missing env."""
    pv = (payload.voice or "").strip()
    if pv and pv != "am_michael" and "Neural" in pv:
        return pv
    env_v = (
        (os.getenv("EDGE_TTS_VOICE") or "").strip()
        or (os.getenv("TTS_ARABIC_VOICE") or "").strip()
    )
    if env_v:
        return env_v
    return DEFAULT_EDGE_VOICE_PRIMARY


def _fallback_edge_voice() -> str:
    return (os.getenv("EDGE_TTS_FALLBACK_VOICE") or DEFAULT_EDGE_VOICE_FALLBACK).strip()


@router.post("/tts-reset-circuit")
async def tts_reset_circuit(_auth: User = Depends(get_teacher_user)):
    _tts_cb_record_success()
    return {"ok": True, "message": "Edge TTS circuit breaker reset"}


async def _synthesize_mp3_locked_voice(text: str, _primary_voice: str) -> tuple[bytes, str]:
    """Single Edge voice only — no alternate-voice fallback chain."""
    timeout_sec = float(os.getenv("EDGE_TTS_TIMEOUT_SEC", "120"))
    v = EDGE_TTS_VOICE_LOCKED_GLOBAL
    raw = await asyncio.wait_for(synthesize_edge_tts_async(text, v), timeout=timeout_sec)
    if not raw or len(raw) < 32:
        raise RuntimeError("Edge TTS returned empty or invalid audio")
    return raw, v


@router.post("/tts-with-timing", response_model=TTSResponse)
async def tts_with_timing(
    payload: TTSRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(gate_tts_user),
):
    try:
        text = (payload.text or "").strip()
        text = maybe_correct_egyptian_for_tts(text, context="tts_with_timing")
        if not text:
            raise HTTPException(status_code=400, detail="Empty text")

        if not _rate_limit_ok(str(user.id)):
            _tts_obs_inc("errors_rate_limited")
            raise HTTPException(status_code=429, detail="Rate limit exceeded (3 req/s per user)")

        if not _tts_cb_ok():
            logger.warning(
                "tts-with-timing: Edge circuit OPEN — proceeding with synthesis anyway (no hard 503 here)",
            )

        voice_sel = _resolve_edge_voice(payload)
        provider_used = "edge"
        print("[EDGE TTS FORCED] voice=", voice_sel, flush=True)

        _tts_obs_inc("requests_total")
        t_start = time.monotonic()
        sample_rate_out = 44100

        try:
            mp3_bytes, voice_out = await _synthesize_mp3_locked_voice(text, voice_sel)
        except Exception as e:
            _tts_cb_record_failure()
            human = str(e).strip()[:500] if e else ""
            logger.error("Edge TTS synthesis failed | %s | %s", voice_sel, human)
            _tts_obs_inc("errors_edge")
            status_code = 502
            detail = "[edge_error] Edge TTS failed — " + (human or repr(type(e).__name__))
            if "[EDGE_TTS_FAILSAFE]" in human:
                detail = "[EDGE_TTS_FAILSAFE] empty_or_too_small_audio"
            elif "EDGE returned empty audio" in human:
                detail = "EDGE returned empty audio"
            raise HTTPException(status_code=status_code, detail=detail[:1200]) from e

        try:
            _cfg_raw = os.getenv("EDGE_TTS_MIN_AUDIO_BYTES", "1200")
            _cfg = int(_cfg_raw)
        except (TypeError, ValueError):
            _cfg = 1200
        _configured = max(512, min(8_000_000, _cfg))
        _min_mp3 = max(1000, _configured)
        if not mp3_bytes or len(mp3_bytes) < _min_mp3:
            _tts_cb_record_failure()
            _tts_obs_inc("errors_edge")
            logger.error(
                "Edge TTS failsafe: payload too small | bytes=%s | min=%s | voice=%s",
                len(mp3_bytes or b""),
                _min_mp3,
                voice_out,
            )
            raise HTTPException(
                status_code=502,
                detail="[EDGE_TTS_FAILSAFE] empty_or_too_small_audio",
            )

        _tts_cb_record_success()

        duration_ms = estimate_mp3_duration_ms(mp3_bytes)
        word_timings: List[Dict[str, Any]] = []
        b64 = base64.b64encode(mp3_bytes).decode("ascii")
        if not b64:
            raise HTTPException(status_code=502, detail="TTS audio base64 encoding failed.")

        viseme_events = stub_viseme_timeline_for_text(text, duration_ms)
        t_mode = "stub"
        ms = int((time.monotonic() - t_start) * 1000)
        audio_b = len(mp3_bytes)
        vis_n = len(viseme_events)
        logger.info(
            (
                "TTS provider=%s | format=mp3 | timing=%s | wall_ms=%d | duration_ms=%d | "
                "audio_bytes=%d | viseme_count=%d | word_count=%d | voice=%s"
            ),
            provider_used,
            t_mode,
            ms,
            duration_ms,
            audio_b,
            vis_n,
            len(word_timings),
            voice_out,
        )

        _resp = TTSResponse(
            audio_base64=b64,
            audio_wav_base64=None,
            audio_mp3_base64=b64,
            word_timings=word_timings,
            viseme_events=viseme_events,
            sample_rate=sample_rate_out,
            format="mp3",
            timing_mode=t_mode,
            provider=provider_used,
            provider_used=provider_used,
            duration_ms=duration_ms,
            audio_bytes=audio_b,
            wall_ms=ms,
            voice=voice_out,
        )
        if _store is not None:
            background_tasks.add_task(
                _store.append_from_response,
                text,
                provider_used,
                _resp.timing_mode,
                _resp.sample_rate,
                _resp.audio_mp3_base64,
                _resp.word_timings,
                _resp.viseme_events,
                int((time.monotonic() - t_start) * 1000),
            )
        _tts_obs_inc("success_edge")
        return _resp

    except HTTPException:
        raise
    except Exception as _tts_unhandled_exc:
        logger.exception("tts-with-timing: unhandled exception")
        raise HTTPException(
            status_code=502,
            detail=(
                "[tts_internal] "
                + f"{type(_tts_unhandled_exc).__name__}: {str(_tts_unhandled_exc)[:450]}"
            ),
        ) from _tts_unhandled_exc
