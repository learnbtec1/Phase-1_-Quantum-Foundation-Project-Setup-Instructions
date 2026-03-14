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
                                "audio_base64": "...", "audio_format": "mp3",
                                "viseme_cues": [...], "word_cues": [...] }
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
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

try:
    from app.services.settings import HEARTBEAT_INTERVAL_SEC
except Exception:
    HEARTBEAT_INTERVAL_SEC = 15  # safe default if settings module unavailable

logger = logging.getLogger(__name__)

# ── Azure TTS singleton (lazy init — avoids import-time crash if SDK absent) ─
_azure_tts = None

def _get_azure_tts():
    """Return a shared AzureTTSService instance, or None if unavailable."""
    global _azure_tts
    if _azure_tts is None:
        try:
            from app.services.tts_service import AzureTTSService
            from app.core.config import settings
            _azure_tts = AzureTTSService(default_voice=settings.TTS_ARABIC_VOICE)
            logger.info(
                "[AgentWS] AzureTTSService ready | voice=%s | region=%s",
                _azure_tts._default_voice, _azure_tts._region,
            )
        except Exception as exc:
            logger.error("[AgentWS] AzureTTSService init failed: %s", exc)
    return _azure_tts

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

    # ── WS protocol v1 heartbeat ─────────────────────────────────────────────
    async def _heartbeat_sender() -> None:
        """Send a heartbeat frame every HEARTBEAT_INTERVAL_SEC seconds."""
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
                await send({"v": 1.1, "id": "hb", "type": "heartbeat"})
        except Exception:
            pass  # silently exit when WS closes

    heartbeat_task = asyncio.create_task(_heartbeat_sender())

    # Per-connection conversation history (last 6 turns = 3 exchanges)
    history: List[dict] = []

    async def send(payload: dict) -> None:
        payload.setdefault("v", 1.1)  # stamp all outgoing frames with WS protocol v1.1
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            logger.debug("[WS_FRAME_SENT] type=%s id=%s", payload.get("type"), payload.get("id"))
        except RuntimeError as e:
            logger.warning("[WS WARNING] Tried to send on a closed websocket: %s", e)
        except Exception as e:
            logger.warning("WS send error: %s", e)

    async def process_text(user_text: str, grade_result: dict | None = None, req_id: Optional[str] = None) -> None:
        """Run LLM + TTS and stream results back to the client.

        Args:
            user_text:    Transcribed / typed student message.
            grade_result: Optional BTEC grade snapshot forwarded by the frontend
                          (Gap 4-A). When present, a "Debrief Context" block is
                          injected into Dr. Hamza's system prompt so he can say
                          things like "أرى إنك حصلت على Merit…" naturally.
        """
        try:
            from app.api.v1.endpoints.tutor import _get_dr_hamza_response
        except ImportError:
            await send({"type": "error", "error": {"message": "LLM service unavailable", "severity": "error"}})
            return

        # "llm_thinking" matches the frontend handler in useAvatarAgent.ts:
        # `if (type === 'transcribing' || type === 'llm_thinking')`.
        # The old "thinking" type was silently dropped by the frontend.
        await send({"type": "llm_thinking", "id": req_id} if req_id else {"type": "llm_thinking"})

        # Thread grade context into the LLM context dict so _get_dr_hamza_response
        # can splice a Debrief Context block into the system prompt.
        context: dict = {"history": history[-6:]}
        if grade_result and isinstance(grade_result, dict) and grade_result.get("final_grade"):
            context["grade_result"] = {
                "final_grade":      str(grade_result.get("final_grade", "PENDING")),
                "subject":          str(grade_result.get("subject", "—")),
                "criteria_summary": str(grade_result.get("criteria_summary", "")),
                "achieved":         int(grade_result.get("achieved", 0)),
                "total":            int(grade_result.get("total", 0)),
            }
            logger.info(
                "[AgentWS] Debrief Context injected — grade=%s subject=%s",
                context["grade_result"]["final_grade"],
                context["grade_result"]["subject"],
            )
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
                    "id": req_id,
                    "transcript": user_text,
                    "reply": "",
                    "dialogue": "عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. تواصل مع المسؤول لإعداد مفتاح API.",
                    "action": "يميل برأسه بهدوء ويبتسم بأسف",
                    "emotion": "neutral",
                })
            elif "OPENAI_QUOTA_429" in str(e):
                logger.warning("[AgentWS] OpenAI quota exceeded (429) — sending friendly fallback")
                await send({
                    "type": "tts_unavailable",
                    "id": req_id,
                    "transcript": user_text,
                    "reply": "",
                    "dialogue": "عذراً، يوجد ضغط على الشبكة حالياً. يرجى المحاولة بعد قليل.",
                    "action": "يميل برأسه بهدوء",
                    "emotion": "neutral",
                })
            else:
                logger.exception("[AgentWS] LLM runtime error: %s", e)
                await send({"type": "error", "id": req_id, "error": {"message": "حدث خطأ مؤقت، حاول مرة ثانية.", "severity": "error", "code": "llm_runtime_error"}})
            return
        except Exception as e:
            logger.exception("[AgentWS] LLM error: %s", e)
            await send({"type": "error", "id": req_id, "error": {"message": "حدث خطأ مؤقت، حاول مرة ثانية.", "severity": "error", "code": "llm_unhandled_error"}})
            return

        # Save to history
        history.append({"user": user_text, "assistant": parsed['dialogue']})
        if len(history) > 6:
            history[:] = history[-6:]

        # ── Azure Neural TTS (ar-JO-TaimNeural — male, Jordanian Arabic) ────────
        # Returns MP3 bytes + Temporal Cues (Visemes & Words).
        # Prefer the app-state singleton (fully configured with voice/key/region)
        # over the module-level lazy singleton which lacks default_voice.
        audio_b64 = ""
        viseme_cues = []
        word_cues = []
        azure_tts = getattr(websocket.app.state, 'tts_service', None) or _get_azure_tts()
        
        if azure_tts and parsed['dialogue']:
            try:
                # 1. Update the unpack assignment to receive all three outputs
                mp3_bytes, viseme_cues, word_cues = await azure_tts.synthesize(
                    parsed['dialogue'], emotion=parsed.get('emotion', 'neutral')
                )
                
                if mp3_bytes:
                    audio_b64 = base64.b64encode(mp3_bytes).decode('ascii')
                    logger.info(
                        "[AgentWS] Azure TTS OK | %d mp3 bytes | %d visemes | %d words | voice=%s",
                        len(mp3_bytes), len(viseme_cues), len(word_cues), azure_tts._default_voice,
                    )
            except Exception as e:
                logger.warning("[AgentWS] Azure TTS error (will send tts_unavailable): %s", e)

        # 2. Add the new cue arrays to the WebSocket payload sent to the frontend
        if audio_b64:
            await send({
                "type":         "speech",
                "id":           req_id,
                "transcript":   user_text,
                "reply":        reply_text,
                "dialogue":     parsed['dialogue'],
                "action":       parsed['action'],
                "emotion":      parsed['emotion'],
                "audio_base64": audio_b64,
                "audio_format": "mp3",  # Azure SDK returns MP3 → playMp3Audio()
                "viseme_cues":  viseme_cues,  # Lip-sync timeline
                "word_cues":    word_cues,    # Word boundary timeline
            })
        else:
            await send({
                "type":       "tts_unavailable",
                "id":         req_id,
                "transcript": user_text,
                "reply":      reply_text,
                "dialogue":   parsed['dialogue'],
                "action":     parsed['action'],
                "emotion":    parsed['emotion'],
            })

    # ── One-shot welcome greeting on connect ─────────────────────────────────
    # Fires once per WebSocket connection (~0.6 s after accept) so the avatar
    # greets the student in Jordanian Arabic without waiting for a user message.
    # The frontend hasInitiated guard prevents a second greeting from the
    # smart-heartbeat idle timer (IDLE_TIMEOUT = 1 s) from doubling up:
    # by the time that timer fires the avatar is already speaking / hasInitiated=true.
    _connect_greeted = False  # per-connection one-shot flag

    async def _send_welcome() -> None:
        nonlocal _connect_greeted
        await asyncio.sleep(0.6)
        if _connect_greeted:
            return
        _connect_greeted = True
        await process_text(
            '[SYSTEM_EVENT: قدّم نفسك باللهجة الأردنية — ابدأ بـ "السلام عليكم"، '
            'وعرّف نفسك كدكتور حمزة معلم BTEC، واسأل الطالب بأسلوبك الأردني الدافئ '
            'شو يودّ يتعلم اليوم. لا تزيد عن جملتين.]',
            req_id='greet_0',
        )

    asyncio.create_task(_send_welcome())

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
                # v1.1: echo back the id so client can correlate heartbeat latency
                await send({"type": "pong", "id": msg.get("id", "pong")})

            elif msg_type == "pong":
                # Client acknowledging our heartbeat — nothing to do besides log
                logger.debug("[WS] pong received id=%s", msg.get("id", "?"))

            elif msg_type == "text":
                user_text = str(msg.get("text", msg.get("message", ""))).strip()
                if not user_text:
                    continue
                req_id = str(msg.get("id") or f"text_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}")
                grade_result = msg.get("grade_result") or None
                await process_text(user_text, grade_result=grade_result, req_id=req_id)

            elif msg_type == "audio":
                b64_data = str(msg.get("data", ""))
                req_id   = str(msg.get("id", ""))   # correlate frames to this request
                if not b64_data:
                    continue
                print(f"[agent_ws] AUDIO received: req_id={req_id!r} b64_len={len(b64_data)}", flush=True)
                await send({"type": "transcribing", "id": req_id})

                # Decode and transcribe
                transcript = ""
                try:
                    audio_bytes = base64.b64decode(b64_data)
                    print(f"[agent_ws] AUDIO decoded: {len(audio_bytes)} bytes", flush=True)
                    from app.services.whisper_stt import (
                        transcribe_audio, is_available as stt_available, STTError,
                    )
                    print(f"[agent_ws] STT available={stt_available()}", flush=True)
                    if stt_available():
                        print(f"[agent_ws] Calling transcribe_audio req_id={req_id!r}", flush=True)
                        transcript = await transcribe_audio(
                            audio_bytes, mime_type=None, req_id=req_id
                        )
                        print(f"[agent_ws] STT returned: {repr(transcript[:80]) if transcript else repr(transcript)}", flush=True)
                    else:
                        logger.warning("[AgentWS] Whisper not available — sending error frame")
                        await send({
                            "type": "error", "id": req_id,
                            "error": {"message": "STT unavailable — install faster-whisper", "severity": "warn", "code": "stt_unavailable"},
                        })
                        continue
                except STTError as e:
                    logger.warning("[AgentWS] STT rejected req=%s code=%s: %s", req_id, e.code, e.detail)
                    await send({"type": "error", "id": req_id, "error": {"message": e.detail, "severity": "warn", "code": getattr(e, 'code', 'stt_rejected')}})
                    continue
                except Exception as e:
                    logger.exception("[AgentWS] STT error: %s", e)
                    await send({"type": "error", "id": req_id, "error": {"message": f"STT error: {e}", "severity": "error", "code": "stt_internal"}})
                    continue

                transcript = (transcript or "").strip()
                if not transcript:
                    await send({"type": "error", "id": req_id, "error": {"message": "لم أسمع شيئاً — حاول مرة أخرى", "severity": "warn", "code": "empty_transcript"}})
                    continue

                # ── Sprint 3: STT debug + immediate transcript echo ───────────
                # Print to the backend terminal so the developer can confirm
                # Whisper actually heard the words before the LLM call starts.
                print(f"--- [STT RESULT]: {transcript} ---", flush=True)
                logger.info("[AgentWS] STT transcript: %r", transcript)
                # Echo the raw transcript to the frontend BEFORE the LLM replies so
                # the UI can fill the text box / chat input immediately.
                await send({"type": "transcript", "text": transcript, "id": req_id})

                # Gap 4-A: voice messages may also carry grade context
                grade_result = msg.get("grade_result") or None
                await process_text(transcript, grade_result=grade_result, req_id=req_id)

            elif msg_type == "user:emotion":
                # SER (Speech Emotion Recognition) frame from frontend.
                # Accepted when USE_SER=true; stored in session state for
                # EmotionEngine context on the next LLM turn.
                import os as _os
                if _os.environ.get("USE_SER", "false").lower() in {"1", "true", "yes"}:
                    pleasure  = float(msg.get("pleasure",  0))
                    arousal   = float(msg.get("arousal",   0))
                    dominance = float(msg.get("dominance", 0))
                    # Clamp to [-1, 1]
                    pleasure  = max(-1.0, min(1.0, pleasure))
                    arousal   = max(-1.0, min(1.0, arousal))
                    dominance = max(-1.0, min(1.0, dominance))
                    logger.debug(
                        "[AgentWS] SER frame P=%.2f A=%.2f D=%.2f",
                        pleasure, arousal, dominance,
                    )
                    # Attach to next LLM context for downstream use
                    # (stored on the per-connection history for future use)
                    if not history or history[-1].get("user_emotion") is None:
                        history.append({"user_emotion": {
                            "pleasure": pleasure,
                            "arousal":  arousal,
                            "dominance": dominance,
                        }})
                    else:
                        history[-1]["user_emotion"] = {
                            "pleasure":  pleasure,
                            "arousal":   arousal,
                            "dominance": dominance,
                        }
                else:
                    logger.debug("[AgentWS] SER frame received but USE_SER=false — ignored")

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
    finally:
        if not heartbeat_task.done():
            heartbeat_task.cancel()
            logger.info("[AgentWS] Heartbeat ghost task successfully cancelled.")