# -*- coding: utf-8 -*-
"""
WebSocket endpoint — مزامنة حالة العالم الافتراضي (Virtual World State).
يدعم: انضمام، مغادرة، بث الحالة للمشاركين في نفس الغرفة.
"""

from __future__ import annotations
import json
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])


class ConnectionManager:
    """إدارة اتصالات WebSocket حسب room_id."""

    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}

    async def join(self, websocket: WebSocket, room_id: str) -> None:
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = set()
        self.rooms[room_id].add(websocket)
        logger.info("WebSocket joined room=%s, total=%d", room_id, len(self.rooms.get(room_id, [])))

    def leave(self, websocket: WebSocket, room_id: str) -> None:
        if room_id in self.rooms:
            self.rooms[room_id].discard(websocket)
            if not self.rooms[room_id]:
                del self.rooms[room_id]
        logger.info("WebSocket left room=%s", room_id)

    async def broadcast_to_room(self, room_id: str, message: dict) -> None:
        if room_id not in self.rooms:
            return
        payload = json.dumps(message, ensure_ascii=False)
        dead = set()
        for ws in self.rooms[room_id]:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.rooms[room_id].discard(ws)


manager = ConnectionManager()


@router.websocket("/world/{room_id}")
async def websocket_world(websocket: WebSocket, room_id: str):
    """
    انضمام إلى غرفة العالم الافتراضي.
    استقبال رسائل: { "action": "state", "payload": {...} } لبث الحالة للغرفة.
    """
    await manager.join(websocket, room_id)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                action = data.get("action", "")
                if action == "state" or action == "broadcast":
                    await manager.broadcast_to_room(room_id, data.get("payload", data))
                elif action == "ping":
                    await websocket.send_text(json.dumps({"action": "pong"}))
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"error": "invalid_json"}))
    except WebSocketDisconnect:
        pass
    finally:
        manager.leave(websocket, room_id)
