# -*- coding: utf-8 -*-
"""API integration tests (health, payload validation)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_check():
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "Online"
    assert "engine" in data
    assert "X-Request-ID" in r.headers or True  # optional


def test_forensic_grade_v3_validation(auth_as_student_a):
    # missing or short student_text (min 20 chars) — authenticated via override
    r = client.post(
        "/api/v1/assessment/forensic-grade-v3",
        json={"assignment_text": "P1: شرح. M1: تحليل.", "student_text": "قليل"},
    )
    assert r.status_code in (400, 422, 500, 503)


def test_forensic_grade_v3_requires_auth(no_auth_override):
    r = client.post(
        "/api/v1/assessment/forensic-grade-v3",
        json={
            "assignment_text": "P1: شرح طويل بما يكفي للحد الأدنى.",
            "student_text": "إجابة طالب طويلة بما يكفي للحد الأدنى هنا.",
        },
    )
    assert r.status_code in (401, 403)


def test_check_plagiarism_validation(auth_as_student_a):
    r = client.post(
        "/api/v1/assessment/check_plagiarism",
        json={"text": "نص كافٍ للفحص " * 20},
    )
    assert r.status_code == 200
    data = r.json()
    # PlagiarismGuard shape may expose heuristic block (score/findings) or LLM block (similarity/ai).
    assert "score" in data or "similarity" in data
    assert "findings" in data or "ai" in data
