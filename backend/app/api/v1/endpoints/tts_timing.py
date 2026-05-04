# -*- coding: utf-8 -*-
"""

TTS-with-timing: POST /api/v1/tts-with-timing



Routed synthesis: ElevenLabs / Edge / Local Piper (+future XTTS) via ``TTSRouter``.

"""

from __future__ import annotations



import base64

import logging

import os

import time

from collections import deque

from threading import Lock

from typing import Any, Dict, List, Optional



from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from pydantic import BaseModel, Field, field_validator



from app.api.deps import get_current_user, get_teacher_user

from app.api.v1.dependencies.phase2_gates import gate_tts_user

from app.models.db_models import User

from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts

from app.services.tts_service import (
    FALLBACK_ELEVENLABS_VOICE_ID,
    _elevenlabs_voice_id,
    edge_tts_voice_name,
    stub_viseme_timeline_for_text,
    stub_word_timings_for_text,
)

from app.services.audio_ffmpeg import AudioFfmpegError, get_audio_duration_ms

from app.services.tts_metrics import snapshot as tts_router_metrics_snapshot

from app.services.tts_router import default_chain_for_mode, get_tts_router

from app.services.tts_context import SynthesisContext

from app.services.tts_exceptions import AllTTSProvidersFailedError, FatalTTSError

from app.services.tts_edge_circuit import tts_cb_record_success, tts_cb_snapshot

from app.services.conversation_store import get_store as _get_store

from app.core.config import settings as _app_settings



try:

    _store = _get_store()

except Exception as _store_exc:  # pragma: no cover

    import logging as _log



    _log.getLogger(__name__).warning("ConversationStore init failed: %s", _store_exc)

    _store = None  # type: ignore[assignment]



logger = logging.getLogger(__name__)





def _tts_allow_fallback() -> bool:

    raw = (os.getenv("TTS_ALLOW_FALLBACK", "true") or "").strip().lower()

    return raw in ("true", "1", "yes")





def _tts_edge_fallback_after_elevenlabs() -> bool:

    raw = (os.getenv("TTS_EDGE_FALLBACK_AFTER_ELEVENLABS", "true") or "").strip().lower()

    return raw in ("true", "1", "yes")





def _effective_tts_provider() -> str:

    return (

        os.getenv("TTS_PROVIDER") or getattr(_app_settings, "TTS_PROVIDER", None) or "edge"

    ).lower().strip()





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

    "success_local_piper": 0,

    "fallback_edge_after_elevenlabs": 0,

    "errors_rate_limited": 0,

    "errors_edge": 0,

    "errors_all_providers": 0,

}





def _tts_obs_inc(key: str) -> None:

    with _OBS_LOCK:

        _tts_obs_counters[key] = _tts_obs_counters.get(key, 0) + 1





@router.get("/tts-observability")

async def tts_observability(_auth: User = Depends(get_current_user)):

    with _OBS_LOCK:

        snap = dict(_tts_obs_counters)

    cb = tts_cb_snapshot()

    env_prov = _effective_tts_provider()

    return {

        "ok": True,

        "counters": snap,

        "router_metrics": tts_router_metrics_snapshot(),

        "tts_circuit": cb,

        "tts_provider_env": env_prov,

        "tts_allow_fallback": _tts_allow_fallback(),

        "tts_edge_fallback_after_elevenlabs": _tts_edge_fallback_after_elevenlabs(),

        "tts_fallback_chain": (os.getenv("TTS_FALLBACK_CHAIN") or "").strip(),

        "local_tts_configured": bool((os.getenv("LOCAL_TTS_URL") or "").strip()),

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

        if s in ("edge", "auto", "elevenlabs", "local"):

            return s

        raise ValueError(

            f"TTS provider {v!r} is not allowed — use 'edge', 'auto', 'elevenlabs', 'local' (or omit). "

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

    provider: Optional[str] = Field(

        default=None,

        description="Which engine produced the audio.",

    )

    provider_used: Optional[str] = Field(

        default=None,

        description="Same as provider; explicit name for observability.",

    )

    duration_ms: Optional[int] = Field(

        default=None,

        description="Decoded MP3 duration in ms (stub lip-sync alignment).",

    )

    audio_bytes: Optional[int] = Field(

        default=None,

        description="Byte length of the MP3 payload.",

    )

    wall_ms: Optional[int] = Field(

        default=None,

        description="Server-side synthesis wall time in ms.",

    )

    voice: Optional[str] = None





@router.post("/tts-reset-circuit")

async def tts_reset_circuit(_auth: User = Depends(get_teacher_user)):

    tts_cb_record_success()

    return {"ok": True, "message": "Edge TTS circuit breaker reset"}





def _success_obs_key(provider_id: str) -> str:

    if provider_id == "elevenlabs":

        return "success_elevenlabs"

    if provider_id == "edge":

        return "success_edge"

    if provider_id in ("local_piper", "local"):

        return "success_local_piper"

    return "success_edge"





@router.post("/tts-with-timing", response_model=TTSResponse)

async def tts_with_timing(

    request: Request,

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



        env_prov = (os.getenv("TTS_PROVIDER", "edge") or "edge").lower().strip()

        if env_prov not in ("edge", "auto", "elevenlabs", "local"):

            logger.error("tts-with-timing: TTS_PROVIDER env=%r is not allowed", env_prov)

            raise HTTPException(

                status_code=503,

                detail="Server misconfiguration: TTS_PROVIDER must be 'edge', 'auto', 'elevenlabs', or 'local'.",

            )



        payload_prov = (payload.provider or "").strip().lower()

        if payload_prov == "edge":

            env_prov = "edge"

        elif payload_prov in ("elevenlabs", "auto", "local") and payload_prov:

            env_prov = payload_prov



        chain = default_chain_for_mode(

            env_prov,

            payload_forces_edge=(payload_prov == "edge"),

            payload_forces_local=(payload_prov == "local"),

            allow_edge_after_elevenlabs=_tts_edge_fallback_after_elevenlabs(),

        )



        _tts_obs_inc("requests_total")

        t_start = time.monotonic()



        rid = getattr(request.state, "request_id", None)

        ctx = SynthesisContext(

            allow_elevenlabs_fallback=_tts_allow_fallback(),

            edge_voice=edge_tts_voice_name(),

            elevenlabs_voice_id=(_elevenlabs_voice_id() or FALLBACK_ELEVENLABS_VOICE_ID).strip(),

            elevenlabs_timeout_sec=float(os.getenv("ELEVENLABS_TTS_TIMEOUT_SEC", "120")),

            edge_timeout_sec=float(os.getenv("EDGE_TTS_TIMEOUT_SEC", "120")),

            local_timeout_sec=float(os.getenv("LOCAL_TTS_TIMEOUT", os.getenv("LOCAL_TTS_TIMEOUT_SEC", "30"))),

            request_id=str(rid) if rid is not None else None,

        )



        router = get_tts_router()

        try:

            result = await router.synthesize(text, ctx, chain)

        except ValueError as e:

            raise HTTPException(status_code=400, detail=str(e)) from e

        except FatalTTSError as e:

            raise HTTPException(status_code=e.status_code, detail=e.detail) from e

        except AllTTSProvidersFailedError as e:

            _tts_obs_inc("errors_all_providers")

            detail = str(e)

            if e.last_error:

                detail = f"{detail} | last_error={type(e.last_error).__name__}: {str(e.last_error)[:320]}"

            raise HTTPException(status_code=502, detail=f"[all_providers_failed] {detail}") from e



        mp3_bytes = result.audio_mp3

        if not mp3_bytes or len(mp3_bytes) < 32:

            raise HTTPException(status_code=502, detail="TTS returned empty audio.")



        provider_used = result.provider_id

        voice_out = result.voice_label

        sample_rate_out = result.sample_rate



        if provider_used == "edge" and env_prov == "elevenlabs":

            _tts_obs_inc("fallback_edge_after_elevenlabs")



        try:
            duration_ms = get_audio_duration_ms(mp3_bytes)
        except AudioFfmpegError as e:
            raise HTTPException(
                status_code=502,
                detail=f"TTS duration probe failed (install ffmpeg/ffprobe): {e}",
            ) from e

        word_timings: List[Dict[str, Any]] = stub_word_timings_for_text(text, duration_ms)

        b64 = base64.b64encode(mp3_bytes).decode("ascii")

        if not b64:

            raise HTTPException(status_code=502, detail="TTS audio base64 encoding failed.")



        viseme_events = stub_viseme_timeline_for_text(text, duration_ms)

        t_mode = "stub"

        ms = int((time.monotonic() - t_start) * 1000)

        audio_b = len(mp3_bytes)

        vis_n = len(viseme_events)



        logger.info(

            "TTS provider=%s | format=mp3 | timing=%s | wall_ms=%d | duration_ms=%d | audio_bytes=%d | viseme_count=%d | word_count=%d",

            provider_used,

            t_mode,

            ms,

            duration_ms,

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

        _tts_obs_inc(_success_obs_key(provider_used))

        return _resp



    except HTTPException:

        raise

    except Exception as _tts_unhandled_exc:

        logger.exception("tts-with-timing: unhandled exception")

        raise HTTPException(

            status_code=502,

            detail=f"[tts_internal] {type(_tts_unhandled_exc).__name__}: {str(_tts_unhandled_exc)[:450]}",

        ) from _tts_unhandled_exc

