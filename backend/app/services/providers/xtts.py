# -*- coding: utf-8 -*-
"""Reserved for Coqui XTTS / GPU TTS — not implemented."""

from __future__ import annotations

from app.services.tts_context import SynthesisContext
from app.services.providers.base import TTSProvider, TTSSynthesisResult


class XTTSTTSProvider(TTSProvider):
    name = "xtts"

    def is_available(self) -> bool:
        return False

    async def synthesize(self, text: str, ctx: SynthesisContext) -> TTSSynthesisResult:
        raise NotImplementedError("XTTS provider not implemented — extend TTS_FALLBACK_CHAIN when ready")
