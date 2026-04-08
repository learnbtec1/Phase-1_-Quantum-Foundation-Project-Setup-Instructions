# -*- coding: utf-8 -*-
"""Tests for strict JSON Cogni output schema (cogni_output_schema.py)."""
from __future__ import annotations

import pytest

from app.services.cogni_output_schema import (
    CogniGesture,
    CogniOutput,
    cogni_strict_json_enabled,
    parse_llm_reply_strict_json,
    validate_cogni_output,
)
from app.services import cogni_output_format as _shim


def test_shim_reexports_schema_symbols() -> None:
    assert _shim.CogniOutput is CogniOutput
    assert _shim.validate_cogni_output is validate_cogni_output


def test_validate_cogni_output_minimal() -> None:
    raw = '{"spoken_response": "مرحبا", "gesture": "explain"}'
    out = validate_cogni_output(raw)
    assert out.spoken_response == "مرحبا"
    assert out.gesture == CogniGesture.EXPLAIN
    assert out.gesture_duration_ms == 2000


def test_validate_strips_json_fence() -> None:
    raw = '```json\n{"spoken_response": "ok", "gesture": "idle"}\n```'
    out = validate_cogni_output(raw)
    assert out.spoken_response == "ok"


def test_validate_rejects_extra_keys() -> None:
    raw = '{"spoken_response": "x", "gesture": "point", "extra": 1}'
    with pytest.raises(ValueError, match="schema validation"):
        validate_cogni_output(raw)


def test_parse_llm_reply_strict_json_legacy_shape() -> None:
    raw = (
        '{"spoken_response": "نص", "gesture": "think", '
        '"gesture_duration_ms": 3000, "emotion": "friendly", "intensity": 0.5}'
    )
    parsed = parse_llm_reply_strict_json(raw)
    assert parsed["dialogue"] == "نص"
    assert parsed["emotion"] == "friendly"
    assert parsed["_gesture_event"]["gesture"] == "think"
    assert parsed["_gesture_event"]["duration"] == 3.0


def test_cogni_strict_json_enabled_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COGNI_STRICT_JSON_MODE", raising=False)
    assert cogni_strict_json_enabled() is False
    monkeypatch.setenv("COGNI_STRICT_JSON_MODE", "true")
    assert cogni_strict_json_enabled() is True
