# -*- coding: utf-8 -*-
"""
WebSocket endpoint — مزامنة حالة العالم الافتراضي (Virtual World State).
يدعم: انضمام، مغادرة، بث الحالة للمشاركين في نفس الغرفة.

Auth: أول إطار نصي JSON بعد القبول:
  { "type": "auth", "token": "<JWT>" }
يُحمّل المستخدم من قاعدة البيانات (نشط) مثل مسارات HTTP. لا انضمام بدون مصادقة صالحة.
صلاحية الغرفة: معلم/إداري — أي غرفة؛ طالب — غرف `public-*` أو أي `room_id` يحتوي `str(user.id)`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import load_user_from_access_token
from app.models.db_models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])

_WORLD_ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$")


def _can_join_world_room(user: User, room_id: str) -> bool:
    rid = (room_id or "").strip()
    if not rid:
        return False
    r = user.role
    role_val = r.value if hasattr(r, "value") else str(r)
    if role_val in ("teacher", "admin"):
        return True
    if rid.startswith("public-"):
        return True
    return str(user.id) in rid


class ConnectionManager:
    """إدارة اتصالات WebSocket حسب room_id (بعد قبول الاتصال ومصادقة العميل)."""

    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}

    def register(self, websocket: WebSocket, room_id: str) -> None:
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
    انضمام إلى غرفة العالم الافتراضي بعد مصادقة JWT في أول إطار.
    استقبال رسائل: { "action": "state", "payload": {...} } لبث الحالة للغرفة.
    """
    if not _WORLD_ROOM_ID_RE.match(room_id or ""):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    user: User | None = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
        data = json.loads(raw)
        mtype = str(data.get("type") or "").lower()
        if mtype not in ("auth", "authenticate"):
            await websocket.send_text(json.dumps({"type": "error", "message": "auth_required"}))
            await websocket.close(code=1008)
            return
        tok = (data.get("token") or data.get("access_token") or "").strip()
        user = load_user_from_access_token(tok)
        if not user or not _can_join_world_room(user, room_id):
            await websocket.send_text(json.dumps({"type": "error", "message": "forbidden"}))
            await websocket.close(code=1008)
            return
        await websocket.send_text(json.dumps({"type": "auth_ok", "v": 1.1}, ensure_ascii=False))
    except asyncio.TimeoutError:
        await websocket.close(code=1008)
        return
    except json.JSONDecodeError:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "invalid_json"}))
        except Exception:
            pass
        await websocket.close(code=1008)
        return
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.close(code=1011)
        return

    manager.register(websocket, room_id)
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
