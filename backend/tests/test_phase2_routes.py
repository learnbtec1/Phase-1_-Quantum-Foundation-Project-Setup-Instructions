# -*- coding: utf-8 -*-
"""Phase 2: unauthenticated access to protected LLM / Eduverse / TTS / STT routes → 401."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def no_auth_override():
    from tests.conftest import clear_current_user_override

    clear_current_user_override()
    yield
    clear_current_user_override()


def test_chat_requires_bearer(no_auth_override) -> None:
    r = client.post("/api/v1/chat", json={"message": "hello", "history": []})
    assert r.status_code == 401


def test_evaluate_and_speak_requires_bearer(no_auth_override) -> None:
    r = client.post(
        "/api/v1/evaluate-and-speak",
        json={
            "assignment": "assignment text long enough",
            "submission": "submission text long enough",
        },
    )
    assert r.status_code == 401


def test_eduverse_grade_verified_requires_bearer(no_auth_override) -> None:
    r = client.post(
        "/api/v1/eduverse/grade-verified",
        json={
            "assignment_text": "P1: criterion one. P2: criterion two.",
            "student_text": "student answer long enough here",
        },
    )
    assert r.status_code == 401


def test_eduverse_student_history_requires_bearer(no_auth_override) -> None:
    r = client.get("/api/v1/eduverse/student/some-id/history")
    assert r.status_code == 401


def test_eduverse_appeal_requires_bearer(no_auth_override) -> None:
    r = client.post(
        "/api/v1/eduverse/appeal",
        json={
            "job_id": "abc",
            "student_message": "اعتراض الطالب هنا",
            "criterion_code": "P1",
        },
    )
    assert r.status_code == 401


def test_eduverse_audit_requires_bearer(no_auth_override) -> None:
    r = client.get("/api/v1/eduverse/audit/deadbeef")
    assert r.status_code == 401


def test_tts_generate_requires_bearer(no_auth_override) -> None:
    r = client.post("/api/v1/tts/generate", json={"text": "مرحبا"})
    assert r.status_code == 401


def test_tts_with_timing_requires_bearer(no_auth_override) -> None:
    r = client.post(
        "/api/v1/tts-with-timing",
        json={"text": "test", "emotion": "neutral"},
    )
    assert r.status_code == 401


def test_stt_requires_bearer(no_auth_override) -> None:
    r = client.post(
        "/api/v1/stt",
        files={"audio": ("x.wav", io.BytesIO(b"\x00" * 200), "audio/wav")},
    )
    assert r.status_code == 401


def test_tts_reset_circuit_requires_teacher(auth_as_student_a) -> None:
    r = client.post("/api/v1/tts-reset-circuit")
    assert r.status_code == 403
