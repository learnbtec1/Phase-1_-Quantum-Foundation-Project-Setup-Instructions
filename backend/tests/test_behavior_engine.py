# -*- coding: utf-8 -*-
import pytest

from app.services.behavior_engine import (
    BehaviorContext,
    BehaviorEngine,
    reset_behavior_engine_for_tests,
)
from app.archive.gesture_repertoire import reset_repertoire_for_tests
from app.archive.behavior_logger import reset_behavior_logger_for_tests


@pytest.fixture(autouse=True)
def _reset_singletons():
    reset_behavior_engine_for_tests()
    reset_repertoire_for_tests()
    reset_behavior_logger_for_tests()
    yield
    reset_behavior_engine_for_tests()
    reset_repertoire_for_tests()
    reset_behavior_logger_for_tests()


def test_behavior_engine_disabled_by_default():
    engine = BehaviorEngine()
    assert engine.enabled is False
    plan = engine.analyze_behavior(
        BehaviorContext(emotion="friendly", intent="greeting", reply_text="Hello!")
    )
    assert plan.gestures == []


def test_behavior_engine_returns_plan_when_enabled():
    engine = BehaviorEngine(enabled=True)
    ctx = BehaviorContext(emotion="friendly", intent="greeting", reply_text="Hello there friend!")
    plan = engine.analyze_behavior(ctx)
    assert isinstance(plan.gestures, list)
    assert plan.debug_info.get("decision_time_ms") is not None


def test_behavior_context_defaults():
    c = BehaviorContext()
    assert c.emotion == "neutral"
    assert c.intent == "statement"


def test_plan_ws_payload_keys():
    engine = BehaviorEngine(enabled=True)
    plan = engine.analyze_behavior(
        BehaviorContext(emotion="thinking", intent="question", reply_text="Why is the sky blue? " * 3)
    )
    payload = plan.to_ws_payload()
    assert "gestures" in payload
    assert "micro_expressions" in payload
    assert "gaze" in payload
    if payload["gestures"]:
        g0 = payload["gestures"][0]
        assert "start_ms" in g0 and "duration_ms" in g0
