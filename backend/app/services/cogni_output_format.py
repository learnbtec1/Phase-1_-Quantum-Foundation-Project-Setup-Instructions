# -*- coding: utf-8 -*-
"""
Shared parsing for Cogni LLM replies:
  • Legacy: dialogue line + *action* + [EMOTION: tag]
  • Performance JSON: { "speech": "...", "performance": [ { tag, start_word, ... } ] }
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

ALLOWED_EMOTIONS = {
    "neutral",
    "friendly",
    "thinking",
    "encouraging",
    "strict",
    "celebrate",
    "celebration",
    "happy",
    "sad",
    "angry",
    "excited",
    "surprised",
    "relaxed",
    "calm",
    "proud",
    "curious",
    "attentive",
    "concerned",
    "sleepy",
    "bored",
    "anxious",
}

ACTION_DEFAULTS: Dict[str, str] = {
    "celebrate": "يلوح بيديه بحماس ويبتسم ابتسامة عريضة",
    "encouraging": "يفتح كفيه بلطف ويحرّك ذراعيه للأمام",
    "thinking": "يميل رأسه قليلاً وعيناه تتأملان",
    "strict": "يشير بإصبعه بثقة وينظر للأمام مباشرة",
    "friendly": "يبتسم بلطف ويميل رأسه قليلاً",
    "neutral": "يومئ برأسه برفق",
}

_EMOTE_TAG_TO_EMOTION = {
    "neutral": "neutral",
    "surprise": "surprised",
    "surprised": "surprised",
    "happy": "happy",
    "sad": "sad",
    "angry": "angry",
    "thinking": "thinking",
    "encouraging": "encouraging",
    "calm": "calm",
}


def try_parse_performance_json(text: str) -> Optional[Dict[str, Any]]:
    """
    If the model returns JSON with `speech` + optional `performance` array, return dict.
    """
    t = (text or "").strip()
    if not t:
        return None
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```\s*$", t)
    if m:
        t = m.group(1).strip()
    if not t.startswith("{"):
        first, last = t.find("{"), t.rfind("}")
        if first >= 0 and last > first:
            t = t[first : last + 1]
        else:
            return None
    try:
        obj = json.loads(t)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    speech = obj.get("speech")
    if not isinstance(speech, str) or not speech.strip():
        return None
    perf_raw = obj.get("performance")
    if perf_raw is None:
        perf_raw = []
    if not isinstance(perf_raw, list):
        return None
    cleaned: List[Dict[str, Any]] = []
    for item in perf_raw:
        if not isinstance(item, dict):
            continue
        tag = item.get("tag")
        if not isinstance(tag, str) or not tag.strip():
            continue
        try:
            sw = int(item.get("start_word", 0))
        except (TypeError, ValueError):
            sw = 0
        entry: Dict[str, Any] = {"tag": tag.strip(), "start_word": max(0, sw)}
        if isinstance(item.get("blendshape"), str) and item["blendshape"].strip():
            entry["blendshape"] = item["blendshape"].strip()
        if isinstance(item.get("animation"), str) and item["animation"].strip():
            entry["animation"] = item["animation"].strip()
        try:
            fi = float(item.get("intensity", 0.5))
        except (TypeError, ValueError):
            fi = 0.5
        entry["intensity"] = max(0.0, min(1.0, fi))
        cleaned.append(entry)
    return {"speech": speech.strip(), "performance": cleaned}


def parse_legacy_cogni_reply(text: str) -> Dict[str, str]:
    """Three-line Cogni format: *action*, [EMOTION: x], dialogue."""
    action_m = re.search(r"\*([^*]+)\*", text)
    emotion_m = re.search(r"\[EMOTION:\s*(\w+)\]", text)
    action = action_m.group(1).strip() if action_m else ACTION_DEFAULTS["neutral"]
    emotion = emotion_m.group(1).lower() if emotion_m else "friendly"
    if emotion not in ALLOWED_EMOTIONS:
        emotion = "friendly"
    dialogue = re.sub(r"\*[^*]+\*", "", text)
    dialogue = re.sub(r"\[EMOTION:\s*\w+\]", "", dialogue).strip()
    return {"dialogue": dialogue, "action": action, "emotion": emotion}


def parse_reply_unified(text: str) -> Dict[str, Any]:
    """Legacy format OR Performance JSON."""
    jp = try_parse_performance_json(text)
    if jp:
        speech = jp["speech"]
        perf: List[Dict[str, Any]] = jp["performance"]
        emotion = "neutral"
        for p in perf:
            tag = (p.get("tag") or "").strip()
            em_m = re.match(r"^\[EMOTE_(\w+)\]", tag, re.I)
            if em_m:
                key = em_m.group(1).lower()
                emotion = _EMOTE_TAG_TO_EMOTION.get(key, emotion)
        if emotion not in ALLOWED_EMOTIONS:
            emotion = "friendly"
        action = ""
        for p in perf:
            anim = p.get("animation")
            if isinstance(anim, str) and anim.strip():
                action = anim.strip()
                break
        if not action:
            action = ACTION_DEFAULTS.get(emotion, ACTION_DEFAULTS["neutral"])
        return {
            "dialogue": speech,
            "action": action,
            "emotion": emotion,
            "performance": perf,
        }
    legacy = parse_legacy_cogni_reply(text)
    legacy["performance"] = []
    return legacy


def verify_cogni_reply_format(text: str) -> bool:
    if try_parse_performance_json(text):
        return True
    return bool(re.search(r"\*[^*]+\*", text)) and bool(
        re.search(r"\[EMOTION:\s*\w+\]", text)
    )


# ── Inline gesture token support ────────────────────────────────────────────
# The LLM may embed gesture tokens directly in dialogue, e.g.:
#   "[wave] أهلاً بكم"  or  "[think] دعني أفكر"
# These are extracted, converted to performance[] cues, and stripped from text.

# Canonical gesture names accepted inside [brackets] (case-insensitive).
# Maps token → animation key used in VRMA_PATHS / animationMap.ts
_INLINE_GESTURE_MAP: Dict[str, str] = {
    # Core gestures
    "wave":       "wave",
    "waving":     "wave",
    "think":      "think",
    "thinking":   "think",
    "point":      "point",
    "pointing":   "point",
    "beckon":     "beckon",
    "beckoning":  "beckon",
    "agree":      "agree",
    "agreeing":   "agree",
    "nod":        "ack",
    "clap":       "clap",
    "clapping":   "clap",
    "cheer":      "cheer",
    "celebrate":  "cheer",
    "relax":      "relax",
    "look":       "look",
    "goodbye":    "goodbye",
    "bye":        "goodbye",
    # Emotions as gestures
    "sad":        "sad",
    "angry":      "angry",
    "surprise":   "surprise",
    "surprised":  "surprise",
    "blush":      "blush",
    "sleepy":     "sleepy",
    # Aliases
    "explain":    "point",
    "encourage":  "ack",
    "question":   "think",
    "greet":      "wave",
    "salute":     "wave",
    "shrug":      "relax",
    "peace":      "peace",
}

_INLINE_GESTURE_RE = re.compile(
    r"\[(" + "|".join(re.escape(k) for k in _INLINE_GESTURE_MAP) + r")\]",
    re.IGNORECASE,
)


def extract_inline_gestures(text: str) -> tuple[str, List[Dict[str, Any]]]:
    """
    Scan *text* for inline [gesture] tokens.

    Returns:
        (cleaned_text, performance_cues)

    cleaned_text   — original text with [gesture] tokens removed and whitespace normalised.
    performance_cues — list of performance dicts compatible with parse_reply_unified output.

    Example:
        "[wave] أهلاً بكم، [think] دعني أفكر" →
        ("أهلاً بكم، دعني أفكر",
         [{"tag": "[GESTURE_WAVE]", "start_word": 0, "animation": "wave", "intensity": 0.6},
          {"tag": "[GESTURE_THINK]", "start_word": 3, "animation": "think", "intensity": 0.55}])
    """
    if not text:
        return text, []

    cues: List[Dict[str, Any]] = []
    # Track word index as we process tokens
    # Strategy: split on token positions, count words in segments before each token
    word_cursor = 0
    cleaned_parts: List[str] = []
    last_end = 0

    for m in _INLINE_GESTURE_RE.finditer(text):
        # Text before this token
        segment = text[last_end:m.start()]
        if segment:
            cleaned_parts.append(segment)
            word_cursor += len(segment.split())
        last_end = m.end()

        token_lower = m.group(1).lower()
        anim_key = _INLINE_GESTURE_MAP.get(token_lower, "ack")
        tag = f"[GESTURE_{token_lower.upper()}]"
        cues.append({
            "tag":        tag,
            "start_word": word_cursor,
            "animation":  anim_key,
            "intensity":  0.60,
        })

    # Remaining text after last token
    tail = text[last_end:]
    if tail:
        cleaned_parts.append(tail)

    cleaned = "".join(cleaned_parts)
    # Normalise multiple spaces/newlines left by removed tokens
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()

    return cleaned, cues


def parse_reply_with_inline_gestures(text: str) -> Dict[str, Any]:
    """
    Full pipeline:
      1. Extract inline [gesture] tokens → extra performance cues.
      2. Run parse_reply_unified on the cleaned text.
      3. Merge performance arrays (inline cues first, then LLM-generated).
    """
    cleaned_text, inline_cues = extract_inline_gestures(text)
    result = parse_reply_unified(cleaned_text)
    existing_perf: List[Dict[str, Any]] = result.get("performance") or []
    result["performance"] = inline_cues + existing_perf
    return result
