# -*- coding: utf-8 -*-
"""Phase 3: WebSocket auth — no JWT in query; /ws/world membership."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.db_models import UserRole

STUDENT_A_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


@pytest.fixture
def ws_client() -> TestClient:
    return TestClient(app)


def test_agent_ws_rejects_token_query_param(ws_client: TestClient) -> None:
    """JWT in URL is rejected before the socket is usable."""
    with pytest.raises(Exception):
        with ws_client.websocket_connect("/ws/agent?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig"):
            pass


def test_agent_ws_guest_when_anonymous_allowed(ws_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNI_WS_ALLOW_ANONYMOUS", "true")
    with ws_client.websocket_connect("/ws/agent") as ws:
        ws.send_json({"type": "ping", "id": "t0"})
        data = ws.receive_json()
        assert data.get("type") == "pong"


@patch("app.api.v1.endpoints.agent_ws.load_user_from_access_token")
def test_agent_ws_auth_frame_ok(mock_load: MagicMock, ws_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNI_WS_ALLOW_ANONYMOUS", "false")
    u = MagicMock()
    u.id = STUDENT_A_ID
    u.role = UserRole.student
    u.subscription_plan = "free"
    u.model_tier = "standard"
    u.is_active = True
    mock_load.return_value = u

    with ws_client.websocket_connect("/ws/agent") as ws:
        ws.send_json({"type": "auth", "token": "dummy-jwt"})
        ack = ws.receive_json()
        assert ack.get("type") == "auth_ok"
        ws.send_json({"type": "ping", "id": "t1"})
        data = ws.receive_json()
        assert data.get("type") == "pong"


@patch("app.api.v1.endpoints.websocket.load_user_from_access_token")
def test_world_ws_rejects_without_valid_auth(mock_load: MagicMock, ws_client: TestClient) -> None:
    mock_load.return_value = None
    with ws_client.websocket_connect("/ws/world/public-demo") as ws:
        ws.send_json({"type": "auth", "token": "bad"})
        msg = ws.receive_json()
        assert msg.get("type") == "error"
        assert msg.get("message") == "forbidden"


@patch("app.api.v1.endpoints.websocket.load_user_from_access_token")
def test_world_ws_accepts_student_public_room(mock_load: MagicMock, ws_client: TestClient) -> None:
    u = MagicMock()
    u.id = STUDENT_A_ID
    u.role = UserRole.student
    u.is_active = True
    mock_load.return_value = u

    with ws_client.websocket_connect("/ws/world/public-demo") as ws:
        ws.send_json({"type": "auth", "token": "ok"})
        ack = ws.receive_json()
        assert ack.get("type") == "auth_ok"
        ws.send_json({"action": "ping"})
        pong = ws.receive_json()
        assert pong.get("action") == "pong"


@patch("app.api.v1.endpoints.websocket.load_user_from_access_token")
def test_world_ws_student_denied_private_room(mock_load: MagicMock, ws_client: TestClient) -> None:
    u = MagicMock()
    u.id = STUDENT_A_ID
    u.role = UserRole.student
    u.is_active = True
    mock_load.return_value = u

    with ws_client.websocket_connect("/ws/world/private-room-no-uuid") as ws:
        ws.send_json({"type": "auth", "token": "ok"})
        msg = ws.receive_json()
        assert msg.get("type") == "error"
        assert msg.get("message") == "forbidden"
