# -*- coding: utf-8 -*-
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.tts_context import SynthesisContext


@dataclass(frozen=True)
class TTSSynthesisResult:
    """Unified MP3 payload for /tts-with-timing and WebSocket paths."""

    audio_mp3: bytes
    provider_id: str
    sample_rate: int
    voice_label: str


class TTSProvider(ABC):
    """Pluggable TTS backend — no shell subprocess in implementations that spawn CLIs."""

    name: str = "base"

    @abstractmethod
    def is_available(self) -> bool:
        """Whether this provider can be invoked in the current environment."""

    async def is_healthy(self) -> bool:
        """Live probe before this turn (circuit / HTTP / dependency health). Default: same as available."""
        return self.is_available()

    @abstractmethod
    async def synthesize(self, text: str, ctx: "SynthesisContext") -> TTSSynthesisResult:
        """Return MP3 bytes and metadata."""
