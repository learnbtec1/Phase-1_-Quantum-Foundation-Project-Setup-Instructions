# -*- coding: utf-8 -*-
"""
Agent WebSocket TTS: single entry for Edge synthesis + viseme repair hooks.

Keeps ``agent_ws`` thin; cancellation is asyncio task cancellation on the caller side.
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

if TYPE_CHECKING:
    from app.services.tts_service import EdgeTTSService

logger = logging.getLogger("cogni.tts_manager")


class AgentTTSManager:
    """Synthesize assistant dialogue to MP3 + cues for one reply turn."""

    async def synthesize_reply(
        self,
        edge_tts: "EdgeTTSService",
        *,
        dialogue: str,
        voice_name: str,
        emotion: str,
        persona_level: str,
        client_voice_rate: float,
        client_pitch_scale: float,
        usage_user_id: Optional[uuid.UUID],
    ) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], str]:
        mp3_bytes, viseme_cues, word_cues, tts_provider, _voice_label = await edge_tts.synthesize(
            dialogue,
            voice_name=voice_name,
            emotion=emotion,
            persona_level=persona_level,
            client_voice_rate=client_voice_rate,
            client_pitch_scale=client_pitch_scale,
            usage_user_id=usage_user_id,
        )
        if tts_provider not in ("edge", "local_piper", "local", "elevenlabs"):
            raise RuntimeError(f"TTS integrity violation: unexpected provider {tts_provider!r}")
        if not mp3_bytes:
            raise RuntimeError("TTS returned empty audio")
        return mp3_bytes, viseme_cues, word_cues, tts_provider

    def repair_visemes_from_words(
        self,
        dialogue: str,
        audio_b64: str,
        viseme_cues: List[Dict[str, Any]],
        word_cues: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """If SDK omitted visemes but word_cues exist, approximate (no extra synthesis)."""
        if audio_b64 and not viseme_cues and word_cues:
            from app.services.tts_service import approx_viseme_cues_from_word_cues

            out = approx_viseme_cues_from_word_cues(word_cues, dialogue)
            logger.info(
                "[AgentTTSManager] viseme timeline from word_cues | approx=%d",
                len(out),
            )
            return out
        return viseme_cues
