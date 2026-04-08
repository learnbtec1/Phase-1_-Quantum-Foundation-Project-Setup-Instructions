# -*- coding: utf-8 -*-
"""Reports + BTEC progress: auth and IDOR (student vs teacher)."""

from __future__ import annotations

import uuid
from typing import Any

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

client = TestClient(app)


@pytest.fixture
def clean_eval_repo(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Isolate in-memory evaluation store per test."""
    from repository import evaluations as evm

    inst = evm.InMemoryEvaluationRepository()
    monkeypatch.setattr(evm, "_repo_instance", inst)
    return inst


def _seed(repo: Any, student_id: uuid.UUID) -> None:
    repo.create(
        student_id=str(student_id),
        title="Test BTEC unit",
        original_text="submission text",
        status="evaluated",
        criteria={"P1": "ok"},
        final_grade="P",
        feedback="Good",
    )


def test_reports_json_no_auth_returns_401(no_auth_override: Any) -> None:
    r = client.get(f"/api/v1/reports/student/{STUDENT_A_ID}/json")
    assert r.status_code == 401


def test_reports_json_student_other_id_returns_404(
    clean_eval_repo: Any, auth_as_student_b: Any
) -> None:
    _seed(clean_eval_repo, STUDENT_A_ID)
    r = client.get(f"/api/v1/reports/student/{STUDENT_A_ID}/json")
    assert r.status_code == 404
    assert r.json().get("detail") == "Report not found"


def test_reports_json_student_own_returns_200(
    clean_eval_repo: Any, auth_as_student_a: Any
) -> None:
    _seed(clean_eval_repo, STUDENT_A_ID)
    r = client.get(f"/api/v1/reports/student/{STUDENT_A_ID}/json")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0].get("student_id") == str(STUDENT_A_ID)


def test_reports_json_teacher_can_read_any_student(
    clean_eval_repo: Any, auth_as_teacher: Any
) -> None:
    _seed(clean_eval_repo, STUDENT_A_ID)
    r = client.get(f"/api/v1/reports/student/{STUDENT_A_ID}/json")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_reports_json_teacher_empty_returns_404(
    clean_eval_repo: Any, auth_as_teacher: Any
) -> None:
    r = client.get(f"/api/v1/reports/student/{STUDENT_B_ID}/json")
    assert r.status_code == 404
    assert r.json().get("detail") == "Report not found"


def test_reports_student_invalid_uuid_returns_404(auth_as_student_a: Any) -> None:
    r = client.get("/api/v1/reports/student/not-a-uuid/json")
    assert r.status_code == 404
    assert r.json().get("detail") == "Report not found"


def test_btec_progress_no_auth_returns_401(no_auth_override: Any) -> None:
    r = client.post(
        "/api/v1/btec/progress",
        json={"unit_id": "unit25", "achieved": []},
    )
    assert r.status_code == 401


def test_btec_progress_with_auth_still_validates_unit(auth_as_student_a: Any) -> None:
    """Authenticated but unknown unit → 404 (unchanged behaviour after adding Depends)."""
    r = client.post(
        "/api/v1/btec/progress",
        json={"unit_id": "nonexistent_unit_xyz", "achieved": []},
    )
    assert r.status_code == 404


@pytest.fixture
def auth_as_admin() -> Any:
    set_current_user_override(
        uuid.UUID("00000000-0000-4000-8000-000000000099"), UserRole.admin
    )
    yield
    clear_current_user_override()


def test_reports_json_admin_can_read_student(
    clean_eval_repo: Any, auth_as_admin: Any
) -> None:
    _seed(clean_eval_repo, STUDENT_A_ID)
    r = client.get(f"/api/v1/reports/student/{STUDENT_A_ID}/json")
    assert r.status_code == 200
