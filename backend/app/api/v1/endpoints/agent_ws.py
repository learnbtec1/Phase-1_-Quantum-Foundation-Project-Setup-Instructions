# -*- coding: utf-8 -*-
"""
Agent WebSocket endpoint: ws://localhost:8000/ws/agent

Handles real-time voice/text conversation with the Dr. Hamza avatar agent.

Message protocol (client → server):
  { "type": "ping" }
  { "type": "audio", "data": "<base64 WAV>" }
  { "type": "text",  "message": "<text>" }
  { "type": "clear" }

Message protocol (server → client):
  { "type": "pong" }
  { "type": "transcribing" }
  { "type": "llm_thinking" }
  { "type": "speech",          "transcript": "...", "reply": "...", "dialogue": "...",
                                "emotion": "...", "action": "...",
                                "audio_base64": "...", "sample_rate": 24000 }
  { "type": "tts_unavailable", "transcript": "...", "reply": "...", "dialogue": "...",
                                "emotion": "...", "action": "..." }
  { "type": "error",           "error": { "message": "...", "severity": "error|warn" } }
  { "type": "cleared" }
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["Agent WebSocket"])

# ── Shared helpers (same logic as chat.py) ───────────────────────────────────

ALLOWED_EMOTIONS = {
    'neutral', 'friendly', 'thinking', 'encouraging', 'strict',
    'celebrate', 'celebration', 'happy', 'sad', 'angry', 'excited',
    'surprised', 'relaxed', 'calm', 'proud', 'curious', 'attentive',
    'concerned', 'sleepy', 'bored', 'anxious',
}

_ACTION_DEFAULTS: dict[str, str] = {
    'celebrate':   'يلوح بيديه بحماس ويبتسم ابتسامة عريضة',
    'encouraging': 'يفتح كفيه بلطف ويحرّك ذراعيه للأمام',
    'thinking':    'يميل رأسه قليلاً وعيناه تتأملان',
    'strict':      'يشير بإصبعه بثقة وينظر للأمام مباشرة',
    'friendly':    'يبتسم بلطف ويميل رأسه قليلاً',
    'neutral':     'يومئ برأسه برفق',
}


def _verify_format(text: str) -> bool:
    return (
        bool(re.search(r'\*[^*]+\*', text)) and
        bool(re.search(r'\[EMOTION:\s*\w+\]', text))
    )


def _infer_emotion(text: str) -> str:
    emotion_keywords = [
        (re.compile(r'مبروك|ممتاز|رائع|أحسنت|برافو|🎉', re.I), 'celebrate'),
        (re.compile(r'يلا|همة|تقدر|ثقتي فيك|جرب|نبلش', re.I), 'encouraging'),
        (re.compile(r'فكر|اشرح|يعني|خليني|دقيقة|بفهم', re.I), 'thinking'),
        (re.compile(r'تنبه|لازم|مهم|ركز|ضروري', re.I), 'strict'),
        (re.compile(r'أهلين|كيفك|شو اخبارك|حياك|أهلاً', re.I), 'friendly'),
    ]
    for pattern, emotion in emotion_keywords:
        if pattern.search(text):
            return emotion
    return 'friendly'


def _patch_format(text: str) -> str:
    emotion_match = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    emotion = emotion_match.group(1).lower() if emotion_match else _infer_emotion(text)
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    cleaned = re.sub(r'\s*\[EMOTION:\s*\w+\]', '', text).rstrip()
    if not re.search(r'\*[^*]+\*', cleaned):
        lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
        if len(lines) >= 2:
            bare_action = lines.pop()
            cleaned = '\n'.join(lines)
        else:
            bare_action = _ACTION_DEFAULTS.get(emotion, _ACTION_DEFAULTS['neutral'])
        cleaned += f'\n*{bare_action}*'
    return cleaned + f'\n[EMOTION: {emotion}]'


def _parse_reply(text: str) -> dict:
    action_m  = re.search(r'\*([^*]+)\*', text)
    emotion_m = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    action    = action_m.group(1).strip()  if action_m  else _ACTION_DEFAULTS['neutral']
    emotion   = emotion_m.group(1).lower() if emotion_m else 'friendly'
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    dialogue  = re.sub(r'\*[^*]+\*', '', text)
    dialogue  = re.sub(r'\[EMOTION:\s*\w+\]', '', dialogue).strip()
    return {'dialogue': dialogue, 'action': action, 'emotion': emotion}


# ── Main endpoint ────────────────────────────────────────────────────────────

@router.websocket("/agent")
async def agent_ws(websocket: WebSocket):
    """
    Real-time avatar agent:
      audio → Whisper STT → Dr. Hamza LLM → tts_arabic TTS → avatar
      text  →               Dr. Hamza LLM → tts_arabic TTS → avatar
    """
    await websocket.accept()
    logger.info("Agent WebSocket connected: %s", websocket.client)

    # Per-connection conversation history (last 6 turns = 3 exchanges)
    history: List[dict] = []

    async def send(payload: dict) -> None:
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.warning("WS send error: %s", e)

    async def process_text(user_text: str) -> None:
        """Run LLM + TTS and stream results back to the client."""
        try:
            from app.api.v1.endpoints.tutor import _get_dr_hamza_response
        except ImportError:
            await send({"type": "error", "error": {"message": "LLM service unavailable", "severity": "error"}})
            return

        await send({"type": "thinking"})

        context = {"history": history[-6:]}
        try:
            reply_text = await _get_dr_hamza_response(user_text, context)

            if not _verify_format(reply_text):
                logger.warning("[AgentWS] Pass-1 format fail — retrying")
                suffix = "\n\n[SYSTEM] يجب أن يكون ردك بالتنسيق الثلاثي: سطر الحوار\n*سطر الحركة*\n[EMOTION: tag]"
                reply_text = await _get_dr_hamza_response(user_text + suffix, context)

            if not _verify_format(reply_text):
                logger.warning("[AgentWS] Pass-2 format fail — applying patch")
                reply_text = _patch_format(reply_text)

            parsed = _parse_reply(reply_text)
        except RuntimeError as e:
            if "OPENAI_AUTH_401" in str(e):
                logger.error("[AgentWS] OpenAI API key invalid (401) — sending friendly error frame")
                await send({
                    "type": "tts_unavailable",
                    "transcript": user_text,
                    "reply": "",
                    "dialogue": "عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. تواصل مع المسؤول لإعداد مفتاح API.",
                    "action": "يميل برأسه بهدوء ويبتسم بأسف",
                    "emotion": "neutral",
                })
            else:
                logger.exception("[AgentWS] LLM runtime error: %s", e)
                await send({"type": "error", "error": {"message": str(e), "severity": "error"}})
            return
        except Exception as e:
            logger.exception("[AgentWS] LLM error: %s", e)
            await send({"type": "error", "error": {"message": "حدث خطأ مؤقت، حاول مرة ثانية.", "severity": "error"}})
            return

        # Save to history
        history.append({"user": user_text, "assistant": parsed['dialogue']})
        if len(history) > 6:
            history[:] = history[-6:]

        # ── tts_arabic local Arabic TTS ─────────────────────────────────────
        # Returns raw int16 PCM bytes at 22050 Hz.  Frontend's playPCMAudio()
        # wraps them into a WAV Blob via pcmToWavBlob — no ffmpeg needed.
        audio_b64  = ""
        audio_fmt  = "pcm"
        try:
            from app.services.lahajati_tts import synthesize as tts_synthesize
            if parsed['dialogue']:
                pcm_bytes = await tts_synthesize(parsed['dialogue'])
                if pcm_bytes:
                    audio_b64 = base64.b64encode(pcm_bytes).decode('ascii')
        except Exception as e:
            logger.warning("[AgentWS] TTS error (will send tts_unavailable): %s", e)

        if audio_b64:
            await send({
                "type":         "speech",
                "transcript":   user_text,
                "reply":        reply_text,
                "dialogue":     parsed['dialogue'],
                "action":       parsed['action'],
                "emotion":      parsed['emotion'],
                "audio_base64": audio_b64,
                "audio_format": audio_fmt,   # "pcm" — frontend's pcmToWavBlob wraps it
                "sample_rate":  22050,        # tts_arabic fixed output rate
            })
        else:
            await send({
                "type":       "tts_unavailable",
                "transcript": user_text,
                "reply":      reply_text,
                "dialogue":   parsed['dialogue'],
                "action":     parsed['action'],
                "emotion":    parsed['emotion'],
            })

    # ── Message loop ──────────────────────────────────────────────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send({"type": "error", "error": {"message": "invalid_json", "severity": "warn"}})
                continue

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await send({"type": "pong"})

            elif msg_type == "text":
                user_text = str(msg.get("text", msg.get("message", ""))).strip()
                if not user_text:
                    continue
                await process_text(user_text)

            elif msg_type == "audio":
                b64_data = str(msg.get("data", ""))
                if not b64_data:
                    continue
                await send({"type": "transcribing"})

                # Decode and transcribe
                transcript = ""
                try:
                    audio_bytes = base64.b64decode(b64_data)
                    from app.services.whisper_stt import transcribe_audio, is_available as stt_available
                    if stt_available():
                        transcript = await transcribe_audio(audio_bytes) or ""
                    else:
                        logger.warning("[AgentWS] Whisper not available — sending tts_unavailable with empty transcript")
                        await send({
                            "type": "error",
                            "error": {"message": "STT unavailable — install faster-whisper", "severity": "warn"},
                        })
                        continue
                except Exception as e:
                    logger.exception("[AgentWS] STT error: %s", e)
                    await send({"type": "error", "error": {"message": f"STT error: {e}", "severity": "error"}})
                    continue

                transcript = transcript.strip()
                if not transcript:
                    await send({"type": "error", "error": {"message": "لم أسمع شيئاً — حاول مرة أخرى", "severity": "warn"}})
                    continue

                await process_text(transcript)

            elif msg_type == "clear":
                history.clear()
                await send({"type": "cleared"})

            else:
                logger.debug("[AgentWS] Unknown message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Agent WebSocket disconnected: %s", websocket.client)
    except Exception as e:
        logger.exception("[AgentWS] Unexpected error: %s", e)
        try:
            await send({"type": "error", "error": {"message": str(e), "severity": "error"}})
            await websocket.close()
        except Exception:
            pass
