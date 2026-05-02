# -*- coding: utf-8 -*-
"""
Cogni `/ws/agent` WebSocket — EDUVERS-CORE ships a minimal endpoint so the Next.js
client can complete the handshake (avoids Chromium 1006 when nothing listens).

Auth matches REST intent without importing HTTP `Depends(get_current_user)` so a broken
Postgres credential does not abort the socket during unrelated REST dependency resolution.

Extend with LLM/STT relay under a feature flag when a full agent service is wired in.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.security import decode_token
from app.services.ws_agent_pipeline import process_agent_audio_turn, process_agent_text_turn

logger = logging.getLogger(__name__)

_CONTROL_TYPES = frozenset(
    {
        "persona_init",
        "device_context",
        "set_focus_subject",
        "deep_link_config",
        "session_context",
    }
)


def _auth_outcome_for_token(token: str | None) -> dict[str, Any]:
    """
    Validate dev static token or JWT without PostgreSQL — same bypass rule as REST when DB is unavailable.
    """
    if not token or not str(token).strip():
        if settings.AUTH_DEV_BYPASS:
            return {"ok": True, "mode": "dev_bypass_anonymous"}
        return {"ok": False, "detail": "empty_token"}
    t = str(token).strip()
    ws_demo = (
        getattr(settings, "COGNI_WS_ALLOW_ANONYMOUS", False)
        or getattr(settings, "COGNI_BFF_DEV_BYPASS_AUTH", False)
    )
    dev_tok = (getattr(settings, "COGNI_WS_DEV_STATIC_TOKEN", "") or "test-token-123").strip()
    if ws_demo and dev_tok and t == dev_tok:
        return {"ok": True, "mode": "cogni_ws_dev"}
    # Golden ticket: common dev token name even if AUTH_DEV_STATIC_TOKEN was left empty in one .env layer
    if settings.AUTH_DEV_BYPASS and t == "test-token-123":
        return {"ok": True, "mode": "dev_bypass"}
    if (
        settings.AUTH_DEV_BYPASS
        and (settings.AUTH_DEV_STATIC_TOKEN or "").strip()
        and t == (settings.AUTH_DEV_STATIC_TOKEN or "").strip()
    ):
        return {"ok": True, "mode": "dev_bypass"}
    try:
        data = decode_token(t)
        sub = data.get("sub")
        if sub is not None:
            return {"ok": True, "mode": "jwt", "sub": str(sub)}
    except Exception:
        pass
    return {"ok": False, "detail": "invalid_token"}


async def _ws_agent_loop(websocket: WebSocket) -> None:
    # No DB, no HTTP deps — accept first so proxies see a completed upgrade when the app runs.
    await websocket.accept()
    peer = websocket.client.host if websocket.client else "?"
    logger.info("ws/agent: connection accepted from %s", peer)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "ws/agent: invalid JSON from %s (%d bytes): %s",
                    peer,
                    len(raw),
                    (raw[:500] + "…") if len(raw) > 500 else raw,
                )
                continue
            mtype = str(msg.get("type") or "")
            logger.info("ws/agent: frame type=%s bytes=%d peer=%s", mtype or "(empty)", len(raw), peer)
            if mtype == "ping":
                await websocket.send_json(
                    {"type": "pong", "v": 1.1, "timestamp": msg.get("timestamp")}
                )
            elif mtype == "auth":
                tok = msg.get("token")
                outcome = _auth_outcome_for_token(str(tok) if tok is not None else None)
                if outcome.get("ok"):
                    body: dict[str, Any] = {"type": "auth_ok", "v": 1.1, "mode": outcome.get("mode")}
                    if outcome.get("sub"):
                        body["sub"] = outcome["sub"]
                    await websocket.send_json(body)
                else:
                    await websocket.send_json(
                        {"type": "auth_error", "v": 1.1, "detail": outcome.get("detail")}
                    )
            elif mtype == "audio":
                await websocket.send_json({"type": "thinking", "v": 1.1})
                try:
                    frames = await asyncio.to_thread(process_agent_audio_turn, msg)
                except Exception:
                    logger.exception("ws/agent: audio pipeline crashed")
                    await websocket.send_json(
                        {"type": "asr_error", "v": 1.1, "detail": "pipeline_exception"}
                    )
                else:
                    for fr in frames:
                        await websocket.send_json(fr)
            elif mtype == "text":
                await websocket.send_json({"type": "thinking", "v": 1.1})
                try:
                    frames = await asyncio.to_thread(process_agent_text_turn, msg)
                except Exception:
                    logger.exception("ws/agent: text pipeline crashed")
                    await websocket.send_json(
                        {"type": "asr_error", "v": 1.1, "detail": "pipeline_exception"}
                    )
                else:
                    for fr in frames:
                        await websocket.send_json(fr)
            elif mtype in _CONTROL_TYPES:
                await websocket.send_json(
                    {"type": "session_ack", "v": 1.1, "received": mtype}
                )
            else:
                logger.info("ws/agent: unhandled frame type=%r peer=%s — ignored", mtype, peer)
    except WebSocketDisconnect:
        logger.info("ws/agent: disconnected (%s)", peer)
    except Exception:
        logger.exception("ws/agent: loop error (%s)", peer)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


def register_ws_agent_route(app: FastAPI) -> None:
    """Attach `GET /ws/agent` upgrade handler to the FastAPI app."""

    @app.websocket("/ws/agent")
    async def ws_agent_socket(websocket: WebSocket) -> None:
        await _ws_agent_loop(websocket)
