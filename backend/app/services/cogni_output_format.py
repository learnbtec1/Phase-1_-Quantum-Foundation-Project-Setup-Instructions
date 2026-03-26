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
