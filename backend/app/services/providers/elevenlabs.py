# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
import os
import re

from app.services.audio_ffmpeg import TARGET_TTS_SAMPLE_RATE_HZ, normalize_mp3_to_24k_hz
from app.services.tts_context import SynthesisContext
from app.services.tts_exceptions import FatalTTSError
from app.services.providers.base import TTSProvider, TTSSynthesisResult
from app.services.tts_service import (
    _elevenlabs_api_key,
    synthesize_elevenlabs_async,
)

logger = logging.getLogger(__name__)

_EL_HTTP_RE = re.compile(r"ElevenLabs HTTP (\d+)")


def _elevenlabs_failure_meta(exc: Exception) -> tuple[str, str, int | None]:
    typ = type(exc).__name__
    msg = str(exc).strip()
    if isinstance(exc, TimeoutError):
        return ("timeout", f"ElevenLabs TTS timed out ({typ}).", 504)
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


class ElevenLabsTTSProvider(TTSProvider):
    name = "elevenlabs"

    def is_available(self) -> bool:
        return bool((_elevenlabs_api_key() or "").strip())

    async def synthesize(self, text: str, ctx: SynthesisContext) -> TTSSynthesisResult:
        if not self.is_available():
            raise RuntimeError("ElevenLabs API key not configured")
        allow_fb = (
            (os.getenv("TTS_ALLOW_FALLBACK", "true") or "").strip().lower()
            in ("true", "1", "yes")
        )
        try:
            mp3 = await asyncio.wait_for(
                synthesize_elevenlabs_async(text),
                timeout=ctx.elevenlabs_timeout_sec,
            )
            if not mp3 or len(mp3) < 32:
                raise RuntimeError("ElevenLabs returned empty or invalid audio")
            mp3 = normalize_mp3_to_24k_hz(mp3)
            if not mp3 or len(mp3) < 32:
                raise RuntimeError("ElevenLabs returned empty or invalid audio")
            return TTSSynthesisResult(
                audio_mp3=mp3,
                provider_id="elevenlabs",
                sample_rate=TARGET_TTS_SAMPLE_RATE_HZ,
                voice_label=ctx.elevenlabs_voice_id,
            )
        except Exception as e:
            code, human, http_status = _elevenlabs_failure_meta(e)
            logger.warning(
                "[TTS] ElevenLabs failed | code=%s | allow_fallback=%s | %s",
                code,
                allow_fb,
                human[:240],
            )
            if not allow_fb:
                raise FatalTTSError(
                    int(http_status or 502),
                    f"[{code}] {human}",
                ) from e
            raise
