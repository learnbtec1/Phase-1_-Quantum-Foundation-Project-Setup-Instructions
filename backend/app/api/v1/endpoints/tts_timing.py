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
import re
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
    estimate_mp3_duration_ms,
    stub_viseme_timeline_for_text,
    synthesize_edge_tts_async,
    synthesize_elevenlabs_async,
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

_EL_HTTP_RE = re.compile(r"ElevenLabs HTTP (\d+)")


def _elevenlabs_failure_meta(exc: BaseException) -> tuple[str, str, Optional[int]]:
    """
    Machine-oriented (code), human message, and suggested HTTP status when EL fails without fallback.
    """
    typ = type(exc).__name__
    msg = str(exc).strip()
    if isinstance(exc, TimeoutError):
        return (
            "timeout",
            f"ElevenLabs TTS timed out ({typ}).",
            504,
        )
    m = _EL_HTTP_RE.search(msg)
    if m:
        sc = int(m.group(1))
        if sc == 401:
            return ("auth_401", "ElevenLabs API key rejected or missing (401).", 401)
        if sc == 403:
            return ("auth_403", "ElevenLabs API access forbidden for this key (403).", 403)
        if sc == 429:
            return ("quota_429", "ElevenLabs rate limit or quota exceeded (429).", 429)
        if sc in (502, 503, 504):
            return (f"upstream_{sc}", f"ElevenLabs upstream error ({sc}).", sc)
        if 400 <= sc < 500:
            return (f"client_{sc}", f"ElevenLabs client error ({sc}): {msg[:200]}", sc)
        return (f"http_{sc}", f"ElevenLabs HTTP error ({sc}): {msg[:200]}", 502)
    return ("unknown", f"ElevenLabs TTS failed ({typ}): {msg[:400]}", 502)


def _tts_allow_fallback() -> bool:
    """When False, ElevenLabs failures surface as 502 with no Edge fallback (debug / strict EL-only)."""
    raw = (os.getenv("TTS_ALLOW_FALLBACK", "true") or "").strip().lower()
    return raw in ("true", "1", "yes")


def _tts_edge_fallback_after_elevenlabs() -> bool:
    """
    When False, do not call Edge after ElevenLabs fails (datacenter IPs often get HTTP 403 on Edge WS).
    Set TTS_EDGE_FALLBACK_AFTER_ELEVENLABS=false on cloud hosts and fix ElevenLabs keys instead.
    """
    raw = (os.getenv("TTS_EDGE_FALLBACK_AFTER_ELEVENLABS", "true") or "").strip().lower()
    return raw in ("true", "1", "yes")


def _effective_tts_provider() -> str:
    """Match app.main / docker: env wins, then Settings (pydantic .env), default edge."""
    return (
        os.getenv("TTS_PROVIDER") or getattr(_app_settings, "TTS_PROVIDER", None) or "edge"
    ).lower().strip()


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
    "success_elevenlabs": 0,
    "fallback_edge_after_elevenlabs": 0,
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
    env_prov = _effective_tts_provider()
    return {
        "ok": True,
        "counters": snap,
        "tts_circuit": cb,
        "tts_provider_env": env_prov,
        "tts_allow_fallback": _tts_allow_fallback(),
        "tts_edge_fallback_after_elevenlabs": _tts_edge_fallback_after_elevenlabs(),
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
    provider: Optional[str] = Field(
        default=None,
        description="Which engine produced the audio (edge or elevenlabs).",
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
    _tts_cb_record_success()
    return {"ok": True, "message": "Edge TTS circuit breaker reset"}


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
            allow_fb = _tts_allow_fallback()

            mp3_bytes: Optional[bytes] = None
            provider_used = "elevenlabs"
            voice_out = _el_voice
            sample_rate_out = 44100
            el_err: Optional[Exception] = None

            try:
                mp3_bytes = await asyncio.wait_for(
                    synthesize_elevenlabs_async(text),
                    timeout=float(os.getenv("ELEVENLABS_TTS_TIMEOUT_SEC", "120")),
                )
                if not mp3_bytes or len(mp3_bytes) < 32:
                    raise RuntimeError("ElevenLabs returned empty or invalid audio")
            except Exception as e:
                el_err = e
                code, human, http_status = _elevenlabs_failure_meta(e)
                logger.warning(
                    "[TTS] ElevenLabs failed | exc_type=%s | tts_error_code=%s | human=%s | "
                    "text_len=%d | allow_fallback=%s | raw=%s",
                    type(e).__name__,
                    code,
                    human[:280],
                    len(text),
                    allow_fb,
                    str(e)[:400],
                )
                if not allow_fb:
                    logger.error(
                        "[TTS] ElevenLabs failed and TTS_ALLOW_FALLBACK=false — not using Edge "
                        "(exc_type=%s, tts_error_code=%s).",
                        type(e).__name__,
                        code,
                    )
                    status = int(http_status or 502)
                    raise HTTPException(status_code=status, detail=f"[{code}] {human}") from e
                mp3_bytes = None

            if not mp3_bytes or len(mp3_bytes) < 32:
                if not allow_fb:
                    raise HTTPException(
                        status_code=502,
                        detail="ElevenLabs returned empty audio — synthesis integrity check failed.",
                    )
                if not _EDGE_TTS_AVAILABLE:
                    logger.error(
                        "[TTS] ElevenLabs failed or empty; edge-tts not installed — cannot fallback.",
                    )
                    raise HTTPException(
                        status_code=503,
                        detail="ElevenLabs failed (check ELEVENLABS_API_KEY in the container) "
                        "and Edge TTS is not installed — install edge-tts or fix API keys.",
                    )
                if not _tts_edge_fallback_after_elevenlabs():
                    if el_err:
                        code, human, http_status = _elevenlabs_failure_meta(el_err)
                        logger.error(
                            "[TTS] ElevenLabs failed; Edge fallback disabled "
                            "(TTS_EDGE_FALLBACK_AFTER_ELEVENLABS=false) | %s",
                            human[:300],
                        )
                        raise HTTPException(
                            status_code=int(http_status or 502),
                            detail=f"[{code}] {human}",
                        ) from el_err
                    raise HTTPException(
                        status_code=502,
                        detail="ElevenLabs returned empty audio — Edge fallback disabled "
                        "(set TTS_EDGE_FALLBACK_AFTER_ELEVENLABS=true only if Edge works from this host).",
                    )
                _voice_fb = edge_tts_voice_name()
                try:
                    logger.info(
                        "[TTS] Edge fallback after ElevenLabs | voice=%s | text_len=%d | prior=%s",
                        _voice_fb,
                        len(text),
                        str(el_err) if el_err else "empty_or_short_audio",
                    )
                    mp3_bytes = await asyncio.wait_for(
                        synthesize_edge_tts_async(text, _voice_fb),
                        timeout=float(os.getenv("EDGE_TTS_TIMEOUT_SEC", "120")),
                    )
                    _tts_cb_record_success()
                    provider_used = "edge"
                    voice_out = _voice_fb
                    sample_rate_out = 24000
                    _tts_obs_inc("fallback_edge_after_elevenlabs")
                except Exception as e2:
                    _tts_cb_record_failure()
                    _tts_obs_inc("errors_edge")
                    el_primary = (
                        f"{type(el_err).__name__}: {str(el_err)[:420]}"
                        if el_err
                        else "ElevenLabs returned empty or short audio"
                    )
                    if isinstance(e2, TimeoutError):
                        fb_code, fb_human, status_fb = (
                            "edge_timeout",
                            "Edge TTS timed out during fallback.",
                            504,
                        )
                    else:
                        fb_code = "edge_fallback_failed"
                        fb_human = f"Edge TTS: {str(e2)[:400]}"
                        # 502 when both providers failed — primary fix is almost always ElevenLabs / keys.
                        status_fb = 502 if el_err else 503
                    logger.exception(
                        "[TTS] Edge fallback failed | exc_type=%s | tts_error_code=%s | human=%s | text_len=%d",
                        type(e2).__name__,
                        fb_code,
                        fb_human[:200],
                        len(text),
                    )
                    combined = (
                        f"[{fb_code}] PRIMARY (fix ElevenLabs first): {el_primary} | "
                        f"SECONDARY (Edge fallback): {fb_human}"
                    )
                    raise HTTPException(
                        status_code=status_fb,
                        detail=combined,
                    ) from e2

            if not mp3_bytes or len(mp3_bytes) < 32:
                raise HTTPException(
                    status_code=502,
                    detail="TTS returned empty audio after ElevenLabs and Edge attempts.",
                )

            # Single source of truth for lip-sync stub: duration from the **final** MP3 bytes (EL or Edge).
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
            if provider_used == "elevenlabs":
                _tts_obs_inc("success_elevenlabs")
            else:
                _tts_obs_inc("success_edge")
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
        except TimeoutError as e:
            _tts_cb_record_failure()
            _tts_obs_inc("errors_edge")
            logger.warning(
                "[TTS] Edge TTS timed out | exc_type=%s | tts_error_code=edge_timeout | text_len=%d",
                type(e).__name__,
                len(text),
            )
            raise HTTPException(
                status_code=504,
                detail="[edge_timeout] Edge TTS synthesis timed out.",
            ) from e
        except Exception as e:
            _tts_cb_record_failure()
            _tts_obs_inc("errors_edge")
            logger.exception(
                "[TTS] Edge TTS synthesis failed | exc_type=%s | tts_error_code=edge_error | err=%s",
                type(e).__name__,
                str(e)[:400],
            )
            raise HTTPException(
                status_code=502,
                detail=f"[edge_error] Edge TTS failed: {e!s}",
            ) from e

        if not mp3_bytes or len(mp3_bytes) < 32:
            logger.error("Edge TTS returned empty or invalid MP3 payload")
            raise HTTPException(
                status_code=502,
                detail="Edge TTS returned empty audio — synthesis integrity check failed.",
            )

        word_timings: List[Dict[str, Any]] = []

        b64 = base64.b64encode(mp3_bytes).decode("ascii")
        if not b64:
            raise HTTPException(status_code=502, detail="Edge TTS audio encoding failed.")

        duration_mp3_ms = estimate_mp3_duration_ms(mp3_bytes)
        viseme_events = stub_viseme_timeline_for_text(
            text,
            duration_mp3_ms,
        )

        t_mode = "stub"
        ms = int((time.monotonic() - t_start) * 1000)
        audio_b = len(mp3_bytes)
        vis_n = len(viseme_events)
        logger.info(
            "TTS provider=edge | format=mp3 | timing=%s | wall_ms=%d | duration_ms=%d | audio_bytes=%d | viseme_count=%d | word_count=%d",
            t_mode,
            ms,
            duration_mp3_ms,
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
            provider="edge",
            provider_used="edge",
            duration_ms=duration_mp3_ms,
            audio_bytes=audio_b,
            wall_ms=ms,
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

    except HTTPException:
        raise
    except Exception as _tts_unhandled_exc:
        logger.exception("tts-with-timing: unhandled exception")
        raise HTTPException(
            status_code=502,
            detail=f"[tts_internal] {type(_tts_unhandled_exc).__name__}: {str(_tts_unhandled_exc)[:450]}",
        ) from _tts_unhandled_exc
