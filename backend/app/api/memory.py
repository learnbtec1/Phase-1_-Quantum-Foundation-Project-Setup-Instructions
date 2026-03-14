# -*- coding: utf-8 -*-
"""
memory.py — Conversation memory API endpoints.

Routes:
  GET  /api/v1/memory/conversations
       ?user_id=<uuid>&limit=10
       → list conversations for a user (newest first)

  POST /api/v1/memory/conversations
       body: { session_id, user_id?, exchanges, summary? }
       → save/upsert conversation; returns { id }

  GET  /api/v1/memory/conversations/{session_id}
       → fetch a specific conversation by session_id

Feature-gated: USE_DB env-var controls persistence backend.
InMemory fallback guarantees the endpoints are always operational.
"""
from __future__ import annotations

import logging
import sys
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    user_id: Optional[str] = None,
    limit:   int = 10,
) -> list[dict[str, Any]]:
    """
    Return up to `limit` conversations.
    If `user_id` is provided, filters to that user's history.
    Without `user_id`, returns an empty list (no full-table scan for safety).
    """
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be 1–100")

    if not user_id:
        return []

    repo = _get_repo()
    try:
        results = repo.get_by_user(user_id, limit=limit)
        return results
    except Exception as exc:
        logger.error("[memory] list_conversations error: %s", exc)
        raise HTTPException(status_code=503, detail="خدمة الذاكرة غير متاحة مؤقتاً") from exc


@router.post("/conversations", status_code=201)
async def save_conversation(body: SaveConversationRequest) -> dict[str, str]:
    """
    Save (or upsert) a conversation by session_id.
    Returns { "id": "<uuid>" }.
    """
    repo  = _get_repo()
    exch  = [e.model_dump() for e in body.exchanges]
    try:
        conv_id = repo.save(
            session_id=body.session_id,
            user_id=body.user_id,
            exchanges=exch,
            summary=body.summary,
        )
        return {"id": conv_id}
    except Exception as exc:
        logger.error("[memory] save_conversation error: %s", exc)
        raise HTTPException(status_code=503, detail="فشل حفظ المحادثة") from exc


@router.get("/conversations/{session_id}", response_model=ConversationResponse)
async def get_conversation(session_id: str) -> dict[str, Any]:
    """Fetch a specific conversation by session_id."""
    repo = _get_repo()
    try:
        conv = repo.get_by_session(session_id)
    except Exception as exc:
        logger.error("[memory] get_conversation error: %s", exc)
        raise HTTPException(status_code=503, detail="خدمة الذاكرة غير متاحة مؤقتاً") from exc

    if conv is None:
        raise HTTPException(status_code=404, detail="المحادثة غير موجودة")
    return conv
