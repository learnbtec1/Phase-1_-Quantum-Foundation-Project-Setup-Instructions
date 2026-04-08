# -*- coding: utf-8 -*-
"""Memory + BTEC auth / IDOR regression tests (Phase 1)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

from app.models.db_models import UserRole

from tests.conftest import (
    STUDENT_A_ID,
    STUDENT_B_ID,
    TEACHER_ID,
    clear_current_user_override,
    set_current_user_override,
)

STUDENT_B_UUID = str(STUDENT_B_ID)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_memory_routes_require_auth(client: TestClient, no_auth_override) -> None:
    assert client.get("/api/v1/memory/conversations").status_code == 401
    assert client.post("/api/v1/memory/conversations", json={}).status_code == 401
    assert client.get("/api/v1/memory/conversations/some-session").status_code == 401


def test_student_cannot_list_other_users_conversations(
    client: TestClient,
    auth_as_student_a,
) -> None:
    r = client.get(
        "/api/v1/memory/conversations",
        params={"user_id": STUDENT_B_UUID},
    )
    assert r.status_code == 403


def test_student_cannot_save_with_foreign_user_id(
    client: TestClient,
    auth_as_student_a,
) -> None:
    payload = {
        "session_id": "idor-save-test",
        "user_id": STUDENT_B_UUID,
        "exchanges": [],
        "summary": "",
    }
    r = client.post("/api/v1/memory/conversations", json=payload)
    assert r.status_code == 403


def test_student_a_cannot_read_student_b_session(client: TestClient) -> None:
    try:
        set_current_user_override(STUDENT_B_ID, UserRole.student)
        sid = "session-owned-by-b-only"
        body = {
            "session_id": sid,
            "exchanges": [{"role": "user", "text": "x", "ts": 1}],
            "summary": "",
        }
        assert client.post("/api/v1/memory/conversations", json=body).status_code == 201

        set_current_user_override(STUDENT_A_ID, UserRole.student)
        r = client.get(f"/api/v1/memory/conversations/{sid}")
        assert r.status_code == 404
    finally:
        clear_current_user_override()


def test_btec_ingest_units_requires_teacher_or_admin(client: TestClient) -> None:
    payload = {
        "unit_id": "pytest_auth_unit_z9",
        "title": "Pytest security unit title",
        "qualification": "",
        "description": "",
        "criteria": [
            {
                "code": "P1",
                "level": "pass",
                "description": "First criterion text ok",
                "scaffold_question": "",
                "keywords": [],
            },
            {
                "code": "P2",
                "level": "pass",
                "description": "Second criterion text ok",
                "scaffold_question": "",
                "keywords": [],
            },
        ],
    }
    try:
        set_current_user_override(STUDENT_A_ID, UserRole.student)
        denied = client.post("/api/v1/btec/units", json=payload)
        assert denied.status_code == 403

        set_current_user_override(TEACHER_ID, UserRole.teacher)
        ok = client.post("/api/v1/btec/units", json=payload)
        assert ok.status_code == 201, ok.text
    finally:
        clear_current_user_override()
