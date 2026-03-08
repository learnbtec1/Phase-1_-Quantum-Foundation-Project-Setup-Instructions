# -*- coding: utf-8 -*-
# backend/app/api/v1/endpoints/agent_ws.py
"""
WebSocket endpoint for the Dr. Hamza AI avatar agent.

URL   : ws://localhost:8000/ws/agent
Route : mounted via main.py as agent_ws_router (prefix="/ws")

Client → Server frames
──────────────────────
  binary                        raw PCM/WAV audio bytes → STT → LLM → speech
  {type:"text", message, lang}  text input              → LLM → speech
  {type:"ping", ts}             heartbeat
  {type:"clear"}                reset session history

Server → Client frames
──────────────────────
  {type:"pong",         ts}                             heartbeat reply
  {type:"error",        message}                        error notification
  {type:"transcript",   text}                           STT result
  {type:"partial",      dialogue, emotion, action}      streaming preview
  {type:"speech",       dialogue, emotion, action,
                        audio_base64, sample_rate}      final frame (with TTS)
  {type:"tts_unavailable", dialogue, emotion, action}   final frame (no audio)
"""
from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.v1.endpoints.tutor import _get_dr_hamza_response, parse_hamza_output
from app.services.kokoro_tts import is_available as tts_available
from app.services.kokoro_tts import synthesize_with_timing
from app.services.whisper_stt import is_available as whisper_available
from app.services.whisper_stt import transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["agent"])

# Maps LLM-returned emotion tags → director's internal animation labels.
EMOTION_MAP: dict[str, str] = {
    "strict":    "strictEvaluation",
    "celebrate": "celebration",
    "relaxed":   "relax",
}

_TTS_SAMPLE_RATE = 24000  # Kokoro outputs 24 kHz PCM


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _map_emotion(raw: str) -> str:
    """Translate LLM emotion tag to director label when needed."""
    return EMOTION_MAP.get(raw.lower(), raw)


async def _build_speech_frame(parsed: dict) -> dict:
    """
    Given a parsed Dr. Hamza dict, attempt TTS and return a fully populated
    speech frame (or a tts_unavailable frame if synthesis fails).
    """
    dialogue: str = parsed.get("dialogue", "")
    emotion: str  = _map_emotion(parsed.get("emotion", "neutral"))
    action: str   = parsed.get("action", "beat")

    if tts_available() and dialogue.strip():
        try:
            result = await synthesize_with_timing(dialogue, voice="af_sky", speed=1.0)
            if result is not None:
                audio_bytes, _timings = result
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                return {
                    "type":         "speech",
                    "dialogue":     dialogue,
                    "emotion":      emotion,
                    "action":       action,
                    "audio_base64": audio_b64,
                    "sample_rate":  _TTS_SAMPLE_RATE,
                }
        except Exception:
            logger.exception("TTS synthesis failed — sending tts_unavailable")

    return {
        "type":     "tts_unavailable",
        "dialogue": dialogue,
        "emotion":  emotion,
        "action":   action,
    }


async def _send_partial(ws: WebSocket, parsed: dict) -> None:
    """Send a lightweight partial frame so the avatar can start animating."""
    await ws.send_text(json.dumps({
        "type":     "partial",
        "dialogue": parsed.get("dialogue", ""),
        "emotion":  _map_emotion(parsed.get("emotion", "neutral")),
        "action":   parsed.get("action", "beat"),
    }))


async def _handle_message(
    ws: WebSocket,
    message: str,
    history: list[dict],
) -> None:
    """Run LLM → partial frame → TTS → speech frame pipeline for a text message."""
    context = {"history": history}

    raw = await _get_dr_hamza_response(message, context)
    parsed = parse_hamza_output(raw)

    # Send partial immediately so the avatar doesn't feel frozen
    await _send_partial(ws, parsed)

    # Build full speech frame (with audio if TTS is available)
    frame = await _build_speech_frame(parsed)
    await ws.send_text(json.dumps(frame))

    # Persist turn in session history (keep last 8 turns in memory)
    history.append({"user": message, "assistant": raw})
    if len(history) > 8:
        history.pop(0)


async def _handle_audio(
    ws: WebSocket,
    audio_bytes: bytes,
    history: list[dict],
) -> None:
    """Transcribe audio → send transcript frame → run LLM pipeline."""
    if not whisper_available():
        await ws.send_text(json.dumps({
            "type":    "error",
            "message": "Speech recognition is not available on this server.",
        }))
        return

    try:
        transcript: str = await transcribe_audio(audio_bytes)
    except Exception as exc:
        logger.exception("STT transcription failed: %s", exc)
        await ws.send_text(json.dumps({
            "type":    "error",
            "message": "Could not transcribe audio. Please try again.",
        }))
        return

    if not transcript.strip():
        return

    # Echo the transcript back so the UI can display it
    await ws.send_text(json.dumps({"type": "transcript", "text": transcript}))

    await _handle_message(ws, transcript, history)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/agent")
async def agent_ws(websocket: WebSocket) -> None:
    """Main Dr. Hamza avatar WebSocket handler."""
    await websocket.accept()
    logger.info("Agent WS: client connected")

    session_history: list[dict] = []

    try:
        while True:
            try:
                msg = await websocket.receive()
            except RuntimeError:
                # Starlette raises RuntimeError when receive() is called after
                # a disconnect message was already consumed internally.
                break

            # Starlette disconnect message — exit the loop cleanly.
            if msg.get("type") == "websocket.disconnect":
                break

            # ── Binary audio frame ──────────────────────────────────────
            if "bytes" in msg and msg["bytes"]:
                await _handle_audio(websocket, msg["bytes"], session_history)

            # ── Text / control frame ────────────────────────────────────
            elif "text" in msg and msg["text"]:
                try:
                    data: dict = json.loads(msg["text"])
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({
                        "type":    "error",
                        "message": "Invalid JSON frame.",
                    }))
                    continue

                frame_type: str = data.get("type", "")

                if frame_type == "ping":
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "ts":   data.get("ts"),
                    }))

                elif frame_type == "text":
                    user_msg: str = (data.get("message") or "").strip()
                    if user_msg:
                        await _handle_message(websocket, user_msg, session_history)

                elif frame_type == "clear":
                    session_history.clear()
                    logger.debug("Agent WS: session history cleared")

                else:
                    logger.debug("Agent WS: unknown frame type %r — ignored", frame_type)

    except WebSocketDisconnect:
        logger.info("Agent WS: client disconnected")
    except Exception:
        logger.exception("Agent WS: unhandled error, closing connection")
    finally:
        logger.info("Agent WS: connection handler exiting")