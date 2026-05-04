# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging

from app.services.audio_ffmpeg import TARGET_TTS_SAMPLE_RATE_HZ, normalize_mp3_to_24k_hz
from app.services.tts_context import SynthesisContext
from app.services.tts_edge_circuit import (
    tts_cb_ok,
    tts_cb_record_edge_forbidden,
    tts_cb_record_failure,
    tts_cb_record_success,
)
from app.services.providers.base import TTSProvider, TTSSynthesisResult
from app.services.tts_service import _EDGE_TTS_AVAILABLE, synthesize_edge_tts_async

logger = logging.getLogger(__name__)


class EdgeTTSProvider(TTSProvider):
    name = "edge"

    def is_available(self) -> bool:
        return bool(_EDGE_TTS_AVAILABLE)

    async def is_healthy(self) -> bool:
        if not self.is_available():
            return False
        return tts_cb_ok()

    async def synthesize(self, text: str, ctx: SynthesisContext) -> TTSSynthesisResult:
        if not self.is_available():
            raise RuntimeError("edge-tts is not installed")
        if not tts_cb_ok():
            raise RuntimeError("Edge TTS circuit is open")
        voice = ctx.edge_voice
        try:
            mp3 = await asyncio.wait_for(
                synthesize_edge_tts_async(text, voice),
                timeout=ctx.edge_timeout_sec,
            )
            if not mp3 or len(mp3) < 32:
                raise RuntimeError("Edge TTS returned empty audio")
            mp3 = normalize_mp3_to_24k_hz(mp3)
            if not mp3 or len(mp3) < 32:
                raise RuntimeError("Edge TTS returned empty audio")
            tts_cb_record_success()
            return TTSSynthesisResult(
                audio_mp3=mp3,
                provider_id="edge",
                sample_rate=TARGET_TTS_SAMPLE_RATE_HZ,
                voice_label=voice,
            )
        except TimeoutError:
            tts_cb_record_failure()
            raise
        except Exception as e:
            if "[edge_forbidden]" in str(e):
                tts_cb_record_edge_forbidden()
            else:
                tts_cb_record_failure()
            raise
