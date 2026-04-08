# -*- coding: utf-8 -*-
from app.services.cogni_behavior import (
    augment_ws_reply_gestures,
    resolve_behavior_intent,
)


def test_llm_intent_overrides_keywords():
    parsed = {"gestures": [], "emotion": "neutral", "llm_intent": "student is asking why"}
    assert (
        resolve_behavior_intent(parsed, "شكرا جزيلا", ws_client_intent=None, rule_based_intent="gratitude")
        == "question"
    )


def test_ws_client_intent_second_priority():
    parsed = {"gestures": [], "emotion": "neutral"}
    assert (
        resolve_behavior_intent(
            parsed,
            "نص عادي",
            ws_client_intent="user expresses thanks",
            rule_based_intent="btec_question",
        )
        == "gratitude"
    )


def test_rule_based_maps_btec_to_question():
    parsed = {"gestures": [], "emotion": "neutral"}
    assert (
        resolve_behavior_intent(parsed, "hello", ws_client_intent=None, rule_based_intent="btec_question")
        == "question"
    )


def test_keyword_fallback_question_mark():
    parsed = {"gestures": [], "emotion": "neutral"}
    assert resolve_behavior_intent(parsed, "ما هذا؟", ws_client_intent=None, rule_based_intent=None) == "question"


def test_augment_fills_empty_gestures():
    parsed = {"gestures": [], "emotion": "encouraging", "dialogue": "تمام"}
    augment_ws_reply_gestures(
        parsed,
        "اشرح لي الفرق",
        ws_client_intent=None,
        rule_based_intent="general_question",
    )
    assert isinstance(parsed.get("gestures"), list)
    assert len(parsed["gestures"]) >= 1
    assert parsed["gestures"][0].get("type")


def test_augment_skips_when_llm_sent_gestures():
    parsed = {
        "gestures": [{"type": "wave", "start_ms": 100, "duration_ms": 1200, "intensity": 0.8}],
        "emotion": "neutral",
    }
    augment_ws_reply_gestures(parsed, "hi", rule_based_intent="greeting")
    assert len(parsed["gestures"]) == 1
