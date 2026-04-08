# -*- coding: utf-8 -*-
"""
Deterministic behavior layer: map avatar emotion + intent to WS `gestures[]`
when the LLM did not supply structured gestures.

Intent resolution (first match wins):
1. `intent` / `user_intent` / `dialogue_intent` inside LLM JSON → `parsed["llm_intent"]`
2. Optional `intent` field on WebSocket `text` frames (client / router)
3. Rule-based classifier (`chat._classify_intent` labels) mapped to behavior buckets
4. Keyword fallback on user text (`_infer_intent_hint`)
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# start_ms / duration_ms — consumed by frontend normalizeGesturesArrayFromWs
_DEFAULT_START_MS = 420
_DEFAULT_DURATION_MS = 1600

# Chat endpoint classifier labels → coarse behavior intent
_CHAT_INTENT_TO_BEHAVIOR: Dict[str, str] = {
    "btec_question": "question",
    "general_question": "question",
    "distinction_request": "question",
    "request": "neutral",
    "confusion": "confusion",
    "gratitude": "gratitude",
    "greeting": "neutral",
    "farewell": "neutral",
    "idle": "neutral",
}


def normalize_llm_intent_token(raw: Optional[str]) -> Optional[str]:
    """Map free-form LLM / client intent string to behavior bucket."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().lower()[:96]
    if any(x in s for x in ("question", "سؤال", "ask", "how", "why", "what")):
        return "question"
    if any(x in s for x in ("thank", "gratitude", "شكر", "مشكور")):
        return "gratitude"
    if any(x in s for x in ("confus", "lost", "help", "فهمت", "مساعدة")):
        return "confusion"
    if any(x in s for x in ("greet", "hello", "مرحب", "أهلا")):
        return "neutral"
    return "neutral"


def _infer_intent_hint(user_text: str) -> str:
    t = (user_text or "").strip()
    if not t:
        return "neutral"
    if "?" in t or "؟" in t:
        return "question"
    if re.search(r"\b(لماذا|ليه|كيف|شو|ما\s|ماذا|اشرح|وضح)\b", t, re.I):
        return "question"
    if re.search(r"\b(شكرا|مشكور|يعطيك|برافو|ممتاز|رائع)\b", t, re.I):
        return "gratitude"
    if re.search(r"\b(ما\s*فهمت|مش\s*فاهم|صعب|صعبة|مساعدة|ساعد)\b", t, re.I):
        return "confusion"
    return "neutral"


def resolve_behavior_intent(
    parsed: Dict[str, Any],
    user_text: str,
    *,
    ws_client_intent: Optional[str] = None,
    rule_based_intent: Optional[str] = None,
) -> str:
    li = parsed.get("llm_intent")
    if isinstance(li, str) and li.strip():
        n = normalize_llm_intent_token(li)
        if n:
            return n

    if ws_client_intent and str(ws_client_intent).strip():
        n = normalize_llm_intent_token(ws_client_intent)
        if n:
            return n

    if rule_based_intent and str(rule_based_intent).strip():
        rb = str(rule_based_intent).strip().lower()
        mapped = _CHAT_INTENT_TO_BEHAVIOR.get(rb)
        if mapped:
            return mapped

    return _infer_intent_hint(user_text)


def _gesture_entry(
    typ: str,
    *,
    start_ms: int = _DEFAULT_START_MS,
    duration_ms: int = _DEFAULT_DURATION_MS,
    intensity: float = 0.72,
    cospeech_offset_ms: int = 0,
) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "type": typ,
        "start_ms": int(start_ms),
        "duration_ms": int(duration_ms),
        "intensity": float(max(0.0, min(1.0, intensity))),
    }
    if cospeech_offset_ms > 0:
        d["cospeech_offset_ms"] = int(cospeech_offset_ms)
    return d


def map_emotion_intent_to_gestures(emotion: str, intent: str) -> List[Dict[str, Any]]:
    em = (emotion or "neutral").lower().strip()
    it = (intent or "neutral").lower().strip()

    if it == "question":
        return [_gesture_entry("point", start_ms=400, intensity=0.78, cospeech_offset_ms=140)]
    if it == "gratitude":
        return [_gesture_entry("wave", start_ms=380, intensity=0.85, cospeech_offset_ms=80)]
    if it == "confusion":
        return [_gesture_entry("think", start_ms=480, duration_ms=2000, intensity=0.7, cospeech_offset_ms=220)]

    if em in ("celebrate", "proud"):
        return [_gesture_entry("clap", start_ms=400, intensity=0.9, cospeech_offset_ms=100)]
    if em in ("encouraging", "friendly"):
        return [_gesture_entry("openHand", start_ms=410, intensity=0.75, cospeech_offset_ms=90)]
    if em == "strict":
        return [_gesture_entry("point", start_ms=430, intensity=0.8, cospeech_offset_ms=150)]
    if em == "thinking":
        return [_gesture_entry("think", start_ms=460, duration_ms=1900, intensity=0.68, cospeech_offset_ms=200)]
    if em in ("sad", "concerned"):
        return [_gesture_entry("nod", start_ms=400, duration_ms=1400, intensity=0.55, cospeech_offset_ms=60)]

    return [_gesture_entry("nod", start_ms=400, duration_ms=1200, intensity=0.65, cospeech_offset_ms=70)]


def augment_ws_reply_gestures(
    parsed: Dict[str, Any],
    user_text: str,
    *,
    ws_client_intent: Optional[str] = None,
    rule_based_intent: Optional[str] = None,
) -> None:
    """
    Mutates `parsed` in place: if `gestures` is empty, append mapped defaults.
    Skips when the model already sent gesture objects.
    """
    existing = parsed.get("gestures")
    if isinstance(existing, list) and len(existing) > 0:
        return

    em = str(parsed.get("emotion") or "neutral")
    intent = resolve_behavior_intent(
        parsed,
        user_text,
        ws_client_intent=ws_client_intent,
        rule_based_intent=rule_based_intent,
    )
    parsed["gestures"] = map_emotion_intent_to_gestures(em, intent)
