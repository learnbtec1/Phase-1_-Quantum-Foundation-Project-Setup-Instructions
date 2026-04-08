# -*- coding: utf-8 -*-
"""
memory.py — Conversation memory API endpoints.

Routes:
  GET  /api/v1/memory/conversations
       ?user_id=<uuid>  (teacher/admin only — list another user's conversations)
       &limit=10
       → list conversations for the current user (students) or filtered user (staff)

  POST /api/v1/memory/conversations
       body: { session_id, user_id? (must match JWT user), exchanges, summary? }
       → save/upsert conversation; returns { id }

  GET  /api/v1/memory/conversations/{session_id}
       → fetch a specific conversation if owned by current user (or staff)

All routes require Bearer authentication.
"""
from __future__ import annotations

import logging
import sys
import os
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.models.db_models import User, UserRole

logger = logging.getLogger(__name__)

# ── Router at /api/v1/memory ──────────────────────────────────────────────────
router = APIRouter(prefix="/api/v1/memory", tags=["Memory"])


# ── Lazy repository loader ────────────────────────────────────────────────────

def _get_repo():
    """Import conversation repo lazily to avoid circular import at startup."""
    _root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
    )
    if _root not in sys.path:
        sys.path.insert(0, _root)
    from repository.conversation_repository import get_conversation_repo  # type: ignore[import]
    return get_conversation_repo()


def _is_staff(user: User) -> bool:
    return user.role in (UserRole.teacher, UserRole.admin)


def _viewer_may_access_conversation(viewer: User, conv: dict[str, Any]) -> bool:
    if _is_staff(viewer):
        return True
    owner = conv.get("user_id")
    if owner is None:
        return False
    return str(owner) == str(viewer.id)


# ── Pydantic request / response models ───────────────────────────────────────

class ExchangeItem(BaseModel):
    role: str        # 'user' | 'assistant'
    text: str
    ts:   int        # Unix ms


class SaveConversationRequest(BaseModel):
    session_id: str  = Field(..., min_length=1, max_length=128)
    user_id:    Optional[str] = None
    exchanges:  list[ExchangeItem] = Field(default_factory=list)
    summary:    Optional[str]  = None


class ConversationResponse(BaseModel):
    id:         str
    session_id: str
    user_id:    Optional[str]
    started_at: Optional[Any] = None
    ended_at:   Optional[Any] = None
    summary:    Optional[str]
    exchanges:  list[dict[str, Any]]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    *,
    current_user: User = Depends(get_current_user),
    user_id: Optional[str] = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    List conversations for the authenticated user.

    Students always see only their own rows; optional ``user_id`` is rejected unless
    it equals their id. Teachers/admins may pass ``user_id`` to list another user.
    """
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be 1–100")

    q = (user_id or "").strip()
    if current_user.role == UserRole.student:
        if q and q != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot list conversations for another user",
            )
        target_user_id = str(current_user.id)
    else:
        target_user_id = q if q else str(current_user.id)

    repo = _get_repo()
    try:
        return repo.get_by_user(target_user_id, limit=limit)
    except Exception as exc:
        logger.error("[memory] list_conversations error: %s", exc)
        raise HTTPException(status_code=503, detail="خدمة الذاكرة غير متاحة مؤقتاً") from exc


@router.post("/conversations", status_code=201)
async def save_conversation(
    body: SaveConversationRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    """
    Save (or upsert) a conversation by session_id for the authenticated user.
    If ``user_id`` is sent in the body it must match the JWT user or the request is rejected.
    """
    if body.user_id is not None and str(body.user_id).strip():
        if str(body.user_id).strip() != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="user_id does not match authenticated user",
            )

    repo = _get_repo()
    exch = [e.model_dump() for e in body.exchanges]
    try:
        conv_id = repo.save(
            session_id=body.session_id,
            user_id=str(current_user.id),
            exchanges=exch,
            summary=body.summary,
        )
        return {"id": conv_id}
    except Exception as exc:
        logger.error("[memory] save_conversation error: %s", exc)
        raise HTTPException(status_code=503, detail="فشل حفظ المحادثة") from exc


@router.get("/conversations/{session_id}", response_model=ConversationResponse)
async def get_conversation(
    session_id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch a conversation by session_id if the caller may access it."""
    repo = _get_repo()
    try:
        conv = repo.get_by_session(session_id)
    except Exception as exc:
        logger.error("[memory] get_conversation error: %s", exc)
        raise HTTPException(status_code=503, detail="خدمة الذاكرة غير متاحة مؤقتاً") from exc

    if conv is None:
        raise HTTPException(status_code=404, detail="المحادثة غير موجودة")
    if not _viewer_may_access_conversation(current_user, conv):
        raise HTTPException(status_code=404, detail="المحادثة غير موجودة")
    return conv
