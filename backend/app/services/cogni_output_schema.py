# -*- coding: utf-8 -*-
"""
Strict JSON envelope for Cogni LLM replies (V32).

Used when ``COGNI_STRICT_JSON_MODE=true``. Keeps schema + validation separate from
``agent_ws.py`` to avoid duplicate WebSocket implementations.

Public API:
  - CogniOutput, CogniGesture
  - validate_cogni_output(raw_text) -> CogniOutput
  - parse_llm_reply_strict_json(raw_text) -> legacy ``parsed`` dict for WS payload
  - cogni_strict_json_enabled() -> bool
  - COGNI_SYSTEM_PROMPT — optional append to system prompt when strict mode is on
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
if sys.version_info >= (3, 11):
    from enum import StrEnum
else:
    from enum import Enum
    class StrEnum(str, Enum):  # type: ignore[no-redef]
        """Backport of StrEnum for Python < 3.11."""
        pass
from typing import Any, Dict

from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger("cogni.output_schema")

# Mirror agent_ws._ACTION_DEFAULTS for strict-json path (avoid importing agent_ws).
_STRICT_JSON_ACTION_DEFAULTS: dict[str, str] = {
    "celebrate": "يلوح بيديه بحماس ويبتسم ابتسامة عريضة",
    "encouraging": "يفتح كفيه بلطف ويحرّك ذراعيه للأمام",
    "thinking": "يميل رأسه قليلاً وعيناه تتأملان",
    "strict": "يشير بإصبعه بثقة وينظر للأمام مباشرة",
    "friendly": "يبتسم بلطف ويميل رأسه قليلاً",
    "neutral": "يومئ برأسه برفق",
}


class CogniGesture(StrEnum):
    IDLE = "idle"
    EXPLAIN = "explain"
    POINT = "point"
    THINK = "think"


class CogniOutput(BaseModel):
    """Validated JSON object from the LLM when strict mode is enabled."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    spoken_response: str = Field(..., min_length=1, max_length=32_000)
    gesture: CogniGesture = CogniGesture.IDLE
    gesture_duration_ms: int = Field(default=2000, ge=200, le=120_000)
    emotion: str = Field(default="neutral", max_length=64)
    intensity: float = Field(default=0.7, ge=0.0, le=1.0)

    @field_validator("emotion")
    @classmethod
    def _norm_emotion(cls, v: str) -> str:
        s = (v or "neutral").strip().lower() or "neutral"
        return s[:64]


def cogni_strict_json_enabled() -> bool:
    return os.getenv("COGNI_STRICT_JSON_MODE", "false").lower() in ("1", "true", "yes")


def _strip_json_fences(raw: str) -> str:
    t = (raw or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.I)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def validate_cogni_output(raw_text: str) -> CogniOutput:
    """
    Parse and validate LLM output as JSON matching :class:`CogniOutput`.

    Raises:
        ValueError: invalid JSON or schema validation failure (message for logs/UI).
    """
    blob = _strip_json_fences(raw_text or "")
    if not blob:
        raise ValueError("empty strict JSON reply")
    try:
        data = json.loads(blob)
    except json.JSONDecodeError as e:
        raise ValueError(f"strict JSON parse failed: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("strict JSON root must be an object")
    try:
        return CogniOutput.model_validate(data)
    except Exception as e:
        raise ValueError(f"strict JSON schema validation failed: {e}") from e


def cogni_output_to_dict(obj: CogniOutput) -> dict[str, Any]:
    return obj.model_dump(mode="json")


def parse_llm_reply_strict_json(raw_text: str) -> Dict[str, Any]:
    """
    Parse strict JSON and return the legacy ``parsed`` shape expected by agent_ws
    (dialogue, action, emotion, performance, …) plus ``_gesture_event`` for the client.
    """
    validated = validate_cogni_output(raw_text)
    emo = validated.emotion or "neutral"
    parsed: Dict[str, Any] = {
        "dialogue": validated.spoken_response,
        "action": _STRICT_JSON_ACTION_DEFAULTS.get(emo, _STRICT_JSON_ACTION_DEFAULTS["neutral"]),
        "emotion": emo,
        "performance": [],
        "gestures": [],
        "motor_commands": None,
        "awareness_cues": None,
        "internal_monologue": None,
    }
    parsed["_gesture_event"] = {
        "gesture": validated.gesture.value,
        "duration": validated.gesture_duration_ms / 1000.0,
        "emotion": emo,
        "intensity": validated.intensity,
    }
    logger.info(
        "[CogniOutput] strict parse | gesture=%s duration_ms=%d emotion=%s intensity=%.2f",
        validated.gesture.value,
        validated.gesture_duration_ms,
        emo,
        validated.intensity,
    )
    return parsed


COGNI_SYSTEM_PROMPT = """
[COGNI_STRICT_JSON]
يجب أن يكون ردك **كائناً JSON واحداً فقط** (بدون نص قبله أو بعده، وبدون تنسيق Markdown) بالحقول التالية:
{
  "spoken_response": "<نص الحوار للطالب بالعربية>",
  "gesture": "idle" | "explain" | "point" | "think",
  "gesture_duration_ms": <عدد صحيح بين 200 و 120000>,
  "emotion": "<وسم عاطفي قصير بالإنجليزية مثل neutral أو friendly>",
  "intensity": <عدد عشري بين 0 و 1>
}
لا تضف حقولاً أخرى. لا تستخدم التنسيق الثلاثي الأسطر (*حركة* أو [EMOTION:]) في وضع JSON.
""".strip()
