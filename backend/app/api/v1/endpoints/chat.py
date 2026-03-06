# -*- coding: utf-8 -*-
"""
Chat endpoint: POST /api/v1/chat
Uses Dr. Hamza persona — A-Agent V200 (BTEC Adaptive Teacher).
Accepts { "message", "history" } and returns { "reply", "dialogue", "action", "emotion", "intent" }.
"""
from __future__ import annotations
import re
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.v1.endpoints.tutor import _get_dr_hamza_response

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class HistoryEntry(BaseModel):
    user: str = ""
    assistant: str = ""


class SimpleChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: Optional[List[HistoryEntry]] = Field(default_factory=list)


class SimpleChatResponse(BaseModel):
    reply   : str   # full 3-line reply
    dialogue: str   # spoken text (line 1)
    action  : str   # gesture text without asterisks (line 2)
    emotion : str   # blendshape tag (line 3)
    intent  : str   # locally classified intent


# ── Allowed emotion tags ──────────────────────────────────────────────────────

ALLOWED_EMOTIONS = {'neutral', 'friendly', 'thinking', 'encouraging', 'strict', 'celebrate'}


# ── Intent classifier (local, zero-cost) ─────────────────────────────────────

_INTENT_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\b(btec|p[123]|m[123]|d[123]|distinction|merit|pass|lo\d|criteria|criterion|unit\s*\d)\b', re.I), 'btec_question'),
    (re.compile(r'\b(\u0645\u0639\u064a\u0627\u0631|\u0645\u0639\u0627\u064a\u064a\u0631|\u062a\u0645\u064a\u064a\u0632|\u062c\u062f\u0627\u0631\u0629|\u0646\u062c\u0627\u062d|\u0648\u062d\u062f\u0629|\u0628\u064a\u062a\u064a\u0633\u064a|\u062a\u0643\u0644\u064a\u0641)\b', re.I), 'btec_question'),
    (re.compile(r'\b(\u0644\u0645\u0627\u0630\u0627|\u0643\u064a\u0641|\u0645\u0627 \u0647\u0648|\u0645\u0627 \u0647\u064a|\u0627\u0634\u0631\u062d|what|why|how|when|who|explain|define)\b', re.I), 'general_question'),
    (re.compile(r'\b(\u0627\u0631\u064a\u062f|\u0623\u0631\u064a\u062f|\u0645\u0645\u0643\u0646|please|\u0628\u062f\u064a|\u0633\u0627\u0639\u062f\u0646\u064a|\u0623\u062d\u062a\u0627\u062c|help me|can you|give me)\b', re.I), 'request'),
    (re.compile(r'\b(\u0645\u0634 \u0641\u0627\u0647\u0645|\u0645\u0627 \u0641\u0647\u0645\u062a|confused|lost|\u0644\u0627 \u0623\u0641\u0647\u0645|\u0634\u0648 \u064a\u0639\u0646\u064a|i don.t get)\b', re.I), 'confusion'),
    (re.compile(r'\b(\u0634\u0643\u0631|\u064a\u0633\u0644\u0645\u0648\u0627|\u064a\u0633\u0644\u0645|thanks|thank you|\u0645\u0645\u062a\u0627\u0632|\u0628\u0631\u0627\u0641\u0648|\u0631\u0627\u0626\u0639|awesome)\b', re.I), 'gratitude'),
    (re.compile(r'\b(\u0645\u0631\u062d\u0628\u0627|\u0623\u0647\u0644\u0627|hi|hello|hey|\u0643\u064a\u0641\u0643|\u0634\u0648 \u0627\u062e\u0628\u0627\u0631\u0643)\b', re.I), 'greeting'),
    (re.compile(r'\b(\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629|\u0628\u0627\u064a|bye|goodbye|\u064a\u0644\u0627 \u0648\u062f\u0627\u0639)\b', re.I), 'farewell'),
]

def _classify_intent(text: str) -> str:
    for pattern, intent in _INTENT_RULES:
        if pattern.search(text):
            return intent
    return 'idle'


# ── Emotion fallback keywords ─────────────────────────────────────────────────

_EMOTION_KEYWORDS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\u0645\u0628\u0631\u0648\u0643|\u0645\u0645\u062a\u0627\u0632|\u0631\u0627\u0626\u0639|\u0623\u062d\u0633\u0646\u062a|\u0628\u0631\u0627\u0641\u0648|\U0001f389', re.I), 'celebrate'),
    (re.compile(r'\u064a\u0644\u0627|\u0647\u0645\u0629|\u062a\u0642\u062f\u0631|\u062b\u0642\u062a\u064a \u0641\u064a\u0643|\u062c\u0631\u0628|\u0646\u0628\u0644\u0634',   re.I), 'encouraging'),
    (re.compile(r'\u0641\u0643\u0631|\u0627\u0634\u0631\u062d|\u064a\u0639\u0646\u064a|\u062e\u0644\u064a\u0646\u064a|\u062f\u0642\u064a\u0642\u0629|\u0628\u0641\u0647\u0645',    re.I), 'thinking'),
    (re.compile(r'\u062a\u0646\u0628\u0647|\u0644\u0627\u0632\u0645|\u0645\u0647\u0645|\u0631\u0643\u0632|\u0636\u0631\u0648\u0631\u064a',           re.I), 'strict'),
    (re.compile(r'\u0623\u0647\u0644\u064a\u0646|\u0643\u064a\u0641\u0643|\u0634\u0648 \u0627\u062e\u0628\u0627\u0631\u0643|\u062d\u064a\u0627\u0643|\u0623\u0647\u0644\u0627\u064b',   re.I), 'friendly'),
]

_ACTION_DEFAULTS: dict[str, str] = {
    'celebrate':   '\u064a\u0644\u0648\u062d \u0628\u064a\u062f\u064a\u0647 \u0628\u062d\u0645\u0627\u0633 \u0648\u064a\u0628\u062a\u0633\u0645 \u0627\u0628\u062a\u0633\u0627\u0645\u0629 \u0639\u0631\u064a\u0636\u0629',
    'encouraging': '\u064a\u0641\u062a\u062d \u0643\u0641\u064a\u0647 \u0628\u0644\u0637\u0641 \u0648\u064a\u062d\u0631\u0651\u0643 \u0630\u0631\u0627\u0639\u064a\u0647 \u0644\u0644\u0623\u0645\u0627\u0645',
    'thinking':    '\u064a\u0645\u064a\u0644 \u0631\u0623\u0633\u0647 \u0642\u0644\u064a\u0644\u0627\u064b \u0648\u0639\u064a\u0646\u0627\u0647 \u062a\u062a\u0623\u0645\u0644\u0627\u0646',
    'strict':      '\u064a\u0634\u064a\u0631 \u0628\u0625\u0635\u0628\u0639\u0647 \u0628\u062b\u0642\u0629 \u0648\u064a\u0646\u0638\u0631 \u0644\u0644\u0623\u0645\u0627\u0645 \u0645\u0628\u0627\u0634\u0631\u0629',
    'friendly':    '\u064a\u0628\u062a\u0633\u0645 \u0628\u0644\u0637\u0641 \u0648\u064a\u0645\u064a\u0644 \u0631\u0623\u0633\u0647 \u0642\u0644\u064a\u0644\u0627\u064b',
    'neutral':     '\u064a\u0648\u0645\u0626 \u0628\u0631\u0623\u0633\u0647 \u0628\u0631\u0641\u0642',
}


# ── Format helpers ────────────────────────────────────────────────────────────

def _verify_format(text: str) -> bool:
    return (
        bool(re.search(r'\*[^*]+\*', text)) and
        bool(re.search(r'\[EMOTION:\s*\w+\]', text))
    )


def _infer_emotion(text: str) -> str:
    for pattern, emotion in _EMOTION_KEYWORDS:
        if pattern.search(text):
            return emotion
    return 'friendly'


def _patch_format(text: str) -> str:
    """Ensures the reply has *action* and [EMOTION: tag].

    When no *action* is found the model likely emitted a bare action line
    (no asterisks).  Per the 3-part contract that line is always the last
    non-empty line before [EMOTION:].  We extract it, wrap it in *...*,
    and exclude it from the dialogue instead of appending a generic default
    alongside it (which caused the bare text to leak into the chat UI).
    """
    has_action    = bool(re.search(r'\*[^*]+\*', text))
    emotion_match = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    emotion       = emotion_match.group(1).lower() if emotion_match else _infer_emotion(text)
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    cleaned = re.sub(r'\s*\[EMOTION:\s*\w+\]', '', text).rstrip()
    if not has_action:
        # The last non-empty line is the bare action line — extract & wrap it.
        lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
        if len(lines) >= 2:
            bare_action = lines.pop()   # remove from dialogue content
            cleaned = '\n'.join(lines)
        else:
            bare_action = _ACTION_DEFAULTS.get(emotion, _ACTION_DEFAULTS['neutral'])
        cleaned += f'\n*{bare_action}*'
    return cleaned + f'\n[EMOTION: {emotion}]'


def _parse_reply(text: str) -> dict:
    """Splits 3-line reply into dialogue, action, and emotion."""
    action_m  = re.search(r'\*([^*]+)\*', text)
    emotion_m = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    action    = action_m.group(1).strip()  if action_m  else _ACTION_DEFAULTS['neutral']
    emotion   = emotion_m.group(1).lower() if emotion_m else 'friendly'
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    dialogue  = re.sub(r'\*[^*]+\*', '', text)
    dialogue  = re.sub(r'\[EMOTION:\s*\w+\]', '', dialogue).strip()
    return {'dialogue': dialogue, 'action': action, 'emotion': emotion}


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=SimpleChatResponse)
async def chat_simple(body: SimpleChatRequest):
    """
    Dr. Hamza V200 -- returns structured { reply, dialogue, action, emotion, intent }
    so the avatar system can independently drive gestures and blendshapes.
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message cannot be empty")

    intent       = _classify_intent(body.message)
    history_list = [{"user": h.user, "assistant": h.assistant} for h in (body.history or [])]
    context      = {"history": history_list[-6:]}   # last 3 exchanges

    try:
        reply_text = await _get_dr_hamza_response(body.message, context)

        # Self-Check Gate -- Pass 1: ask model to self-correct
        if not _verify_format(reply_text):
            logger.warning("[V200] Pass-1 format fail -- retrying")
            suffix = (
                "\n\n[SYSTEM] "
                "\u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0631\u062f\u0643 \u0628\u0627\u0644\u062a\u0646\u0633\u064a\u0642 \u0627\u0644\u062b\u0644\u0627\u062b\u064a: "
                "\u0633\u0637\u0631 \u0627\u0644\u062d\u0648\u0627\u0631\\n*\u0633\u0637\u0631 \u0627\u0644\u062d\u0631\u0643\u0629*\\n[EMOTION: tag]"
            )
            reply_text = await _get_dr_hamza_response(body.message + suffix, context)

        # Self-Check Gate -- Pass 2: deterministic patch fallback
        if not _verify_format(reply_text):
            logger.warning("[V200] Pass-2 format fail -- applying patch")
            reply_text = _patch_format(reply_text)

        parsed = _parse_reply(reply_text)
        return SimpleChatResponse(
            reply    = reply_text,
            dialogue = parsed['dialogue'],
            action   = parsed['action'],
            emotion  = parsed['emotion'],
            intent   = intent,
        )

    except Exception as e:
        logger.exception("[V200] chat error: %s", e)
        raise HTTPException(status_code=500, detail="\u0641\u0634\u0644 \u0641\u064a \u062a\u0648\u0644\u064a\u062f \u0627\u0644\u0631\u062f. \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b.")
