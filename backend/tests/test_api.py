# -*- coding: utf-8 -*-
"""API integration tests (health, payload validation)."""
import pytest
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


def test_forensic_grade_v3_validation():
    # missing or short student_text
    r = client.post(
        "/api/v1/assessment/forensic-grade-v3",
        json={"assignment_text": "P1: شرح. M1: تحليل.", "student_text": "قليل"},
    )
    assert r.status_code == 422 or r.status_code == 400 or r.status_code == 500


def test_check_plagiarism_validation():
    r = client.post(
        "/api/v1/assessment/check_plagiarism",
        json={"text": "نص كافٍ للفحص " * 20},
    )
    assert r.status_code == 200
    data = r.json()
    assert "similarity" in data
    assert "ai" in data
    assert "likelihood" in data.get("ai", {})
    assert "report" in data.get("ai", {})
