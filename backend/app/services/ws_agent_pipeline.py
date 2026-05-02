# -*- coding: utf-8 -*-
"""
Cogni `/ws/agent` audio turn — Whisper ASR + lightweight chat reply for the realtime stub.

Does not replace a dedicated Cogni agent service; keeps failures explicit (`asr_error` frames).
"""

from __future__ import annotations

import base64
import io
import logging
import uuid
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def _suffix_from_mime(mime_hint: str) -> str:
    m = (mime_hint or "").lower()
    if "wav" in m:
        return ".wav"
    if "mp3" in m or "mpeg" in m:
        return ".mp3"
    if "ogg" in m:
        return ".ogg"
    if "mp4" in m or "m4a" in m:
        return ".m4a"
    if "webm" in m:
        return ".webm"
    return ".webm"


def process_agent_audio_turn(msg: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Build outbound WS JSON frames for one mic segment (`type: audio`).

    First frame should be preceded by `thinking` from the caller when desired.
    """
    raw_b64 = msg.get("data")
    if not isinstance(raw_b64, str) or not raw_b64.strip():
        return [{"type": "asr_error", "v": 1.1, "detail": "missing_audio_data"}]

    try:
        pcm = base64.b64decode(raw_b64, validate=False)
    except Exception:
        return [{"type": "asr_error", "v": 1.1, "detail": "invalid_base64"}]

    mime = str(msg.get("mime_type") or "")
    logger.info(
        "ws/agent pipeline: received audio frame bytes=%s mime=%s",
        len(pcm),
        mime[:128] if mime else "?",
    )

    if len(pcm) < 256:
        return [{"type": "asr_error", "v": 1.1, "detail": "audio_too_short"}]

    key = (settings.OPENAI_API_KEY or "").strip()
    if not key:
        return [{"type": "asr_error", "v": 1.1, "detail": "OPENAI_API_KEY not configured"}]

    suffix = _suffix_from_mime(mime)
    transcript: str | None = None
    try:
        from openai import OpenAI

        bio = io.BytesIO(pcm)
        bio.name = f"speech{suffix}"
        client = OpenAI(api_key=key)
        # Fixed Arabic — avoids English/Latin hallucinations when audio is ambiguous.
        tr = client.audio.transcriptions.create(
            model="whisper-1",
            file=bio,
            language="ar",
        )
        transcript = (getattr(tr, "text", None) or "").strip() or None
    except Exception as e:
        logger.warning("ws/agent pipeline: Whisper failed: %s", e)
        return [{"type": "asr_error", "v": 1.1, "detail": "transcription_failed"}]

    if not transcript:
        return [{"type": "asr_error", "v": 1.1, "detail": "empty_transcript"}]

    sys_prompt = str(msg.get("persona_system_prompt") or msg.get("system_prompt") or "").strip()
    dialogue: str | None = None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=key)
        model = (settings.OPENAI_CHAT_MODEL or "gpt-4o-mini").strip()
        usr_clean = transcript[:8000]
        sys_clean = sys_prompt[:12000] if sys_prompt else "You are a helpful teaching assistant."
        r = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_clean},
                {"role": "user", "content": usr_clean},
            ],
            max_tokens=512,
            temperature=0.7,
        )
        raw_msg = r.choices[0].message.content if r.choices else None
        dialogue = (raw_msg or "").strip() or None
    except Exception as e:
        logger.warning("ws/agent pipeline: chat completion failed: %s", e)
        dialogue = (
            "I'm having trouble generating a reply right now. "
            f"I heard you say: {transcript[:400]}"
        )

    tid = str(uuid.uuid4())
    out_text = dialogue if dialogue else transcript
    return [
        {
            "type": "speech",
            "v": 1.1,
            "turn_id": tid,
            "transcript": transcript,
            "dialogue": out_text,
            "emotion": "neutral",
        }
    ]


def process_agent_text_turn(msg: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Handle `{ type: \"text\", ... }` from the Cogni client when the user types instead of using the mic.
    Same outbound shape as audio (`speech` frame) so `useAgentAgent` can drive TTS / avatar.
    """
    raw = str(msg.get("text") or "").strip()
    if not raw:
        return [{"type": "asr_error", "v": 1.1, "detail": "empty_text"}]

    key = (settings.OPENAI_API_KEY or "").strip()
    if not key:
        return [{"type": "asr_error", "v": 1.1, "detail": "OPENAI_API_KEY not configured"}]

    sys_prompt = str(msg.get("persona_system_prompt") or msg.get("system_prompt") or "").strip()
    dialogue: str | None = None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=key)
        model = (settings.OPENAI_CHAT_MODEL or "gpt-4o-mini").strip()
        usr_clean = raw[:8000]
        sys_clean = sys_prompt[:12000] if sys_prompt else "You are a helpful teaching assistant."
        r = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_clean},
                {"role": "user", "content": usr_clean},
            ],
            max_tokens=512,
            temperature=0.7,
        )
        raw_msg = r.choices[0].message.content if r.choices else None
        dialogue = (raw_msg or "").strip() or None
    except Exception as e:
        logger.warning("ws/agent pipeline: text-turn chat failed: %s", e)
        dialogue = (
            "I'm having trouble generating a reply right now. "
            f"You wrote: {raw[:400]}"
        )

    tid = str(uuid.uuid4())
    out_text = dialogue if dialogue else raw
    return [
        {
            "type": "speech",
            "v": 1.1,
            "turn_id": tid,
            "transcript": raw,
            "dialogue": out_text,
            "emotion": "neutral",
        }
    ]
