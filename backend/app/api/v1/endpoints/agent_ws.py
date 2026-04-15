# -*- coding: utf-8 -*-
"""
Agent WebSocket endpoint: ws://localhost:8000/ws/agent

Handles real-time voice/text conversation with the Cogni avatar agent.

Message protocol (client → server):
  { "type": "auth", "token": "<JWT>" }  # first frame if not using Sec-WebSocket-Protocol (when anonymous not allowed)
  { "type": "ping" }
  { "type": "audio", "data": "<base64 WAV>", "system_prompt": "<optional Cogni>", "emotional_context": "<optional>" }
  { "type": "persona_init", "system_prompt": "<Arabic Cogni identity>" }
  { "type": "deep_link_config", "unit": "<optional>", "target": "pass|merit|distinction|quick_review", "subject": "<optional>" }
  { "type": "deep_link_clear", ... }  # clears deep link + quick_review; restores default P-M-D scaffolding
  { "type": "deep_link_init", ... }  # legacy alias → same as deep_link_config
  { "type": "set_focus_subject", "subject": "...", "student_override": true }
  { "type": "text",  "text": "<text>", "intent|user_intent?": "<optional hint for behavior layer>",
                                "system_prompt": "<optional Cogni>", "persona_system_prompt": "<alias>", "emotional_context": "<optional>" }
  { "type": "user_interrupt" }  # cancel in-flight LLM/TTS; server sends stop_speech (same as barge-in)
  { "type": "training_request", "topic": "<optional>", "difficulty": "pass|merit|distinction" }
  { "type": "clear" }

Message protocol (server → client):
  { "type": "pong" }
  { "type": "transcribing" }
  { "type": "llm_thinking" }
  { "type": "speech",          "transcript": "...", "reply": "...", "dialogue": "...",
                                "emotion": "...", "action": "...",
                                "performance": [ { "tag", "start_word", "blendshape?", "intensity?", "animation?" } ],
                                "audio_base64": "...", "audio_format": "mp3",
                                "viseme_cues": [...], "word_cues": [...] }
  { "type": "tts_unavailable", "transcript": "...", "reply": "...", "dialogue": "...",
                                "emotion": "...", "action": "..." }
  { "type": "error",           "error": { "message": "...", "severity": "error|warn" } }
  { "type": "cleared" }
  { "type": "stop_speech",     "reason": "interrupted|..." }  # stop avatar TTS (full-duplex interrupt)
  { "type": "tool_result",     "tool": "...", "ok": true|false, "result_preview": "..." }  # LLM function-calling
  { "type": "deep_link_ack",   "deep_link": { ... } }
  { "type": "deep_link_cleared", "v": 1.1 }
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import re
import time
import uuid
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.api.deps import load_user_from_access_token
from app.api.v1.ws_message_security import validate_ws_client_message
from app.models.db_models import User
from app.services.thinker import Thinker
from app.archive.emotional_memory_manager import EmotionalMemoryManager
from app.services.cogni_reply_parse_legacy import (
    ALLOWED_EMOTIONS,
    parse_reply_unified,
    parse_reply_with_inline_gestures,
    verify_cogni_reply_format,
)
from app.services.cogni_output_schema import (
    cogni_strict_json_enabled,
    parse_llm_reply_strict_json,
)

try:
    from app.services.settings import HEARTBEAT_INTERVAL_SEC
except Exception as _hb_import_exc:
    HEARTBEAT_INTERVAL_SEC = 15  # safe default if settings module unavailable
    logging.getLogger("cogni.agent_ws").warning(
        "HEARTBEAT_INTERVAL_SEC import failed, using 15s: %s",
        _hb_import_exc,
        exc_info=True,
    )

logger = logging.getLogger("cogni.agent_ws")


def _ws_ctx(session_id: str, req_id: Optional[str] = None) -> str:
    """Compact id string for log messages (no PII)."""
    sid = (session_id or "")[:32]
    if req_id:
        return f"session_id={sid} req_id={str(req_id)[:48]}"
    return f"session_id={sid}"

# ═══ NEW ═══
_active_llm_tasks: Dict[str, asyncio.Task[Any]] = {}
# ═══ NEW END ═══

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

def _normalize_deep_link_target(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in ("d", "distinction", "dist", "امتياز"):
        return "distinction"
    if s in ("m", "merit", "ميريت", "مرت"):
        return "merit"
    if s in ("p", "pass", "نجاح"):
        return "pass"
    if s in (
        "quick_review",
        "quick-review",
        "quick",
        "review",
        "revision",
        "مراجعة",
        "مراجعة_سريعة",
    ):
        return "quick_review"
    return s[:32]


_ACTION_DEFAULTS: dict[str, str] = {
    'celebrate':   'يلوح بيديه بحماس ويبتسم ابتسامة عريضة',
    'encouraging': 'يفتح كفيه بلطف ويحرّك ذراعيه للأمام',
    'thinking':    'يميل رأسه قليلاً وعيناه تتأملان',
    'strict':      'يشير بإصبعه بثقة وينظر للأمام مباشرة',
    'friendly':    'يبتسم بلطف ويميل رأسه قليلاً',
    'neutral':     'يومئ برأسه برفق',
}



def _infer_user_mood_from_text(text: str) -> str:
    """Coarse student mood from last user utterance (until SER is wired)."""
    t = (text or "").strip()
    if not t:
        return "neutral"
    if re.search(r"مش\s*فاهم|ما\s*فهمت|صعب|تعبت|زهقت|خايف|قلقان|خايفة", t, re.I):
        return "concerned"
    if re.search(r"ممتاز|فهمت|تمام|يا\s*سلام|شكرا|مشكور|حلو", t, re.I):
        return "happy"
    if re.search(r"ملل|ممل|زهقان", t, re.I):
        return "bored"
    return "neutral"


_USER_MOOD_PAD: dict[str, dict[str, float]] = {
    "neutral":   {"pleasure": 0.0, "arousal": 0.0, "dominance": 0.0},
    "happy":     {"pleasure": 0.52, "arousal": 0.22, "dominance": 0.08},
    "concerned": {"pleasure": -0.28, "arousal": 0.32, "dominance": -0.08},
    "bored":     {"pleasure": -0.18, "arousal": -0.38, "dominance": -0.05},
}


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


COGNI_WS_SUBPROTOCOL = "cogni-auth-v1"
COGNI_WS_AUTH_HANDSHAKE_SEC = 20.0


def _allow_anonymous_agent_ws() -> bool:
    return os.getenv("COGNI_WS_ALLOW_ANONYMOUS", "false").lower() in ("1", "true", "yes")


def _jwt_from_sec_websocket_protocol(header_val: Optional[str]) -> Optional[str]:
    """
    Browser: new WebSocket(url, ['cogni-auth-v1', '<jwt>'])
    → Sec-WebSocket-Protocol: cogni-auth-v1, <jwt>
    Also supports a single token: cogni-auth-v1.<jwt>
    """
    if not header_val:
        return None
    parts = [p.strip() for p in header_val.split(",") if p.strip()]
    if len(parts) >= 2 and parts[0].lower() == COGNI_WS_SUBPROTOCOL.lower():
        return parts[1] or None
    if len(parts) == 1:
        p0 = parts[0]
        prefix = COGNI_WS_SUBPROTOCOL.lower() + "."
        if p0.lower().startswith(prefix):
            return p0[len(COGNI_WS_SUBPROTOCOL) + 1 :] or None
    return None


def _user_ctx_from_row(user: User) -> tuple[uuid.UUID, str, str, str]:
    r = user.role
    user_role_str = r.value if hasattr(r, "value") else str(r)
    return (
        user.id,
        str(user.subscription_plan or "free").lower(),
        str(user.model_tier or "standard").lower(),
        user_role_str,
    )


def _pedagogical_performance_supplement(
    dialogue: str,
    existing: Optional[List[Dict[str, Any]]],
    pedagogical_stage: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    When the LLM omits `performance[]`, nudge avatar timing: praise → clap; question → point;
    else map scaffolding stage (Pass/Merit/Distinction/mini_check) when COGNI_STAGE_GESTURES is on.
    """
    if os.getenv("COGNI_PEDAGOGICAL_PERFORMANCE", "true").lower() not in ("1", "true", "yes"):
        return list(existing or [])
    ex = list(existing or [])
    if ex:
        return ex
    d = (dialogue or "").strip()
    if not d:
        return []
    praise_tokens = (
        "أحسنت",
        "ممتاز",
        "عفارم",
        "برافو",
        "يا سلام",
        "أحسنتِ",
        "رائع",
        "مظبوط",
        "صحيح",
        "تمام هيك",
    )
    if any(t in d for t in praise_tokens):
        return [{"tag": "[GESTURE_CLAP]", "start_word": 0, "animation": "clap", "intensity": 0.6}]
    if "?" in d or "\u061f" in d:
        return [{"tag": "[GESTURE_POINT]", "start_word": 0, "animation": "point_forward", "intensity": 0.55}]
    stg = (pedagogical_stage or "").strip().lower()
    if os.getenv("COGNI_STAGE_GESTURES", "true").lower() in ("1", "true", "yes") and stg:
        if stg == "merit":
            return [{"tag": "[GESTURE_POINT]", "start_word": 0, "animation": "point_forward", "intensity": 0.55}]
        if stg == "distinction":
            return [{"tag": "[GESTURE_WAVE]", "start_word": 0, "animation": "wave", "intensity": 0.55}]
        if stg == "mini_check":
            return [{"tag": "[GESTURE_EXPLAIN]", "start_word": 0, "animation": "explain_01", "intensity": 0.5}]
        if stg == "pass":
            return [{"tag": "[GESTURE_EXPLAIN]", "start_word": 0, "animation": "open_hand", "intensity": 0.5}]
    return [{"tag": "[GESTURE_EXPLAIN]", "start_word": 0, "animation": "explain_01", "intensity": 0.45}]


# ── Main endpoint ────────────────────────────────────────────────────────────

@router.websocket("/agent")
async def agent_ws(websocket: WebSocket):
    """
    Real-time avatar agent:
      audio → Whisper STT → Dr. Hamza LLM → tts_arabic TTS → avatar
      text  →               Dr. Hamza LLM → tts_arabic TTS → avatar

    Auth (no JWT in query string — avoids proxy/CDN logs):
      - Sec-WebSocket-Protocol: cogni-auth-v1, <jwt>  (see frontend useAgentAgent), or
      - First text frame: {"type":"auth","token":"<jwt>"} before other messages
        (required when COGNI_WS_ALLOW_ANONYMOUS is false).

    User is resolved via load_user_from_access_token (DB + is_active), same as HTTP Bearer.
    Optional: COGNI_WS_ALLOW_ANONYMOUS=true → guest mode when no valid token.
    """
    ws_req_id = str(uuid.uuid4())
    if websocket.query_params.get("token"):
        await websocket.close(code=1008, reason="token_in_query_not_supported")
        return

    linked_eval_uuid: Optional[uuid.UUID] = None
    _sdp = websocket.query_params.get("student_device_id")
    if _sdp:
        try:
            linked_eval_uuid = uuid.UUID(str(_sdp).strip())
        except (ValueError, TypeError):
            logger.debug("[AgentWS] invalid student_device_id query param")

    session_id: str = str(uuid.uuid4())
    user_row: Optional[User] = None
    jwt_hint = _jwt_from_sec_websocket_protocol(websocket.headers.get("sec-websocket-protocol"))
    if jwt_hint:
        user_row = load_user_from_access_token(jwt_hint)

    req_protos = [
        p.strip()
        for p in (websocket.headers.get("sec-websocket-protocol") or "").split(",")
        if p.strip()
    ]
    accept_subprotocol: Optional[str] = None
    if user_row and req_protos:
        head = req_protos[0].lower()
        if head == COGNI_WS_SUBPROTOCOL.lower() or head.startswith(
            COGNI_WS_SUBPROTOCOL.lower() + "."
        ):
            accept_subprotocol = COGNI_WS_SUBPROTOCOL

    await websocket.accept(subprotocol=accept_subprotocol)

    allow_guest = _allow_anonymous_agent_ws()
    if user_row is None and not allow_guest:
        try:
            raw = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=COGNI_WS_AUTH_HANDSHAKE_SEC,
            )
            data = json.loads(raw)
            mtype = str(data.get("type") or "").lower()
            if mtype not in ("auth", "authenticate"):
                await websocket.close(code=1008, reason="auth_required")
                return
            tok = (data.get("token") or data.get("access_token") or "").strip()
            user_row = load_user_from_access_token(tok)
        except asyncio.TimeoutError:
            await websocket.close(code=1008, reason="auth_timeout")
            return
        except json.JSONDecodeError:
            await websocket.close(code=1008, reason="invalid_json")
            return
        except Exception as _auth_exc:
            logger.debug("[AgentWS] auth handshake error: %s", _auth_exc)
            await websocket.close(code=1011)
            return

    if user_row is None and not allow_guest:
        await websocket.close(code=1008, reason="auth_failed")
        return

    user_uuid: Optional[uuid.UUID] = None
    user_subscription_plan: str = "free"
    user_model_tier: str = "standard"
    user_role_str: str = "guest"
    if user_row is not None:
        user_uuid, user_subscription_plan, user_model_tier, user_role_str = _user_ctx_from_row(user_row)
        try:
            await websocket.send_text(
                json.dumps({"type": "auth_ok", "v": 1.1}, ensure_ascii=False)
            )
        except Exception as _ok_e:
            logger.debug("[AgentWS] auth_ok send failed: %s", _ok_e)

    # Free-tier students: session-only memory (no cross-session DB/Redis persistence).
    _session_only = user_uuid is None or (
        user_role_str == "student"
        and user_subscription_plan == "free"
        and user_model_tier != "premium"
    )

    logger.info(
        "[AgentWS] connected | req_id=%s user_id=%s persist=%s client=%s",
        ws_req_id,
        str(user_uuid) if user_uuid else "guest",
        bool(user_uuid),
        websocket.client,
    )

    heartbeat_task: Optional[asyncio.Task[Any]] = None
    # Stops nested `send()` / heartbeat once the socket is closing or dead (avoids log spam).
    _ws_connection_dead = False

    # Per-connection conversation history (last 6 turns = 3 exchanges)
    history: List[dict] = []

    # ═══ NEW ═══
    def _track_llm_task(task: asyncio.Task[Any]) -> None:
        _active_llm_tasks[session_id] = task

        def _done(_t: asyncio.Task[Any]) -> None:
            if _active_llm_tasks.get(session_id) is _t:
                _active_llm_tasks.pop(session_id, None)

        task.add_done_callback(_done)

    # ═══ NEW END ═══
    # Chroma episodic: per-connection for guests / free session-only; stable user id otherwise (survives WS reconnect).
    episodic_scope_id: str = (
        session_id
        if _session_only
        else (str(user_uuid) if user_uuid else f"guest:{session_id}")
    )
    # Avoid sending tts_unavailable with identical dialogue as the previous outbound turn
    last_outbound_dialogue: str = ""
    active_llm_task: Optional[asyncio.Task[Any]] = None
    # Inner-thinker idle detection: updated on real user turns (text/audio/clear), not ping/pong.
    last_interaction_time: float = time.time()

    def _touch_interaction() -> None:
        nonlocal last_interaction_time
        last_interaction_time = time.time()

    pipeline_busy: bool = False
    playing_tts: bool = False
    think_mm = EmotionalMemoryManager(
        user_id=user_uuid,
        session_only=_session_only,
    )
    thinker: Optional[Thinker] = None
    # Phase B — adaptive practice: server tracks which question awaits an answer
    pending_question_id: Optional[int] = None
    btec_training_pending: Optional[dict] = None

    # Per-connection BTEC state — updated by "btec_progress" WS messages
    # Structure: {unit_id, unit_title, achieved, current_level, next_criterion, summary}
    btec_state: dict = {}

    # Checkpoint #46 — assessment → avatar proactive nudge (one-shot per payload)
    pending_grade_nudge: Optional[dict] = None
    # One-shot grade debrief from Redis (`pop_grade_result`) when client does not send `grade_result`
    pending_redis_grade: Optional[dict] = None
    # De-dup WS `grade_result` re-sends (client bug or retries) after first successful LLM turn
    _ws_grade_result_delivered_fp: Optional[str] = None
    # Instance ids acknowledged this connection (merged into Redis session blob on disconnect)
    _eval_nudge_instance_acks_ws: list[str] = []
    focus_subject: Optional[str] = None

    # ADDED: teacher deep links (?unit=&target=&subject=) — session-scoped until cleared or student_override
    deep_link_state: dict = {}
    # V47 — mirrors "session.state" for tutor/RAG (Quick Review vs full P-M-D scaffolding)
    session_state: dict = {"is_quick_review": False}

    # V28 — camera / device perception (updated by WS messages)
    user_state: dict = {"perception": {}, "device": {}}

    user_dnd: bool = False
    if user_uuid:
        try:
            from app.database import SessionLocal as _SL_DND
            from app.models.db_models import User as _UserDnd

            _db_d = _SL_DND()
            try:
                _ur = _db_d.query(_UserDnd).filter(_UserDnd.id == user_uuid).first()
                if _ur:
                    user_dnd = bool(getattr(_ur, "dnd_mode", False))
            finally:
                _db_d.close()
        except Exception as _dndx:
            logger.debug("[AgentWS] dnd load skipped: %s", _dndx)

    # Per-connection Triple-Persona level — updated by "set_persona" WS messages
    # Values: "pass" (funny Jordan) | "merit" (serious academic) | "distinction" (challenger)
    persona_level: str = "pass"

    # Cogni digital-human: Arabic system prompt from frontend (persona_init + per-message override)
    cogni_persona_system_prompt: Optional[str] = None
    # persona_init.voice_defaults — applied to Azure SSML prosody
    cogni_voice_rate: float = 1.0
    cogni_voice_pitch_scale: float = 1.0

    # Shadow analytics tracker — one per WebSocket connection (fire-and-forget)
    from app.archive.shadow_analytics import SessionTracker as _SA
    _analytics = _SA()
    await _analytics.session_start(persona_level=persona_level)

    async def send(payload: dict) -> None:
        nonlocal _ws_connection_dead
        if _ws_connection_dead:
            return
        payload.setdefault("v", 1.1)  # stamp all outgoing frames with WS protocol v1.1
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            logger.debug("[WS_FRAME_SENT] type=%s id=%s", payload.get("type"), payload.get("id"))
        except Exception as e:
            _ws_connection_dead = True
            err_low = str(e).lower()
            benign = isinstance(e, WebSocketDisconnect) or any(
                p in err_low
                for p in (
                    "websocket.send",
                    "response already completed",
                    "close message has been sent",
                    "disconnect",
                    "closed websocket",
                )
            )
            if benign:
                logger.debug("[AgentWS] send skipped (socket closed): %s", e)
            else:
                logger.warning("WS send error: %s", e)

    async def _heartbeat_sender() -> None:
        """Send a heartbeat frame every HEARTBEAT_INTERVAL_SEC seconds."""
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
                if _ws_connection_dead:
                    return
                await send({"v": 1.1, "id": "hb", "type": "heartbeat"})
        except Exception as _hb_end:
            logger.debug("%s heartbeat sender ended: %s", _ws_ctx(session_id), _hb_end)

    heartbeat_task = asyncio.create_task(_heartbeat_sender())

    if user_uuid and getattr(settings, "ENABLE_REDIS_SESSION_SYNC", True):
        try:
            from app.services.session_state_redis import load_session_state

            _snap = load_session_state(user_uuid)
            if _snap:
                await send({"type": "session_snapshot", "v": 1.1, "data": _snap})
        except Exception as _rs:
            logger.debug("[AgentWS] session_snapshot skipped: %s", _rs)

    async def _notify_goal(goal: Optional[str]) -> None:
        if goal:
            try:
                await send({"type": "goal_update", "v": 1.1, "goal": goal})
            except Exception as _goal_send_exc:
                logger.warning(
                    "%s goal_update send failed: %s",
                    _ws_ctx(session_id),
                    _goal_send_exc,
                    exc_info=True,
                )

    async def cancel_in_flight(reason: str = "interrupted") -> None:
        """Cancel the running LLM+TTS turn and tell the client to stop playback (full-duplex)."""
        nonlocal active_llm_task
        # ═══ NEW ═══
        _active_llm_tasks.pop(session_id, None)
        # ═══ NEW END ═══
        if active_llm_task and not active_llm_task.done():
            active_llm_task.cancel()
            try:
                await active_llm_task
            except asyncio.CancelledError:
                logger.debug("%s active_llm_task cancel awaited (expected)", _ws_ctx(session_id))
            await send({"type": "stop_speech", "v": 1.1, "reason": reason})
        active_llm_task = None

    async def start_user_turn(**kwargs) -> None:
        """Preempt any in-flight reply, then run process_text (mic / typed input)."""
        nonlocal active_llm_task
        await cancel_in_flight("interrupted")

        async def _runner() -> None:
            await process_text(**kwargs)

        active_llm_task = asyncio.create_task(_runner())
        # ═══ NEW ═══
        _track_llm_task(active_llm_task)
        # ═══ NEW END ═══

    async def process_text(
        user_text: str,
        grade_result: dict | None = None,
        req_id: Optional[str] = None,
        emotional_context: Optional[str] = None,
        persona_system_prompt: Optional[str] = None,
        cogni_welcome_turn: bool = False,
        thinker_proactive: bool = False,
        extra_context: Optional[dict] = None,
        ws_client_intent: Optional[str] = None,
    ) -> None:
        """Run LLM + TTS and stream results back to the client.

        Args:
            user_text:    Transcribed / typed student message.
            grade_result: Optional BTEC grade snapshot forwarded by the frontend
                          (Gap 4-A). When present, a "Debrief Context" block is
                          injected into Cogni's system prompt so he can say
                          things like "أرى إنك حصلت على Merit…" naturally.
            emotional_context: Optional summary from the client's emotional memory
                          (trajectory, interests) — threaded into the LLM system prompt.
            persona_system_prompt: Optional Arabic identity block from the client
                          (COGNI_PERSONA.systemPrompt); overrides stored session copy if non-empty.
            cogni_welcome_turn: When True, tutor adds varied opening-greeting instructions.
            thinker_proactive: When True, tutor adds instructions for Thinker-initiated ice-breaker.
            ws_client_intent: Optional intent string from WebSocket `text` frame (`intent` / `user_intent`).
        """
        nonlocal pipeline_busy, playing_tts, last_outbound_dialogue, pending_grade_nudge, pending_redis_grade, _ws_grade_result_delivered_fp
        pipeline_busy = True
        _nudge_for_turn = False
        _nudge_snapshot_for_ack: Optional[dict] = None
        _grade_result_fp_for_turn: Optional[str] = None
        _proc_ctx = _ws_ctx(session_id, req_id)
        _proc_t0 = time.monotonic()
        logger.debug(
            "%s process_text start text_len=%d proactive=%s",
            _proc_ctx,
            len(user_text or ""),
            thinker_proactive,
        )
        try:
            try:
                from app.api.v1.endpoints.tutor import (
                    _get_cogni_response as _get_dr_hamza_response,
                    strip_internal_llm_markers,
                )
            except ImportError:
                await send({"type": "error", "error": {"message": "LLM service unavailable", "severity": "error"}})
                return

            nonlocal btec_training_pending
            if btec_training_pending and (user_text or "").strip():
                _raw_for_train = user_text or ""
                _stu_turn = strip_internal_llm_markers(_raw_for_train).strip()
                if _stu_turn and "[SYSTEM_EVENT:" not in _raw_for_train:
                    _pend_snapshot = btec_training_pending
                    try:
                        from app.services.training_mode import (
                            evaluate_answer as _btec_eval,
                            persist_training_evaluation_row as _btec_persist,
                            track_student_progress as _btec_track,
                        )

                        btec_training_pending = None
                        _ev = await _btec_eval(
                            str(_pend_snapshot.get("question") or ""),
                            _stu_turn,
                            session_id,
                        )
                        _uid_key = str(user_uuid) if user_uuid else f"guest:{session_id}"
                        _btec_track(_uid_key, str(_pend_snapshot.get("topic") or ""), str(_ev.get("grade") or "M"))
                        if user_uuid:
                            _pq = str(_pend_snapshot.get("question") or "")
                            _ev_copy = dict(_ev)
                            await asyncio.get_event_loop().run_in_executor(
                                None,
                                lambda: _btec_persist(
                                    user_uuid=user_uuid,
                                    question=_pq,
                                    student_answer=_stu_turn,
                                    evaluation=_ev_copy,
                                ),
                            )
                        if not isinstance(extra_context, dict):
                            extra_context = {}
                        else:
                            extra_context = dict(extra_context)
                        _gf_train = (
                            f"تقييم التدريب BTEC: الدرجة {_ev.get('grade')}. "
                            f"{_ev.get('feedback') or ''} (مرجع: {_ev.get('source_ref') or '—'})"
                        )
                        extra_context["graded_feedback"] = _gf_train[:4000]
                        extra_context["cogni_training_mode"] = True
                        extra_context["btec_training_examiner"] = True
                        await send(
                            {
                                "type": "training_evaluation",
                                "v": 1.1,
                                "id": req_id,
                                "grade": _ev.get("grade"),
                                "feedback": _ev.get("feedback"),
                                "source_ref": _ev.get("source_ref"),
                            }
                        )
                    except Exception as _tex:
                        logger.warning("[AgentWS] BTEC training evaluate failed: %s", _tex)
                        btec_training_pending = _pend_snapshot

            # "llm_thinking" matches the frontend handler in useAgentAgent.ts:
            # `if (type === 'transcribing' || type === 'llm_thinking')`.
            # The old "thinking" type was silently dropped by the frontend.
            await send({"type": "llm_thinking", "id": req_id} if req_id else {"type": "llm_thinking"})

            # Thread grade context into the LLM context dict so _get_cogni_response
            # can splice a Debrief Context block into the system prompt.
            context: dict = {"history": history[-6:], "session_id": session_id}
            if pending_grade_nudge:
                _nudge_snapshot_for_ack = dict(pending_grade_nudge)
                context["pending_assessment_nudge"] = _nudge_snapshot_for_ack
                _nudge_for_turn = True
                # Consume immediately so format-retry / same-connection turns do not re-inject (pop semantics).
                pending_grade_nudge = None
            if focus_subject and str(focus_subject).strip():
                context["focus_subject"] = str(focus_subject).strip()[:200]
            # ADDED: thread deep-link session for tutor (RAG weighting + scaffolding)
            if deep_link_state:
                _dlc = {k: str(v).strip() for k, v in deep_link_state.items() if str(v).strip()}
                if _dlc:
                    context["deep_link"] = _dlc
                    context["deep_link_active"] = True
                    if str(_dlc.get("target") or "").lower() == "distinction":
                        context["deep_link_high_target"] = True
                    if str(_dlc.get("target") or "").lower() == "quick_review" or session_state.get(
                        "is_quick_review"
                    ):
                        context["is_quick_review"] = True
            if user_uuid:
                context["billing_user_id"] = str(user_uuid)
            context["subscription_plan"] = user_subscription_plan
            context["model_tier"] = user_model_tier
            context["user_role"] = user_role_str
            if extra_context:
                context.update(extra_context)
            if cogni_welcome_turn:
                context["cogni_welcome_turn"] = True
            _gr_source: Optional[dict] = None
            if grade_result and isinstance(grade_result, dict) and grade_result.get("final_grade"):
                _gr_source = grade_result
            elif (
                not cogni_welcome_turn
                and pending_redis_grade is not None
                and isinstance(pending_redis_grade, dict)
                and pending_redis_grade.get("final_grade")
            ):
                _gr_source = pending_redis_grade
                pending_redis_grade = None
                logger.info("[AgentWS] Debrief Context from Redis pop_grade_result (consumed)")
            if _gr_source is not None:
                import hashlib as _hl
                import json as _json

                _gf_ser = _json.dumps(
                    {
                        "achieved":         _gr_source.get("achieved"),
                        "criteria_summary": _gr_source.get("criteria_summary"),
                        "final_grade":      _gr_source.get("final_grade"),
                        "subject":          _gr_source.get("subject"),
                        "total":            _gr_source.get("total"),
                        "gaps_detail_ar":   _gr_source.get("gaps_detail_ar"),
                        "coaching_goal_ar": _gr_source.get("coaching_goal_ar"),
                    },
                    sort_keys=True,
                    default=str,
                )
                _gf_fp = _hl.sha256(_gf_ser.encode()).hexdigest()[:40]
                if _gf_fp != _ws_grade_result_delivered_fp:
                    _grade_result_fp_for_turn = _gf_fp
                    context["grade_result"] = {
                        "final_grade":      str(_gr_source.get("final_grade", "PENDING")),
                        "subject":          str(_gr_source.get("subject", "—")),
                        "criteria_summary": str(_gr_source.get("criteria_summary", "")),
                        "achieved":         int(_gr_source.get("achieved", 0)),
                        "total":            int(_gr_source.get("total", 0)),
                    }
                    _gda = str(_gr_source.get("gaps_detail_ar") or "").strip()
                    if _gda:
                        context["grade_result"]["gaps_detail_ar"] = _gda[:3500]
                    _cga = str(_gr_source.get("coaching_goal_ar") or "").strip()
                    if _cga:
                        context["grade_result"]["coaching_goal_ar"] = _cga[:1200]
                    _rex = str(_gr_source.get("report_excerpt") or "").strip()
                    if _rex:
                        context["grade_result"]["report_excerpt"] = _rex[:2000]
                    logger.info(
                        "[AgentWS] Debrief Context injected — grade=%s subject=%s",
                        context["grade_result"]["final_grade"],
                        context["grade_result"]["subject"],
                    )
                else:
                    logger.debug("[AgentWS] grade_result skipped — already delivered this connection (fp=%s)", _gf_fp[:12])

            # Thread BTEC scaffold context — uses the per-connection btec_state
            # populated by "btec_progress" WebSocket messages.
            if btec_state.get("unit_id"):
                context["btec_context"] = btec_state.copy()
                logger.info(
                    "[AgentWS] BTEC Scaffold injected — unit=%s level=%s",
                    btec_state.get("unit_id"),
                    btec_state.get("current_level"),
                )
            # Inject Triple-Persona level into LLM context
            context["persona_level"] = persona_level
            context["client_voice_rate"] = cogni_voice_rate
            context["client_voice_pitch_scale"] = cogni_voice_pitch_scale
            if thinker is not None:
                context["current_goal"] = thinker.current_goal
            _psp = (persona_system_prompt or cogni_persona_system_prompt or "").strip()
            if _psp:
                context["persona_system_prompt"] = _psp[:8000]
                logger.debug("[AgentWS] persona_system_prompt injected (len=%d)", len(context["persona_system_prompt"]))
            if emotional_context and str(emotional_context).strip():
                context["emotional_context"] = str(emotional_context).strip()[:8000]
                logger.debug("[AgentWS] emotional_context injected (len=%d)", len(context["emotional_context"]))

            try:
                _lit = think_mm.get_last_of_type("internal_thought")
                if _lit and str(_lit).strip():
                    context["last_internal_thought"] = str(_lit).strip()[:800]
            except Exception as _lit_exc:
                logger.debug("[AgentWS] last_internal_thought skipped: %s", _lit_exc)

            try:
                _alp = think_mm.get_active_lesson_plan()
                if _alp and str(_alp).strip():
                    context["active_lesson_plan"] = str(_alp).strip()[:8000]
            except Exception as _alp_exc:
                logger.debug("[AgentWS] active_lesson_plan skipped: %s", _alp_exc)

            if thinker_proactive:
                context["thinker_proactive_speech"] = True

            # ── Proactive engagement: silence timer → SYSTEM_EVENT (LLM ice-breaker, not raw system text)
            _raw_ut = user_text or ""
            if "[SYSTEM_EVENT:" in _raw_ut and any(
                k in _raw_ut
                for k in ("صمت", "صامت", "سكوت", "هدوء", "quiet", "silence", "idle", "silent")
            ):
                context["proactive_engagement"] = True

            # ── Long-term episodic memory (vector DB / fallback) — retrieve before LLM
            try:
                from app.archive.emotional_memory import retrieve_for_prompt

                _q = strip_internal_llm_markers(user_text).strip()[:2000]
                if _q:
                    _mem = retrieve_for_prompt(episodic_scope_id, _q, k=4)
                    if _mem:
                        context["episodic_memory"] = _mem
                        logger.debug("[AgentWS] episodic_memory injected (len=%d)", len(_mem))
            except Exception as _mem_exc:
                logger.debug("[AgentWS] episodic retrieve skipped: %s", _mem_exc)

            # Phase B — recent graded answers for personalization (logged-in users)
            if user_uuid:
                try:
                    from app.database import SessionLocal as _SL
                    from app.services.curriculum_service import recent_assessment_lines as _ral

                    _db = _SL()
                    try:
                        _block = _ral(_db, user_uuid, limit=5)
                        if _block and "assessment_history" not in context:
                            context["assessment_history"] = _block
                    finally:
                        _db.close()
                except Exception as _ah:
                    logger.debug("[AgentWS] assessment_history skipped: %s", _ah)

            try:
                context["student_understanding_score"] = think_mm.student_understanding_score
                context["preferred_teaching_style"] = think_mm.preferred_teaching_style
            except Exception as _su_exc:
                logger.warning(
                    "%s think_mm student_understanding/teaching_style read failed: %s",
                    _proc_ctx,
                    _su_exc,
                    exc_info=True,
                )

            # V28 — theory of mind, persona traits, timeline, device context
            try:
                from app.database import SessionLocal as _SL_V28
                from app.services.digital_human_context import enrich_ws_tutor_context

                if user_uuid:
                    _v28 = _SL_V28()
                    try:
                        enrich_ws_tutor_context(
                            _v28,
                            user_uuid,
                            user_state.get("perception") or {},
                            user_state.get("device") or {},
                            context,
                        )
                    finally:
                        _v28.close()
                else:
                    enrich_ws_tutor_context(
                        None,
                        None,
                        user_state.get("perception") or {},
                        user_state.get("device") or {},
                        context,
                    )
            except Exception as _v28x:
                logger.debug("[AgentWS] v28 enrich skipped: %s", _v28x)

            # V31 — re-assert pedagogical state after V28 enrich (authoritative for lesson flow)
            if thinker is not None:
                context["current_goal"] = thinker.current_goal
            try:
                _alp_final = think_mm.get_active_lesson_plan()
                if _alp_final and str(_alp_final).strip():
                    context["active_lesson_plan"] = str(_alp_final).strip()[:8000]
            except Exception as _alp_re_exc:
                logger.debug("%s active_lesson_plan re-read skipped: %s", _proc_ctx, _alp_re_exc)
            try:
                _lit2 = think_mm.get_last_of_type("internal_thought")
                if _lit2 and str(_lit2).strip():
                    context["last_internal_thought"] = str(_lit2).strip()[:800]
            except Exception as _lit_re_exc:
                logger.debug("%s last_internal_thought re-read skipped: %s", _proc_ctx, _lit_re_exc)

            # FIX-1: Enforce Socratic scaffolding in WS path — Cogni must guide,
            # not deliver ready answers. The base _SCAFFOLDING_TUTOR_BLOCK_AR is
            # already appended inside _get_cogni_response; this flag adds a brief
            # gatekeeper rule PREPENDED to the system prompt for extra compliance.
            context["enforce_socratic"] = True
            # Optional structured avatar behavior plan (JSON envelope only — see tutor addon).
            context["include_avatar_behavior_plan"] = True

            try:
                _llm_t0 = time.monotonic()
                reply_text = await _get_dr_hamza_response(user_text, context)
                logger.info(
                    "%s tutor LLM+RAG path done duration_sec=%.3f reply_len=%d",
                    _proc_ctx,
                    time.monotonic() - _llm_t0,
                    len(reply_text or ""),
                )
                # Consume-once: debrief keys must not survive format-retry or the next user turn (anti-parrot).
                context.pop("pending_assessment_nudge", None)
                context.pop("grade_result", None)
                if _grade_result_fp_for_turn:
                    _ws_grade_result_delivered_fp = _grade_result_fp_for_turn

                _strict_json = cogni_strict_json_enabled()
                if not _strict_json:
                    if not verify_cogni_reply_format(reply_text):
                        logger.warning("[AgentWS] Pass-1 format fail — retrying")
                        suffix = "\n\n[SYSTEM] يجب أن يكون ردك بالتنسيق الثلاثي: سطر الحوار\n*سطر الحركة*\n[EMOTION: tag]"
                        reply_text = await _get_dr_hamza_response(user_text + suffix, context)

                    if not verify_cogni_reply_format(reply_text):
                        logger.warning("[AgentWS] Pass-2 format fail — applying patch")
                        reply_text = _patch_format(reply_text)
                else:
                    logger.info(
                        "%s COGNI_STRICT_JSON_MODE on — skipping legacy triple-line verify",
                        _proc_ctx,
                    )

                for ev in context.pop("_cogni_tool_events", []) or []:
                    try:
                        await send({"type": "tool_result", "v": 1.1, "id": req_id, **ev})
                    except Exception as _tool_send_exc:
                        logger.warning(
                            "%s tool_result send failed: %s",
                            _proc_ctx,
                            _tool_send_exc,
                            exc_info=True,
                        )
                for _btec_fr in context.pop("_cogni_btec_ws_frames", []) or []:
                    try:
                        await send({"type": "btec_update", "v": 1.1, "id": req_id, **_btec_fr})
                    except Exception as _btec_send_exc:
                        logger.warning(
                            "%s btec_update send failed: %s",
                            _proc_ctx,
                            _btec_send_exc,
                            exc_info=True,
                        )

                parsed: Dict[str, Any]
                _strict_ok = False
                if _strict_json:
                    try:
                        parsed = parse_llm_reply_strict_json(reply_text)
                        _strict_ok = True
                    except ValueError as _strict_exc:
                        logger.warning(
                            "%s strict JSON parse failed, legacy path: %s",
                            _proc_ctx,
                            _strict_exc,
                        )
                        _strict_ok = False

                if not _strict_json or not _strict_ok:
                    # Legacy: inline [gesture] tokens → performance[]; optional behavior layers.
                    parsed = parse_reply_with_inline_gestures(reply_text)
                    parsed["dialogue"] = strip_internal_llm_markers(
                        parsed.get("dialogue", "") or ""
                    ).strip()
                    _reply_meta_ws = context.get("_reply_meta") or {}
                    parsed["performance"] = _pedagogical_performance_supplement(
                        parsed.get("dialogue") or "",
                        parsed.get("performance"),
                        pedagogical_stage=str(_reply_meta_ws.get("pedagogical_stage") or "").strip() or None,
                    )
                    try:
                        from app.services.cogni_behavior import augment_ws_reply_gestures

                        _rb = None
                        if isinstance(_reply_meta_ws, dict):
                            _rb = _reply_meta_ws.get("rule_based_intent")
                        augment_ws_reply_gestures(
                            parsed,
                            user_text or "",
                            ws_client_intent=ws_client_intent,
                            rule_based_intent=str(_rb).strip() if _rb else None,
                        )
                    except Exception as _beh_exc:
                        logger.debug("[AgentWS] behavior layer skipped: %s", _beh_exc)
                    try:
                        from app.services.behavior_ws_bridge import maybe_apply_behavior_engine_to_parsed

                        maybe_apply_behavior_engine_to_parsed(
                            parsed,
                            user_text=user_text or "",
                            ws_client_intent=ws_client_intent,
                            reply_meta=_reply_meta_ws if isinstance(_reply_meta_ws, dict) else {},
                            conversation_turn=len(history),
                            session_id=session_id,
                        )
                    except Exception as _be_exc:
                        logger.debug("[AgentWS] weighted behavior engine skipped: %s", _be_exc)
                if _nudge_for_turn:
                    pending_grade_nudge = None
                    _nudge_scope = user_uuid or linked_eval_uuid
                    if _nudge_scope and _nudge_snapshot_for_ack:
                        try:
                            from app.services.session_state_redis import (
                                acknowledge_evaluation_nudge,
                                evaluation_nudge_instance_id,
                            )

                            acknowledge_evaluation_nudge(_nudge_scope, _nudge_snapshot_for_ack)
                            _eval_nudge_instance_acks_ws.append(
                                evaluation_nudge_instance_id(_nudge_snapshot_for_ack)
                            )
                        except Exception as _nack:
                            logger.debug("%s acknowledge_evaluation_nudge: %s", _proc_ctx, _nack)
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
                    logger.error("🔥 FATAL [AgentWS] LLM runtime error: %s", e, exc_info=True)
                    await send({"type": "error", "id": req_id, "error": {"message": "حدث خطأ مؤقت، حاول مرة ثانية.", "detail": str(e), "severity": "error", "code": "llm_runtime_error"}})
                return
            except Exception as e:
                logger.error("🔥 FATAL [AgentWS] unhandled error: %s", e, exc_info=True)
                await send({"type": "error", "id": req_id, "error": {"message": "حدث خطأ مؤقت، حاول مرة ثانية.", "detail": str(e), "severity": "error", "code": "llm_unhandled_error"}})
                return

            # Save to history (لا تخزّن نص [SYSTEM_EVENT:…] كرسالة مستخدم)
            _u_hist = strip_internal_llm_markers(user_text).strip()
            if not _u_hist:
                _u_hist = "بدء تفاعل تلقائي من النظام."
            user_mood = _infer_user_mood_from_text(_u_hist)
            user_pad = _USER_MOOD_PAD.get(user_mood, _USER_MOOD_PAD["neutral"])
            history.append({"user": _u_hist, "assistant": parsed["dialogue"]})
            if len(history) > 6:
                history[:] = history[-6:]

            # Persist episodic turn for future retrieval (best-effort)
            try:
                from app.archive.emotional_memory import add_episode

                add_episode(
                    episodic_scope_id,
                    _u_hist[:800],
                    parsed["dialogue"][:800],
                    parsed.get("emotion", "neutral"),
                    user_mood=user_mood,
                )
            except Exception as _add_exc:
                logger.debug("[AgentWS] episodic add skipped: %s", _add_exc)

            try:
                think_mm.observe_dialogue_turn(
                    _u_hist,
                    parsed["dialogue"],
                    user_mood=user_mood,
                    avatar_emotion=str(parsed.get("emotion", "neutral")),
                )
                _gfb = None
                if isinstance(extra_context, dict):
                    _gfb = extra_context.get("graded_feedback")
                think_mm.adjust_understanding_and_style(_u_hist, graded_feedback=_gfb)
            except Exception as _observe_exc:
                logger.warning(
                    "%s think_mm.observe_dialogue_turn/adjust_understanding failed: %s",
                    _proc_ctx,
                    _observe_exc,
                    exc_info=True,
                )

            # Shadow analytics: log completed LLM turn (fire-and-forget)
            asyncio.ensure_future(
                _analytics.log_turn(
                    transcript=_u_hist,
                    dialogue=parsed['dialogue'],
                    emotion=parsed.get('emotion', 'neutral'),
                )
            )

            contagion_hint: dict = {}
            try:
                from app.services.digital_human_context import contagion_avatar_hint

                contagion_hint = contagion_avatar_hint(
                    (user_state.get("perception") or {}).get("emotion")
                ) or {}
            except Exception as _cont_exc:
                logger.debug("%s contagion_avatar_hint skipped: %s", _proc_ctx, _cont_exc)

            # ── Azure Neural TTS (ar-JO-TaimNeural — male, Jordanian Arabic) ────────
            audio_b64 = ""
            viseme_cues = []
            word_cues = []
            azure_tts = getattr(websocket.app.state, 'tts_service', None) or _get_azure_tts()

            playing_tts = True
            try:
                if azure_tts and parsed['dialogue']:
                    from app.archive.tts_diagnostics import classify_tts_failure, log_tts_success

                    _ak = bool((getattr(settings, "AZURE_SPEECH_KEY", None) or "").strip())
                    _ar = str(getattr(settings, "AZURE_SPEECH_REGION", None) or "").strip()
                    _dlen = len(parsed.get("dialogue") or "")
                    _vname = str(settings.TTS_ARABIC_VOICE or azure_tts._default_voice or "")
                    try:
                        mp3_bytes, viseme_cues, word_cues, tts_provider = await azure_tts.synthesize(
                            parsed['dialogue'],
                            voice_name=settings.TTS_ARABIC_VOICE,
                            emotion=parsed.get('emotion', 'neutral'),
                            persona_level=persona_level,
                            client_voice_rate=cogni_voice_rate,
                            client_pitch_scale=cogni_voice_pitch_scale,
                            usage_user_id=user_uuid,
                        )

                        if tts_provider != "azure":
                            raise RuntimeError(
                                f"TTS integrity violation: expected Azure, got {tts_provider!r}"
                            )
                        if not mp3_bytes:
                            raise RuntimeError("Azure TTS returned empty audio")

                        audio_b64 = base64.b64encode(mp3_bytes).decode('ascii')
                        log_tts_success(
                            source=tts_provider,
                            text_len=_dlen,
                            audio_bytes=len(mp3_bytes),
                            viseme_n=len(viseme_cues),
                            word_n=len(word_cues),
                            voice=_vname,
                        )
                    except Exception as e:
                        _code, _human = classify_tts_failure(
                            e, azure_key_set=_ak, azure_region=_ar, edge_attempted=False,
                        )
                        logger.error(
                            "[AgentWS] TTS synthesis failed (Azure-only) | "
                            "code=%s | detail=%s | exc_type=%s | exc=%s",
                            _code,
                            _human,
                            type(e).__name__,
                            e,
                            exc_info=True,
                        )

                # Lip-sync: same synthesis produced word_cues; approximate visemes if SDK omitted them (no extra TTS).
                if audio_b64 and not viseme_cues and word_cues:
                    from app.services.tts_service import approx_viseme_cues_from_word_cues

                    viseme_cues = approx_viseme_cues_from_word_cues(word_cues, parsed["dialogue"])
                    logger.info(
                        "[AgentWS] viseme timeline from word_cues | approx=%d (no duplicate synthesis)",
                        len(viseme_cues),
                    )

                def _dedupe_tts_dialogue_outbound(raw: str) -> str:
                    d = (raw or "").strip()
                    if not d:
                        return raw or ""
                    last = (last_outbound_dialogue or "").strip()
                    if last and d == last:
                        return "لحظة — " + (raw or "")
                    return raw or ""

                _meta_out = context.get("_reply_meta") or {}
                if audio_b64:
                    d_out = parsed["dialogue"]
                    last_outbound_dialogue = d_out
                    await send({
                        "type":         "speech",
                        "id":           req_id,
                        "transcript":   user_text,
                        "reply":        reply_text,
                        "dialogue":     d_out,
                        "action":       parsed['action'],
                        "emotion":      parsed['emotion'],
                        "performance":  parsed.get("performance") or [],
                        "gestures":     parsed.get("gestures") or [],
                        "motor_commands": parsed.get("motor_commands"),
                        "awareness_cues": parsed.get("awareness_cues"),
                        "internal_monologue": parsed.get("internal_monologue"),
                        "user_mood":    user_mood,
                        "user_pad":     user_pad,
                        "persona_level": persona_level,
                        "audio_base64": audio_b64,
                        "audio_format": "mp3",
                        "viseme_cues":  viseme_cues,
                        "word_cues":    word_cues,
                        "contagion":    contagion_hint,
                        "pedagogical_stage": _meta_out.get("pedagogical_stage"),
                        "tutorial_unit_id": _meta_out.get("tutorial_unit_id"),
                        "student_state": parsed.get("student_state") or context.get("cogni_inferred_student_state"),
                        "student_confidence": parsed.get("student_confidence"),
                        "student_engagement": parsed.get("student_engagement"),
                        "teaching_strategy": parsed.get("teaching_strategy") or context.get("cogni_teaching_strategy"),
                        "psychological_analysis": parsed.get("psychological_analysis"),
                        "behavior": parsed.get("behavior"),
                    })
                else:
                    d_out = _dedupe_tts_dialogue_outbound(parsed["dialogue"])
                    last_outbound_dialogue = d_out
                    await send({
                        "type":       "tts_unavailable",
                        "id":         req_id,
                        "transcript": user_text,
                        "reply":      reply_text,
                        "dialogue":   d_out,
                        "action":     parsed['action'],
                        "emotion":    parsed['emotion'],
                        "performance": parsed.get("performance") or [],
                        "gestures":    parsed.get("gestures") or [],
                        "motor_commands": parsed.get("motor_commands"),
                        "awareness_cues": parsed.get("awareness_cues"),
                        "internal_monologue": parsed.get("internal_monologue"),
                        "user_mood":  user_mood,
                        "user_pad":   user_pad,
                        "persona_level": persona_level,
                        "contagion":  contagion_hint,
                        "pedagogical_stage": _meta_out.get("pedagogical_stage"),
                        "tutorial_unit_id": _meta_out.get("tutorial_unit_id"),
                        "student_state": parsed.get("student_state") or context.get("cogni_inferred_student_state"),
                        "student_confidence": parsed.get("student_confidence"),
                        "student_engagement": parsed.get("student_engagement"),
                        "teaching_strategy": parsed.get("teaching_strategy") or context.get("cogni_teaching_strategy"),
                        "psychological_analysis": parsed.get("psychological_analysis"),
                        "behavior": parsed.get("behavior"),
                    })
                if cogni_welcome_turn and user_uuid and settings.ENABLE_REDIS_SESSION_SYNC:
                    try:
                        from app.services.session_state_redis import load_session_state, save_session_state

                        _hg = load_session_state(user_uuid) or {}
                        _hg["has_greeted"] = True
                        save_session_state(user_uuid, _hg)
                    except Exception as _hg_e:
                        logger.debug("[AgentWS] has_greeted Redis save: %s", _hg_e)
                try:
                    from app.services.tutorial_session_bridge import mark_expects_mini_after_assistant_reply

                    mark_expects_mini_after_assistant_reply(
                        user_uuid,
                        _meta_out.get("tutorial_unit_id"),
                        parsed.get("dialogue") or "",
                    )
                except Exception as _me:
                    logger.debug("[AgentWS] mark_expects_mini_after_assistant_reply: %s", _me)
            finally:
                _grace = float(getattr(settings, "TTS_PLAYBACK_GRACE_SEC", 0.5))

                async def _reset_playing_tts_after_grace() -> None:
                    nonlocal playing_tts
                    try:
                        await asyncio.sleep(max(0.05, _grace))
                    finally:
                        playing_tts = False

                asyncio.create_task(_reset_playing_tts_after_grace())

        finally:
            logger.debug(
                "%s process_text finished elapsed_sec=%.3f",
                _proc_ctx,
                time.monotonic() - _proc_t0,
            )
            pipeline_busy = False

    async def _trigger_proactive_speech() -> None:
        """Thinker-initiated ice-breaker — prompt uses last inner thought; then touch idle clock once."""
        nonlocal active_llm_task, pipeline_busy, playing_tts
        if user_dnd:
            logger.info("[AgentWS] proactive skip — DND mode | session_id=%s", session_id)
            return
        try:
            from app.api.v1.endpoints.tutor import is_llm_paused

            if is_llm_paused():
                logger.info(
                    "[AgentWS] proactive skip — LLM paused (cooldown / quota failure backoff) session_id=%s",
                    session_id,
                )
                return
        except Exception as _imp:
            logger.debug("[AgentWS] is_llm_paused check skipped: %s", _imp)
        if pipeline_busy or playing_tts:
            logger.debug("[AgentWS] proactive skip — pipeline_busy=%s playing_tts=%s", pipeline_busy, playing_tts)
            return
        if active_llm_task is not None and not active_llm_task.done():
            logger.debug("[AgentWS] proactive skip — active_llm_task")
            return
        req_id = f"proactive_{int(time.time() * 1000)}"
        last_thought: Optional[str] = None
        try:
            last_thought = think_mm.get_last_of_type("internal_thought")
        except Exception as _lt:
            logger.debug("[AgentWS] proactive last_thought: %s", _lt)
        if last_thought and str(last_thought).strip():
            lt = str(last_thought).strip()[:400]
            prompt = (
                f"[SYSTEM_EVENT: الطالب صامت. آخر فكرة داخليّة لك كانت: «{lt}». "
                "بادر فوراً بسؤال تعليمي ذكي بلهجة أردنية مبسّطة لجعله يشارك، بناءً على هذه الفكرة. "
                "لا تقل مرحباً أو كيف حالك؛ ادخل في الموضوع مباشرة.]"
            )
        else:
            prompt = (
                "[SYSTEM_EVENT: الطالب صامت. اطرح سؤالاً تفاعلياً واحداً من صميم المنهاج الأردني لكسر الجليد. "
                "لا تستخدم التحيات العامة كردٍ كامل.]"
            )
        logger.info("[AgentWS] Thinker proactive speech | req_id=%s has_inner_thought=%s", req_id, bool(last_thought))
        await process_text(
            user_text=prompt,
            req_id=req_id,
            thinker_proactive=True,
        )
        # Virtual interaction: resets idle window so Thinker does not immediately re-fire.
        _touch_interaction()
        logger.debug("[AgentWS] proactive done — last_interaction_time refreshed (virtual turn)")

    async def _trigger_soft_nudge() -> None:
        """Short Jordanian line after inner thought + gated silence — not a full proactive turn."""
        nonlocal active_llm_task, pipeline_busy, playing_tts
        if user_dnd:
            return
        try:
            from app.api.v1.endpoints.tutor import is_llm_paused

            if is_llm_paused():
                return
        except Exception as _imp_sn:
            logger.debug("%s is_llm_paused check skipped (soft_nudge): %s", _ws_ctx(session_id), _imp_sn)
        if pipeline_busy or playing_tts:
            return
        if active_llm_task is not None and not active_llm_task.done():
            return
        req_id = f"soft_nudge_{int(time.time() * 1000)}"
        _nudge_pool = (
            "[SYSTEM_EVENT: جملة واحدة قصيرة بالأردنية — «هل تحتاج مساعدة؟» — بدون تحية طويلة.]",
            "[SYSTEM_EVENT: سطر واحد بالأردنية — «بدي أتأكد إنك معي، في عندك سؤال؟»]",
            "[SYSTEM_EVENT: قل باختصار بالأردنية — «لا تتردد تسألني إذا واجهتك صعوبة.»]",
            "[SYSTEM_EVENT: جملة دافئة قصيرة — «خذ راحتك، أنا هون إذا بدك توضيح.»]",
            "[SYSTEM_EVENT: سؤال واحد بالأردنية — «بدك نرجع نشرح نقطة معيّنة؟»]",
            "[SYSTEM_EVENT: تلميح قصير — «إذا حاب نمشي خطوة خطوة، قل لي.»]",
            "[SYSTEM_EVENT: جملة واحدة — «شو اللي محيّرك هلق؟»]",
            "[SYSTEM_EVENT: تشجيع خفيف — «أنا جاهز نكمّل لما تكون جاهز.»]",
        )
        import random as _rnd

        prompt = _rnd.choice(_nudge_pool)
        logger.info("[AgentWS] Thinker soft nudge | req_id=%s", req_id)
        await process_text(user_text=prompt, req_id=req_id)

    try:
        _tiv = int(os.getenv("THINKER_INTERVAL_SEC", "45"))
    except ValueError:
        _tiv = 45
    try:
        _idle_sec = int(os.getenv("THINKER_IDLE_THRESHOLD_SEC", "15"))
    except ValueError:
        _idle_sec = 15
    try:
        thinker = Thinker(
            memory_manager=think_mm,
            interval_seconds=max(20, _tiv),
            idle_threshold_seconds=max(5, _idle_sec),
            get_last_interaction=lambda: last_interaction_time,
            is_llm_busy=lambda: (
                (active_llm_task is not None and not active_llm_task.done()) or pipeline_busy
            ),
            is_tts_playing=lambda: playing_tts,
            on_proactive=_trigger_proactive_speech,
            on_goal_change=_notify_goal,
            on_soft_nudge=_trigger_soft_nudge,
        )
        await thinker.start()
        logger.info(
            "[AgentWS] Thinker started | session_id=%s interval=%ss idle_threshold=%ss proactive_thoughts=%s cooldown=%ss",
            session_id,
            max(20, _tiv),
            max(5, _idle_sec),
            settings.PROACTIVE_THOUGHT_COUNT,
            settings.PROACTIVE_COOLDOWN_SEC,
        )
    except Exception as _thx:
        logger.warning("[AgentWS] Thinker not started: %s", _thx)
        thinker = None

    def _load_latest_grade_for_user() -> None:
        """
        Prime pending_grade_nudge from persisted evaluations (Postgres or in-memory repo).
        Tries JWT user first, then optional student_device_id (same id as assessment student_id).
        """
        nonlocal pending_grade_nudge
        if pending_grade_nudge is not None:
            return
        candidates: List[uuid.UUID] = []
        if user_uuid:
            candidates.append(user_uuid)
        if linked_eval_uuid and linked_eval_uuid not in candidates:
            candidates.append(linked_eval_uuid)
        if not candidates:
            return
        try:
            from app.repository.evaluations import DatabaseUnavailableError, get_evaluation_repo

            repo = get_evaluation_repo()
        except DatabaseUnavailableError:
            logger.debug("[AgentWS] evaluation repo unavailable — skip grade prime")
            return
        except Exception as _repo_e:
            logger.debug("[AgentWS] get_evaluation_repo failed: %s", _repo_e)
            return

        if not hasattr(repo, "get_latest_nudge_payload_for_student"):
            return

        from app.services.session_state_redis import (
            evaluation_nudge_instance_id,
            is_evaluation_nudge_acknowledged,
            load_session_state,
        )

        _nudge_scope = user_uuid or linked_eval_uuid

        def _nudge_already_delivered(snap: dict) -> bool:
            if _nudge_scope and is_evaluation_nudge_acknowledged(_nudge_scope, snap):
                return True
            if _nudge_scope:
                try:
                    ex = load_session_state(_nudge_scope) or {}
                    iid = evaluation_nudge_instance_id(snap)
                    if iid in set(str(x) for x in (ex.get("eval_nudge_ack_ids") or [])):
                        return True
                except Exception as _exl:
                    logger.debug("[AgentWS] nudge ack session blob check: %s", _exl)
            return False

        for uid in candidates:
            try:
                snap = repo.get_latest_nudge_payload_for_student(str(uid))
            except Exception as _le:
                logger.debug("[AgentWS] get_latest_nudge_payload_for_student(%s): %s", uid, _le)
                snap = None
            if snap:
                if _nudge_already_delivered(snap):
                    logger.debug(
                        "[AgentWS] Latest evaluation nudge already acknowledged — skip prime | scope=%s",
                        _nudge_scope,
                    )
                    return
                pending_grade_nudge = snap
                logger.info(
                    "[AgentWS] Latest evaluation nudge primed grade=%s tried_ids=%s",
                    snap.get("grade"),
                    [str(u) for u in candidates],
                )
                return

    _load_latest_grade_for_user()
    if pending_grade_nudge is None and user_uuid and settings.ENABLE_REDIS_SESSION_SYNC:
        try:
            import json as _json

            from app.services.session_state_redis import pop_grade_result, pop_nudge

            _raw_nudge = pop_nudge(user_uuid)
            if _raw_nudge:
                pending_grade_nudge = _json.loads(_raw_nudge)
                logger.info("[AgentWS] Primed pending_grade_nudge from Redis (consumed)")
            _raw_grade = pop_grade_result(user_uuid)
            if _raw_grade:
                pending_redis_grade = _json.loads(_raw_grade)
                logger.info("[AgentWS] Primed pending_redis_grade from Redis (consumed)")
        except Exception as _pn_e:
            logger.debug("[AgentWS] Redis pop_nudge/pop_grade on connect: %s", _pn_e)

    # ── One-shot welcome greeting on connect ─────────────────────────────────
    # Fires once per WebSocket connection (~0.6 s after accept) so the avatar
    # greets the student in Jordanian Arabic without waiting for a user message.
    # The frontend hasInitiated guard prevents a second greeting from the
    # smart-heartbeat idle timer (IDLE_TIMEOUT = 1 s) from doubling up:
    # by the time that timer fires the avatar is already speaking / hasInitiated=true.
    _connect_greeted = False  # per-connection one-shot flag

    async def _send_welcome() -> None:
        nonlocal _connect_greeted, active_llm_task
        await asyncio.sleep(0.6)
        if user_dnd:
            _connect_greeted = True
            logger.info("[AgentWS] welcome skipped — DND mode")
            return
        if user_uuid and settings.ENABLE_REDIS_SESSION_SYNC:
            try:
                from app.services.session_state_redis import load_session_state

                if (load_session_state(user_uuid) or {}).get("has_greeted"):
                    _connect_greeted = True
                    logger.info("[AgentWS] welcome skipped — has_greeted (Redis)")
                    return
            except Exception as _wg:
                logger.debug("[AgentWS] welcome Redis has_greeted check: %s", _wg)
        if _connect_greeted:
            return
        # If the student already started a turn, skip auto-greet (avoid interrupting them)
        if active_llm_task and not active_llm_task.done():
            _connect_greeted = True
            logger.info("[AgentWS] welcome skipped — user turn already active")
            return
        _connect_greeted = True

        _welcome_events = [
            (
                '[SYSTEM_EVENT: قدّم نفسك باللهجة الأردنية — ابدأ بـ "السلام عليكم"، وعرّف نفسك كـ كوجني '
                "من إيدوفيرس، ثم اسأل بجملة قصيرة واحدة: شو الموضوع اللي حابب نبلّش فيه اليوم؟ لا تزيد عن جملتين.]"
            ),
            (
                '[SYSTEM_EVENT: ترحيب دافئ بالأردنية: سلّم، قدّم نفسك كمعلّم رقمي كوجني، '
                "واسأل الطالب شو يحسّ حاله جاهز يتعلّمه أو يستذكره هالجلسة — بدون تكرار عبارات ترحيبية نمطية.]"
            ),
            (
                '[SYSTEM_EVENT: ابدأ بتحية أردنية طبيعية، عرّف نفسك ككوجني، '
                "واختر سؤالاً مفتوحاً مختلفاً عن المرات السابقة (مثلاً عن هدفه من الجلسة أو شيء يشوّقه للدرس).]"
            ),
        ]

        async def _greet() -> None:
            await process_text(
                random.choice(_welcome_events),
                req_id="greet_0",
                cogni_welcome_turn=True,
            )

        active_llm_task = asyncio.create_task(_greet())
        # ═══ NEW ═══
        _track_llm_task(active_llm_task)
        # ═══ NEW END ═══

    asyncio.create_task(_send_welcome())

    # ADDED: apply teacher deep-link payload (WebSocket or optional persona_init fields)
    async def _apply_deep_link_config_message(msg: dict) -> None:
        nonlocal deep_link_state, focus_subject, _connect_greeted, session_state
        du = str(msg.get("unit") or "").strip()[:512]
        tgt = _normalize_deep_link_target(str(msg.get("target") or ""))
        sj = str(msg.get("subject") or "").strip()[:256]
        if du:
            deep_link_state["unit"] = du
        if tgt:
            deep_link_state["target"] = tgt
            if tgt == "quick_review":
                session_state["is_quick_review"] = True
            elif tgt in ("pass", "merit", "distinction"):
                session_state["is_quick_review"] = False
        if sj:
            deep_link_state["subject"] = sj
        if sj and not (focus_subject and str(focus_subject).strip()):
            focus_subject = sj
        elif du and not (focus_subject and str(focus_subject).strip()):
            focus_subject = du[:200]
        await send({"type": "deep_link_ack", "v": 1.1, "deep_link": dict(deep_link_state)})
        logger.info("[AgentWS] deep_link_config — unit=%s target=%s", du or "—", tgt or "—")
        # ADDED: proactive DEEP_LINK_TRIGGER (replaces default welcome when unit+target present)
        if du and tgt:
            _connect_greeted = True
            req_dl = str(msg.get("id") or f"deeplink_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}")
            dl_copy = dict(deep_link_state)
            await start_user_turn(
                user_text="[SYSTEM_EVENT: DEEP_LINK_TRIGGER]",
                req_id=req_dl,
                extra_context={
                    "deep_link": dl_copy,
                    "deep_link_trigger_event": True,
                },
            )

    # ── Message loop ─────────────────────────────────────────────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send({"type": "error", "error": {"message": "invalid_json", "severity": "warn"}})
                continue

            try:
                validate_ws_client_message(msg)
            except ValueError as sec_e:
                await send({
                    "type": "error",
                    "error": {
                        "message": str(sec_e),
                        "severity": "warn",
                        "code": "security_violation",
                    },
                })
                logger.warning(
                    "[AgentWS] security_violation | %s | %s",
                    _ws_ctx(session_id, ws_req_id),
                    sec_e,
                )
                continue

            msg_type = msg.get("type", "")

            # Voice: STT then reuse the full `text` frame pipeline (practice, BTEC training, focus, coaching).
            if msg_type == "audio":
                _touch_interaction()
                req_audio = str(msg.get("id") or f"audio_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}")
                b64 = msg.get("data") or ""
                try:
                    raw_audio = base64.b64decode(b64, validate=True) if isinstance(b64, str) else b""
                except Exception:
                    await send(
                        {
                            "type": "error",
                            "v": 1.1,
                            "id": req_audio,
                            "error": {
                                "message": "audio_decode_failed",
                                "severity": "warn",
                                "code": "audio_decode_failed",
                            },
                        }
                    )
                    continue
                await send({"type": "transcribing", "v": 1.1, "id": req_audio})
                try:
                    from app.services.whisper_stt import transcribe_audio as _transcribe_audio

                    _mime_a = msg.get("mime_type") or msg.get("mime")
                    _mime_s = str(_mime_a).strip()[:128] if _mime_a else None
                    transcript_clean = (
                        await _transcribe_audio(raw_audio, mime_type=_mime_s, req_id=req_audio)
                    ).strip()
                except Exception as stt_exc:
                    _code = getattr(stt_exc, "code", None)
                    err_code = str(_code) if _code else "stt_error"
                    _detail = getattr(stt_exc, "detail", None) or str(stt_exc)
                    if _code == "audio_too_short":
                        err_code = "audio_too_short"
                    await send(
                        {
                            "type": "error",
                            "v": 1.1,
                            "id": req_audio,
                            "error": {
                                "message": err_code,
                                "severity": "warn",
                                "code": err_code,
                                "detail": str(_detail)[:300],
                            },
                        }
                    )
                    continue
                if not transcript_clean:
                    await send(
                        {
                            "type": "error",
                            "v": 1.1,
                            "id": req_audio,
                            "error": {
                                "message": "empty_transcript",
                                "severity": "warn",
                                "code": "empty_transcript",
                            },
                        }
                    )
                    continue
                msg["type"] = "text"
                msg["text"] = transcript_clean
                msg_type = "text"

            if msg_type == "ping":
                # v1.1: echo back the id so client can correlate heartbeat latency
                await send({"type": "pong", "id": msg.get("id", "pong")})

            elif msg_type == "pong":
                # Client acknowledging our heartbeat — nothing to do besides log
                logger.debug("[WS] pong received id=%s", msg.get("id", "?"))

            elif msg_type in ("auth", "authenticate"):
                # Client sends auth first even when JWT was already accepted via Sec-WebSocket-Protocol
                # (avoids auth_required if proxies strip the second protocol value).
                logger.debug("[AgentWS] post-handshake auth frame ignored (already authenticated)")

            # ═══ NEW ═══
            elif msg_type == "user_interrupt":
                _touch_interaction()
                logger.info("[AgentWS] user_interrupt — cancelling in-flight turn session_id=%s", session_id[:8])
                await cancel_in_flight("user_interrupt")
                continue
            # ═══ NEW END ═══

            elif msg_type == "persona_init":
                # Server-owned persona only — client system_prompt is ignored (prompt-injection hardening).
                if msg.get("system_prompt") or msg.get("systemPrompt"):
                    logger.info(
                        "[AgentWS] persona_init — ignoring client system_prompt (server-owned persona)",
                    )
                try:
                    from app.api.v1.endpoints import tutor as _tutor_mod

                    if _tutor_mod._cogni_performance_json_enabled():
                        cogni_persona_system_prompt = _tutor_mod._PROFESSOR_COGNI_BUSINESS_JSON_SYSTEM
                    else:
                        cogni_persona_system_prompt = (
                            _tutor_mod._DEFAULT_PERSONA_SYSTEM_AR + _tutor_mod._SCAFFOLDING_TUTOR_BLOCK_AR
                        ).strip()
                    logger.info(
                        "[AgentWS] persona_init — server persona applied len=%d",
                        len(cogni_persona_system_prompt or ""),
                    )
                except Exception as _pe:
                    logger.warning("[AgentWS] server persona load failed: %s", _pe)
                    cogni_persona_system_prompt = None
                vd = msg.get("voice_defaults") or msg.get("voiceDefaults")
                if isinstance(vd, dict):
                    try:
                        cogni_voice_rate = max(0.72, min(1.22, float(vd.get("rate", 1.0))))
                    except (TypeError, ValueError) as _vr_exc:
                        logger.warning(
                            "%s persona_init voice rate invalid, keeping default: %s",
                            _ws_ctx(session_id),
                            _vr_exc,
                        )
                    try:
                        ps = vd.get("pitchScale", vd.get("pitch_scale", 1.0))
                        cogni_voice_pitch_scale = max(0.88, min(1.18, float(ps)))
                    except (TypeError, ValueError) as _vp_exc:
                        logger.warning(
                            "%s persona_init voice pitchScale invalid, keeping default: %s",
                            _ws_ctx(session_id),
                            _vp_exc,
                        )
                    logger.info(
                        "[AgentWS] persona_init — voice_defaults rate=%.3f pitchScale=%.3f",
                        cogni_voice_rate,
                        cogni_voice_pitch_scale,
                    )
                # ADDED: optional deep-link fields on persona_init (same as deep_link_config)
                _pdu = str(msg.get("unit") or msg.get("initialUnit") or "").strip()[:512]
                _pdt = str(msg.get("target") or msg.get("initialTarget") or "").strip()
                _pds = str(msg.get("subject") or msg.get("initialSubject") or "").strip()[:256]
                if _pdu or _pdt or _pds:
                    await _apply_deep_link_config_message(
                        {"unit": _pdu, "target": _pdt, "subject": _pds, "id": msg.get("id")}
                    )
                continue

            elif msg_type in ("deep_link_config", "deep_link_init"):
                await _apply_deep_link_config_message(msg)
                continue

            elif msg_type == "deep_link_clear":
                deep_link_state.clear()
                session_state["is_quick_review"] = False
                await send({"type": "deep_link_cleared", "v": 1.1})
                logger.info("[AgentWS] deep_link_clear — session restored to default scaffolding")
                continue

            elif msg_type == "training_request":
                _touch_interaction()
                req_tid = str(msg.get("id") or f"train_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}")
                topic = str(msg.get("topic") or "إدارة الأعمال BTEC").strip()
                difficulty = str(msg.get("difficulty") or "merit").strip()
                try:
                    from app.services.training_mode import generate_practice_question as _gen_pq

                    nq = await _gen_pq(topic, difficulty, session_id)
                    pending_question_id = None
                    btec_training_pending = {
                        "question": nq,
                        "topic": topic,
                        "difficulty": difficulty,
                    }
                    await process_text(
                        user_text=(
                            "[SYSTEM_EVENT: الطالب طلب وضع تدريب BTEC من قاعدة المعرفة. "
                            "اعرض سؤال التدريب بلهجة أردنية دافئة في جملة أو جملتين فقط.]"
                        ),
                        req_id=req_tid,
                        extra_context={
                            "btec_training_deliver_question": nq,
                            "cogni_training_mode": True,
                            "btec_training_examiner": True,
                        },
                    )
                except Exception as tr_ex:
                    logger.warning("[AgentWS] training_request failed: %s", tr_ex)
                    await send(
                        {
                            "type": "error",
                            "id": req_tid,
                            "error": {
                                "message": f"تعذر بدء التدريب: {tr_ex}",
                                "severity": "warn",
                                "code": "training_request",
                            },
                        }
                    )

            elif msg_type == "text":
                user_text = str(msg.get("text", msg.get("message", ""))).strip()
                if not user_text and not msg.get("practice"):
                    continue
                _touch_interaction()
                req_id = str(msg.get("id") or f"text_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}")
                _preview = (user_text[:160] + "…") if len(user_text) > 160 else user_text
                logger.info("[AgentWS] incoming text frame req_id=%s len=%d preview=%r", req_id, len(user_text), _preview)
                grade_result = msg.get("grade_result") or None
                emo_ctx = msg.get("emotional_context")
                emo_str = str(emo_ctx).strip() if emo_ctx is not None else None
                if (
                    msg.get("system_prompt")
                    or msg.get("systemPrompt")
                    or msg.get("persona_system_prompt")
                    or msg.get("personaSystemPrompt")
                ):
                    logger.debug(
                        "%s text frame — ignoring client system prompt fields (server persona)",
                        _ws_ctx(session_id, req_id),
                    )
                psp_s = None

                extra_ctx: dict = {}
                graded_this_turn = False

                # ── All Intelligence Layers Metadata (from frontend engines) ──
                _ts = msg.get("teaching_strategy")
                if _ts and isinstance(_ts, dict):
                    _sl  = str(_ts.get("student_level", "")).strip()
                    _ss  = str(_ts.get("student_state", "")).strip()
                    _bt  = str(_ts.get("btec_target", "")).strip()
                    _lm  = str(_ts.get("learning_moment", "")).strip()
                    _tc  = _ts.get("turn_count", 0)
                    # Intuition layer
                    _sp  = str(_ts.get("student_pattern", "")).strip()
                    _hw  = str(_ts.get("hidden_weakness", "")).strip()
                    _cc  = _ts.get("comprehension_confidence", 0.5)
                    _sigs = _ts.get("stress_signals", [])
                    # Temporal layer
                    _phase  = str(_ts.get("session_phase", "")).strip()
                    _energy = _ts.get("energy_level", 0.7)
                    _exam_d = _ts.get("days_to_exam")
                    # Persuasion layer
                    _pm  = str(_ts.get("persuasion_mode", "")).strip()

                    if _sl or _ss or _lm:
                        extra_ctx["cogni_student_level"]   = _sl or "developing"
                        extra_ctx["cogni_student_state"]   = _ss or "neutral"
                        extra_ctx["cogni_btec_target"]     = _bt or "unknown"
                        extra_ctx["cogni_learning_moment"] = _lm or "question_asked"
                        extra_ctx["cogni_session_turn"]    = int(_tc) if str(_tc).isdigit() else 0
                        # Intuition
                        if _sp:   extra_ctx["cogni_student_pattern"] = _sp
                        if _hw:   extra_ctx["cogni_hidden_weakness"]  = _hw[:500]
                        if _cc:   extra_ctx["cogni_comprehension"]    = float(_cc) if isinstance(_cc, (int, float)) else 0.5
                        if _sigs and isinstance(_sigs, list):
                            extra_ctx["cogni_stress_signals"] = ",".join(str(s) for s in _sigs[:6])
                        # Temporal
                        if _phase:  extra_ctx["cogni_session_phase"] = _phase
                        if _energy: extra_ctx["cogni_energy_level"]  = float(_energy) if isinstance(_energy, (int, float)) else 0.7
                        if _exam_d is not None:
                            extra_ctx["cogni_days_to_exam"] = int(_exam_d) if isinstance(_exam_d, (int, float)) else None
                        # Persuasion
                        if _pm: extra_ctx["cogni_persuasion_mode"] = _pm
                        logger.debug(
                            "[AgentWS] Intelligence layers: level=%s state=%s moment=%s pattern=%s weakness=%s phase=%s energy=%.2f persuasion=%s",
                            _sl, _ss, _lm, _sp, _hw[:40] if _hw else "none",
                            _phase, float(_energy) if isinstance(_energy, (int, float)) else 0, _pm,
                        )

                def _practice_intent(t: str) -> bool:
                    return bool(re.search(r"تدريب|تمرين|practice", t or "", re.I))

                def _btec_kb_training_topic(t: str) -> Optional[str]:
                    """Chroma-backed BTEC training (does not steal bare «تدريب» from Phase B DB practice)."""
                    s = (t or "").strip()
                    if re.match(r"^تدريب\s*منهج\s*$", s, re.I):
                        return "إدارة الأعمال BTEC"
                    m = re.match(r"^تدريب\s*منهج\s*[:：]\s*(.+)$", s, re.S | re.I)
                    if m:
                        return m.group(1).strip()[:500]
                    if re.match(r"^تدريب\s+btec\s*$", s, re.I):
                        return "إدارة الأعمال BTEC"
                    m2 = re.match(r"^تدريب\s+btec\s*[:：]\s*(.+)$", s, re.S | re.I)
                    if m2:
                        return m2.group(1).strip()[:500]
                    return None

                _kbt = _btec_kb_training_topic(user_text)
                if (
                    _kbt
                    and not msg.get("practice")
                    and btec_training_pending is None
                    and not pending_question_id
                ):
                    try:
                        from app.services.training_mode import generate_practice_question as _gen_pq_kb

                        nq_kb = await _gen_pq_kb(
                            _kbt,
                            str(msg.get("difficulty") or "merit"),
                            session_id,
                        )
                        pending_question_id = None
                        btec_training_pending = {
                            "question": nq_kb,
                            "topic": _kbt,
                            "difficulty": str(msg.get("difficulty") or "merit"),
                        }
                        await process_text(
                            user_text=(
                                "[SYSTEM_EVENT: الطالب طلب تدريب BTEC من قاعدة المعرفة. "
                                "اعرض سؤال التدريب بلهجة أردنية دافئة في جملة أو جملتين فقط.]"
                            ),
                            req_id=req_id,
                            extra_context={
                                "btec_training_deliver_question": nq_kb,
                                "cogni_training_mode": True,
                                "btec_training_examiner": True,
                            },
                        )
                    except Exception as _kb_ex:
                        logger.warning("[AgentWS] BTEC KB training (text keyword) failed: %s", _kb_ex)
                    continue

                # Phase B — grade answer to pending practice question
                if user_uuid and pending_question_id and user_text.strip():
                    try:
                        from datetime import datetime as _dt

                        from app.database import SessionLocal as _SL
                        from app.models.db_models import Answer as _Ans, Question as _Qq
                        from app.archive.answer_grading import grade_curriculum_answer as _gca
                        from app.services.curriculum_service import update_mastery_after_answer as _uma

                        _db = _SL()
                        try:
                            _q = _db.query(_Qq).filter(_Qq.id == pending_question_id).first()
                            if _q:
                                _res = await _gca(_q, user_text)
                                _lesson = _q.lesson
                                _tid = _lesson.topic_id if _lesson else None
                                _db.add(
                                    _Ans(
                                        user_id=user_uuid,
                                        question_id=_q.id,
                                        text=user_text,
                                        score=float(_res.get("score") or 0),
                                        feedback=str(_res.get("feedback") or "")[:4000],
                                        graded_at=_dt.utcnow(),
                                    )
                                )
                                _db.commit()
                                if _tid is not None:
                                    _uma(_db, user_uuid, _tid, float(_res.get("score") or 0) >= 0.85)
                                extra_ctx["graded_feedback"] = (
                                    f"درجة هذه المحاولة: {float(_res.get('score') or 0):.0%}. "
                                    f"{_res.get('feedback') or ''}"
                                )
                                await send(
                                    {
                                        "type": "answer_graded",
                                        "v": 1.1,
                                        "id": req_id,
                                        "question_id": _q.id,
                                        "score": float(_res.get("score") or 0),
                                        "feedback": _res.get("feedback"),
                                    }
                                )
                                graded_this_turn = True
                        finally:
                            _db.close()
                    except Exception as _gx:
                        logger.warning("[AgentWS] answer grading failed: %s", _gx)
                    pending_question_id = None

                # Phase B — start adaptive practice (new question)
                if (
                    user_uuid
                    and not graded_this_turn
                    and (msg.get("practice") or _practice_intent(user_text))
                ):
                    try:
                        from app.database import SessionLocal as _SL2
                        from app.services.curriculum_service import (
                            first_topic_id as _ftid,
                            select_question_for_user as _sq,
                        )

                        _db2 = _SL2()
                        try:
                            tid = msg.get("topic_id")
                            try:
                                tid_i = int(tid) if tid is not None else None
                            except (TypeError, ValueError):
                                tid_i = None
                            if tid_i is None:
                                tid_i = _ftid(_db2)
                            if tid_i:
                                _pq = _sq(_db2, user_uuid, tid_i)
                                if _pq:
                                    pending_question_id = _pq.id
                                    opts = ""
                                    if (_pq.type or "").lower() == "mcq" and _pq.options:
                                        opts = "\nالخيارات: " + " | ".join(
                                            str(x) for x in (_pq.options or [])
                                        )
                                    extra_ctx["practice_question_block"] = (
                                        f"نوع السؤال: {_pq.type}\n{_pq.text}{opts}"
                                    )
                                    if msg.get("practice") or not user_text.strip():
                                        user_text = "ابدأ وضع التدريب واطرح السؤال التالي بلهجة أردنية."
                        finally:
                            _db2.close()
                    except Exception as _px:
                        logger.warning("[AgentWS] practice start failed: %s", _px)

                _aid_msg = msg.get("assignment_id") or msg.get("assignmentId")
                if _aid_msg and str(_aid_msg).strip():
                    extra_ctx["assignment_id"] = str(_aid_msg).strip()[:160]

                _fs_msg = str(msg.get("focus_subject") or "").strip()[:200]
                if _fs_msg:
                    focus_subject = _fs_msg
                    extra_ctx["focus_subject"] = _fs_msg
                _ac_msg = msg.get("assessment_coaching")
                if isinstance(_ac_msg, dict) and (_ac_msg.get("subject") or _ac_msg.get("final_grade")):
                    extra_ctx["assessment_coaching"] = _ac_msg

                _ws_ci = msg.get("intent") or msg.get("user_intent") or msg.get("dialogue_intent")
                _ws_ci_s = str(_ws_ci).strip()[:96] if _ws_ci else None
                await start_user_turn(
                    user_text=user_text or "…",
                    grade_result=grade_result,
                    req_id=req_id,
                    emotional_context=emo_str or None,
                    persona_system_prompt=psp_s or None,
                    extra_context=extra_ctx if extra_ctx else None,
                    ws_client_intent=_ws_ci_s or None,
                )

            elif msg_type == "btec_progress":
                # Frontend sends this frame when the student's BTEC progress changes
                # (e.g. after receiving a grading result, or on session start).
                # Payload: {type: "btec_progress", unit_id, unit_title?, achieved: [...], current_level?, next_criterion?, summary?}
                # We resolve the teaching level server-side if not provided by client.
                unit_id = str(msg.get("unit_id", "")).strip().lower()
                if not unit_id:
                    await send({"type": "error", "error": {"message": "btec_progress: unit_id required", "severity": "warn"}})
                    continue

                achieved = [str(c).strip().upper() for c in msg.get("achieved", []) if c]

                # If the client has already resolved level + next_criterion, use them.
                # Otherwise, resolve from the knowledge base.
                current_level   = msg.get("current_level")
                next_criterion  = msg.get("next_criterion")
                summary         = msg.get("summary", {})

                if not current_level or next_criterion is None:
                    try:
                        from app.services.btec_knowledge import (
                            load_unit, infer_teaching_level, get_next_criterion as _get_next,
                            get_achieved_summary,
                        )
                        unit = load_unit(unit_id)
                        if unit:
                            current_level  = infer_teaching_level(achieved, unit)
                            next_criterion = _get_next(achieved, unit)
                            summary        = get_achieved_summary(achieved, unit)
                        else:
                            current_level  = current_level or "pass"
                            next_criterion = next_criterion
                    except Exception as exc:
                        logger.warning("[AgentWS] btec_progress knowledge lookup failed: %s", exc)
                        current_level = current_level or "pass"

                btec_state.clear()
                btec_state.update({
                    "unit_id":        unit_id,
                    "unit_title":     str(msg.get("unit_title", unit_id)),
                    "achieved":       achieved,
                    "current_level":  current_level or "pass",
                    "next_criterion": next_criterion,
                    "summary":        summary,
                })
                logger.info(
                    "[AgentWS] BTEC progress updated — unit=%s level=%s achieved=%s next=%s",
                    unit_id, current_level, achieved,
                    next_criterion.get("code") if next_criterion else "—",
                )
                await send({
                    "type":           "btec_progress_ack",
                    "unit_id":        unit_id,
                    "current_level":  current_level,
                    "next_criterion": next_criterion,
                    "achieved":       achieved,
                    "summary":        summary,
                })
                asyncio.ensure_future(_analytics.update_btec_state(
                    unit_id=unit_id,
                    btec_level=current_level or "pass",
                    next_criterion=(
                        next_criterion.get("code")
                        if isinstance(next_criterion, dict)
                        else (next_criterion or "")
                    ),
                ))
                asyncio.ensure_future(_analytics.update_btec_state(
                    unit_id=unit_id,
                    btec_level=current_level or "pass",
                    next_criterion=(
                        next_criterion.get("code")
                        if isinstance(next_criterion, dict)
                        else (next_criterion or "")
                    ),
                ))

            elif msg_type == "set_persona":
                # Frontend (or teacher panel) sends {"type":"set_persona","level":"pass"|"merit"|"distinction"}
                # to switch Cogni's tone engine in real-time.
                lvl = str(msg.get("level", "pass")).lower()
                if lvl in ("pass", "merit", "distinction"):
                    _old_level    = persona_level
                    persona_level = lvl
                    await send({"type": "persona_set", "level": persona_level})
                    logger.info("[AgentWS] Triple-Persona level set to: %s", persona_level)
                    asyncio.ensure_future(_analytics.log_persona_switch(_old_level, persona_level))
                else:
                    await send({"type": "error", "error": {
                        "message": f"set_persona: invalid level '{lvl}' — must be pass|merit|distinction",
                        "severity": "warn",
                    }})

            elif msg_type == "camera_frame":
                if not getattr(settings, "ENABLE_CAMERA_FEED", True):
                    continue
                user_state["perception"] = {
                    "emotion": msg.get("emotion"),
                    "attention": msg.get("attention"),
                    "engagement": msg.get("engagement"),
                    "ts": msg.get("ts"),
                }
                await send({"type": "camera_frame_ack", "v": 1.1})

            elif msg_type == "device_context":
                if not getattr(settings, "ENABLE_DEVICE_CONTEXT", True):
                    continue
                dev: dict = {}
                for key in (
                    "device_type",
                    "deviceType",
                    "timezone",
                    "timeZone",
                    "country",
                    "countryCode",
                    "time_of_day",
                    "timeOfDay",
                    "locale",
                ):
                    if msg.get(key) is not None:
                        dev[key] = msg.get(key)
                if dev.get("deviceType") and not dev.get("device_type"):
                    dev["device_type"] = dev.pop("deviceType")
                if dev.get("timeZone") and not dev.get("timezone"):
                    dev["timezone"] = dev.pop("timeZone")
                if dev.get("countryCode") and not dev.get("country"):
                    dev["country"] = dev.pop("countryCode")
                if dev.get("timeOfDay") and not dev.get("time_of_day"):
                    dev["time_of_day"] = dev.pop("timeOfDay")
                user_state["device"] = dev
                if user_uuid:
                    try:
                        from app.database import SessionLocal as _SL_CTX
                        from app.models.db_models import UserContextRow as _UC

                        _dbc = _SL_CTX()
                        try:
                            row = _dbc.query(_UC).filter(_UC.user_id == user_uuid).first()
                            if not row:
                                row = _UC(user_id=user_uuid)
                                _dbc.add(row)
                            row.device_type = str(dev.get("device_type") or "")[:32] or row.device_type
                            row.timezone = str(dev.get("timezone") or "")[:128] or row.timezone
                            if dev.get("country"):
                                row.country_code = str(dev.get("country"))[:8]
                            if dev.get("locale"):
                                row.locale_hint = str(dev.get("locale"))[:64]
                            from datetime import datetime as _dt

                            row.updated_at = _dt.utcnow()
                            _dbc.commit()
                        finally:
                            _dbc.close()
                    except Exception as _ctxe:
                        logger.debug("[AgentWS] user_context upsert: %s", _ctxe)
                await send({"type": "device_context_ack", "v": 1.1})

            elif msg_type in ("new_grade", "grade_nudge"):
                _touch_interaction()
                _g = str(msg.get("grade") or msg.get("final_grade") or "").strip()
                pending_grade_nudge = {
                    "grade": _g,
                    "unit": str(msg.get("unit") or msg.get("assignment_title") or "").strip()[:512],
                    "subject": str(msg.get("subject") or "").strip()[:256],
                    "source": "ws",
                }
                logger.info("[AgentWS] %s — grade=%s subject=%s", msg_type, _g, pending_grade_nudge.get("subject"))
                if msg_type == "new_grade":
                    _connect_greeted = True
                    req_gid = str(msg.get("id") or f"new_grade_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}")
                    await start_user_turn(
                        user_text=(
                            "[SYSTEM_EVENT: الطالب أنهى تقييماً للتو أو استلم درجة جديدة. ردّ بلهجة أردنية دافئة، "
                            "أكّد أنك معه في التحسين، واسأل سؤالاً منهاجياً واحداً نحو خطوة أوضح ضمن Pass→Merit→Distinction.]"
                        ),
                        req_id=req_gid,
                    )

            elif msg_type == "set_focus_subject":
                fs = str(msg.get("subject") or msg.get("focus_subject") or "").strip()[:200]
                focus_subject = fs or None
                if msg.get("student_override"):
                    deep_link_state.clear()
                    session_state["is_quick_review"] = False
                    logger.info("[AgentWS] set_focus_subject — student_override cleared deep_link_state")
                pending_snapshot: Optional[dict] = None
                if user_uuid and fs:
                    try:
                        from app.database import SessionLocal
                        from app.services.assessment_grade_context import fetch_latest_evaluation_nudge_payload

                        db = SessionLocal()
                        try:
                            pending_snapshot = fetch_latest_evaluation_nudge_payload(db, user_uuid, fs)
                        finally:
                            db.close()
                    except Exception as _fse:
                        logger.debug("[AgentWS] set_focus_subject DB: %s", _fse)
                if pending_snapshot:
                    pending_grade_nudge = pending_snapshot
                    _connect_greeted = True
                    req_f = str(msg.get("id") or f"focus_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}")
                    await start_user_turn(
                        user_text=(
                            "[SYSTEM_EVENT: الطالب اختار مادة أو موضوعاً للتركيز. إن وُجد تقييم حديث في السياق، "
                            "ادمجه بلطف ووجّه نحو التحسين ضمن Pass→Merit→Distinction.]"
                        ),
                        req_id=req_f,
                    )
                await send({"type": "focus_subject_ack", "v": 1.1, "subject": fs})

            elif msg_type == "tool_interaction":
                user_state["last_tool"] = msg.get("payload") if isinstance(msg.get("payload"), dict) else {"raw": msg.get("payload")}
                await send({"type": "tool_interaction_ack", "v": 1.1})

            elif msg_type == "session_feedback":
                if not user_uuid:
                    continue
                try:
                    from app.database import SessionLocal as _SL_FB
                    from app.models.db_models import TrainingData as _TD
                    from app.services.digital_human_context import update_persona_from_feedback

                    up = float(msg.get("score") or (1.0 if msg.get("thumbs_up") else 0.0))
                    prompt = str(msg.get("prompt") or "")[:8000]
                    response = str(msg.get("response") or "")[:8000]
                    if getattr(settings, "ENABLE_TRAINING_DATA", True):
                        _dbf = _SL_FB()
                        try:
                            _dbf.add(
                                _TD(
                                    id=uuid.uuid4(),
                                    user_id=user_uuid,
                                    prompt=prompt,
                                    response=response,
                                    score=max(0.0, min(1.0, up)),
                                    meta={"source": "session_feedback"},
                                )
                            )
                            _dbf.commit()
                        finally:
                            _dbf.close()
                    _dbf2 = _SL_FB()
                    try:
                        update_persona_from_feedback(_dbf2, user_uuid, up >= 0.5)
                    finally:
                        _dbf2.close()
                    try:
                        think_mm.apply_thumb_feedback(bool(msg.get("thumbs_up") or up >= 0.5))
                    except Exception as _thumb_exc:
                        logger.warning(
                            "%s apply_thumb_feedback failed: %s",
                            _ws_ctx(session_id),
                            _thumb_exc,
                            exc_info=True,
                        )
                    await send({"type": "session_feedback_ack", "v": 1.1})
                except Exception as _fbe:
                    logger.warning("[AgentWS] session_feedback: %s", _fbe)

            else:
                logger.debug("[AgentWS] Unknown message type: %s", msg_type)

    except WebSocketDisconnect:
        _ws_connection_dead = True
        logger.info(
            "[AgentWS] disconnected | req_id=%s user_id=%s client=%s",
            ws_req_id,
            str(user_uuid) if user_uuid else "guest",
            websocket.client,
        )
    except Exception as e:
        logger.exception("[AgentWS] Unexpected error: %s", e)
        try:
            await send({"type": "error", "error": {"message": str(e), "severity": "error"}})
            await websocket.close()
        except Exception as _close_after_err:
            logger.debug(
                "ws_req_id=%s send/close after loop error failed: %s",
                ws_req_id,
                _close_after_err,
            )
    finally:
        _ws_connection_dead = True
        _persist_scope = user_uuid or linked_eval_uuid
        if _persist_scope:
            try:
                from app.services.session_state_redis import load_session_state, save_session_state

                _existing = load_session_state(_persist_scope) or {}
                _ack_ids = [str(x) for x in (_existing.get("eval_nudge_ack_ids") or [])]
                for _iid in _eval_nudge_instance_acks_ws:
                    if _iid not in _ack_ids:
                        _ack_ids.append(_iid)
                _ack_ids = _ack_ids[-50:]
                save_session_state(
                    _persist_scope,
                    {
                        **_existing,
                        "session_id": session_id,
                        "turns": len(history),
                        "persona_level": persona_level,
                        "eval_nudge_ack_ids": _ack_ids,
                    },
                )
            except Exception as _fin_redis:
                logger.debug("[AgentWS] finally session_state save: %s", _fin_redis)
        if user_uuid:
            try:
                from app.services.reflection_service import append_session_timeline

                _db_tl = None
                try:
                    from app.database import SessionLocal as _SL_FIN

                    _db_tl = _SL_FIN()
                    append_session_timeline(
                        _db_tl,
                        user_uuid,
                        f"جلسة — {len(history)} تبادل",
                        None,
                    )
                except Exception as _tl_e:
                    logger.debug("[AgentWS] timeline append: %s", _tl_e)
                finally:
                    if _db_tl is not None:
                        _db_tl.close()
            except Exception as _fin_e:
                logger.debug("[AgentWS] finally v28: %s", _fin_e)
        try:
            think_mm.save_to_db(thinker)
        except Exception as _save_e:
            logger.warning("[AgentWS] save_to_db failed | req_id=%s err=%s", ws_req_id, _save_e)
        if thinker is not None:
            try:
                await thinker.stop()
            except Exception as _thinker_stop_exc:
                logger.warning(
                    "ws_req_id=%s thinker.stop failed: %s",
                    ws_req_id,
                    _thinker_stop_exc,
                    exc_info=True,
                )
        if heartbeat_task is not None and not heartbeat_task.done():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            except Exception as _hb_join:
                logger.debug("[AgentWS] heartbeat task join: %s", _hb_join)
            logger.debug("[AgentWS] heartbeat task cancelled")
        try:
            await _analytics.session_end()
        except Exception as _analytics_end_exc:
            logger.debug("ws_req_id=%s session_end analytics failed: %s", ws_req_id, _analytics_end_exc)