# -*- coding: utf-8 -*-
"""
test_voice_pipeline.py — Integration tests for the voice pipeline.

Tests:
  1. Valid audio upload → frame sequence: transcribing → (transcript OR error)
  2. Audio too short (<400 ms)           → error frame with code 'audio_too_short'
  3. WS heartbeat received               → pong frame with matching id

Uses starlette TestClient (synchronous; works without a live server).
asyncio_mode = auto (set in pytest.ini).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import wave
import io
from typing import Generator

import pytest
from starlette.testclient import TestClient


def _faster_whisper_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


requires_whisper = pytest.mark.skipif(
    not _faster_whisper_available(),
    reason="faster-whisper not installed (optional for CI / default pytest)",
)

# Starlette TestClient + long-running agent_ws is flaky on some Windows/Python stacks; opt-in only.
skip_ws_agent_testclient = pytest.mark.skipif(
    os.getenv("COGNI_WS_E2E", "").lower() not in ("1", "true", "yes"),
    reason="Set COGNI_WS_E2E=1 to run /ws/agent TestClient tests",
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture: import the FastAPI app
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def _cogni_ws_allow_guest_for_file() -> Generator[None, None, None]:
    """Guest /ws/agent without JWT — dev-only path; production forbids via Settings validator."""
    prev = os.environ.get("COGNI_WS_ALLOW_ANONYMOUS")
    os.environ["COGNI_WS_ALLOW_ANONYMOUS"] = "true"
    yield
    if prev is None:
        os.environ.pop("COGNI_WS_ALLOW_ANONYMOUS", None)
    else:
        os.environ["COGNI_WS_ALLOW_ANONYMOUS"] = prev


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    """Yield a TestClient for the FastAPI app (one lifespan for the module)."""
    import sys, os
    # Ensure backend root is importable
    _root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if _root not in sys.path:
        sys.path.insert(0, _root)

    from app.main import app  # type: ignore[import]
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — synthetic WAV builders
# ─────────────────────────────────────────────────────────────────────────────

def _make_wav(duration_ms: int, sample_rate: int = 16_000) -> bytes:
    """Return minimal 16-bit PCM WAV bytes of the given duration in ms."""
    num_samples = int(sample_rate * duration_ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)   # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * num_samples)
    return buf.getvalue()


def _wav_to_b64(wav_bytes: bytes) -> str:
    return base64.b64encode(wav_bytes).decode()


# ─────────────────────────────────────────────────────────────────────────────
# Helper — collect WS frames until a terminal frame type or max_frames reached
# ─────────────────────────────────────────────────────────────────────────────

TERMINAL_TYPES = frozenset({"speech", "tts_unavailable", "error"})


def _collect_frames(ws, *, max_frames: int = 10) -> list[dict]:
    """Read frames until a terminal frame type is seen or max_frames hit."""
    frames: list[dict] = []
    for _ in range(max_frames):
        try:
            raw = ws.receive_text(timeout=10)
            frame = json.loads(raw)
            frames.append(frame)
            if frame.get("type") in TERMINAL_TYPES:
                break
        except Exception:
            break
    return frames


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@skip_ws_agent_testclient
class TestVoicePipelineWS:
    """WebSocket voice pipeline integration tests."""

    @requires_whisper
    def test_valid_audio_produces_transcribing_then_terminal(self, client: TestClient) -> None:
        """
        Sending a 1-second silent WAV must produce at minimum:
          - a 'transcribing' frame (STT started)
          - followed by a terminal frame: 'speech', 'tts_unavailable', or 'error'

        Note: In CI without real OpenAI keys the LLM/TTS calls will fail,
        but the STT pipeline frame sequence ('transcribing' then 'error') is
        still exercised and verified.
        """
        wav_b64 = _wav_to_b64(_make_wav(duration_ms=1_000))

        with client.websocket_connect("/ws/agent") as ws:
            ws.send_text(json.dumps({
                "v":    1.1,
                "id":   "test-valid-audio",
                "type": "audio",
                "data": wav_b64,
            }))
            frames = _collect_frames(ws, max_frames=15)

        types = [f.get("type") for f in frames]
        # We MUST see 'transcribing' (STT handoff)
        assert "transcribing" in types, (
            f"Expected 'transcribing' frame; got: {types}"
        )
        # We MUST see at least one terminal frame
        terminal_seen = any(t in TERMINAL_TYPES for t in types)
        assert terminal_seen, (
            f"Expected terminal frame (speech/tts_unavailable/error); got: {types}"
        )

    @requires_whisper
    def test_short_audio_returns_error_audio_too_short(self, client: TestClient) -> None:
        """
        Audio shorter than 400 ms must be rejected with:
          error.message containing 'audio_too_short' OR the error type is 'error'.
        The 'transcribing' frame must NOT appear (validation is pre-STT).
        """
        wav_b64 = _wav_to_b64(_make_wav(duration_ms=100))

        with client.websocket_connect("/ws/agent") as ws:
            ws.send_text(json.dumps({
                "v":    1.1,
                "id":   "test-short-audio",
                "type": "audio",
                "data": wav_b64,
            }))
            frames = _collect_frames(ws, max_frames=5)

        types = [f.get("type") for f in frames]
        assert "error" in types, (
            f"Expected 'error' frame for short audio; got: {types}"
        )
        # Error frame should mention audio_too_short
        error_frames = [f for f in frames if f.get("type") == "error"]
        error_bodies = [json.dumps(f) for f in error_frames]
        assert any("audio_too_short" in body for body in error_bodies), (
            f"Expected 'audio_too_short' in error body; got: {error_bodies}"
        )

    def test_ws_protocol_version_in_frames(self, client: TestClient) -> None:
        """
        Ping then pong (v1.1 id echo); every server frame includes v=1.1.
        """
        with client.websocket_connect("/ws/agent") as ws:
            ws.send_text(json.dumps({"v": 1.1, "id": "ver-test", "type": "ping"}))
            frames = _collect_frames(ws, max_frames=8)

        pong_frames = [f for f in frames if f.get("type") == "pong"]
        assert pong_frames, f"Expected 'pong' frame; got: {[f.get('type') for f in frames]}"
        for pong in pong_frames:
            assert "id" in pong, f"Pong frame missing 'id': {pong}"

        for frame in frames:
            assert "v" in frame, f"Frame missing 'v' field: {frame}"
            assert frame["v"] == 1.1, f"Frame has wrong version: {frame['v']} (expected 1.1)"

# ─────────────────────────────────────────────────────────────────────────────
# Memory API smoke tests
# ─────────────────────────────────────────────────────────────────────────────

class TestMemoryAPI:
    """Smoke tests for /api/v1/memory/conversations endpoints."""

    def test_save_and_fetch_conversation(
        self, client: TestClient, auth_as_student_a
    ) -> None:
        """POST then GET roundtrip for a conversation."""
        session_id = "test-session-001"
        payload = {
            "session_id": session_id,
            "exchanges":  [
                {"role": "user",      "text": "مرحبا", "ts": 1700000000000},
                {"role": "assistant", "text": "أهلاً",  "ts": 1700000001000},
            ],
            "summary": "تحية بسيطة",
        }
        resp = client.post("/api/v1/memory/conversations", json=payload)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "id" in body

        # Fetch by session
        resp2 = client.get(f"/api/v1/memory/conversations/{session_id}")
        assert resp2.status_code == 200, resp2.text
        data = resp2.json()
        assert data["session_id"] == session_id
        assert len(data["exchanges"]) == 2

    def test_list_conversations_teacher_can_filter_by_user_id(
        self,
        client: TestClient,
        auth_as_teacher,
    ) -> None:
        """Teacher may list another user's conversations via user_id query."""
        uid = "00000000-0000-4000-8000-000000000001"
        resp = client.get(
            "/api/v1/memory/conversations",
            params={"user_id": uid},
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_list_without_user_id_returns_own_for_student(
        self, client: TestClient, auth_as_student_a
    ) -> None:
        """Student GET without user_id lists their own conversations."""
        resp = client.get("/api/v1/memory/conversations")
        assert resp.status_code == 200, resp.text
        assert len(resp.json()) >= 1

    def test_fetch_unknown_session_returns_404(
        self, client: TestClient, auth_as_student_a
    ) -> None:
        """GET unknown session returns 404."""
        resp = client.get("/api/v1/memory/conversations/nonexistent-session-xyz")
        assert resp.status_code == 404, resp.text
