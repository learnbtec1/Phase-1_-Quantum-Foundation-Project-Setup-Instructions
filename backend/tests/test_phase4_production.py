# -*- coding: utf-8 -*-
"""Phase 4: production guards (JWT secret, health minimization, Stripe webhook)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.production_guards import validate_jwt_secret_for_production
from app.main import app

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def test_validate_jwt_rejects_default() -> None:
    with pytest.raises(ValueError, match="default or a trivial"):
        validate_jwt_secret_for_production("change_this_in_production")


def test_validate_jwt_rejects_docker_placeholder() -> None:
    with pytest.raises(ValueError, match="default or a trivial"):
        validate_jwt_secret_for_production("change_this_in_production_docker")


def test_validate_jwt_rejects_short() -> None:
    with pytest.raises(ValueError, match="at least"):
        validate_jwt_secret_for_production("abcdefghijabcdefghijabcdefghij")  # 30 chars


def test_validate_jwt_accepts_strong() -> None:
    validate_jwt_secret_for_production("abcdefghij0123456789klmnopqrstuv")  # 32+ diverse


def test_settings_import_fails_when_production_and_weak_jwt() -> None:
    env = {k: v for k, v in os.environ.items()}
    env["ENVIRONMENT"] = "production"
    env["JWT_SECRET"] = "change_this_in_production"
    env["COGNI_WS_ALLOW_ANONYMOUS"] = "false"
    cp = subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings; print(settings.JWT_SECRET[:4])"],
        cwd=str(_BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert cp.returncode != 0
    assert "JWT_SECRET" in (cp.stderr or "") or "validation error" in (cp.stderr or "").lower()


def test_settings_import_ok_when_production_and_strong_jwt() -> None:
    env = {k: v for k, v in os.environ.items()}
    env["ENVIRONMENT"] = "production"
    env["JWT_SECRET"] = "abcdefghij0123456789klmnopqrstuvwxyz012"
    env["COGNI_WS_ALLOW_ANONYMOUS"] = "false"
    cp = subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings; assert settings.is_production"],
        cwd=str(_BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert cp.returncode == 0, cp.stderr


def test_settings_import_fails_when_production_and_anonymous_ws_enabled() -> None:
    env = {k: v for k, v in os.environ.items()}
    env["ENVIRONMENT"] = "production"
    env["JWT_SECRET"] = "abcdefghij0123456789klmnopqrstuvwxyz012"
    env["COGNI_WS_ALLOW_ANONYMOUS"] = "true"
    cp = subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings"],
        cwd=str(_BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert cp.returncode != 0
    assert "COGNI_WS_ALLOW_ANONYMOUS" in (cp.stderr or "")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_api_health_minimal_when_production(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr("app.main.settings", SimpleNamespace(is_production=True))
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_root_minimal_when_production(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr("app.main.settings", SimpleNamespace(is_production=True))
    r = client.get("/")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_stripe_webhook_production_requires_secret(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    monkeypatch.setattr(
        "app.api.v1.endpoints.stripe_webhook.settings",
        SimpleNamespace(is_production=True),
    )
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    r = client.post("/api/v1/webhooks/stripe", content=b"{}")
    assert r.status_code == 503
    assert "STRIPE_WEBHOOK_SECRET" in (r.json().get("detail") or "")
