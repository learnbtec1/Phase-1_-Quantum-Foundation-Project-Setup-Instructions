# -*- coding: utf-8 -*-
"""POST /api/v1/rag/query — assignment RAG (authenticated)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.models.db_models import User
from app.services.rag_service import query_assignments_rag

router = APIRouter(prefix="/rag", tags=["RAG"])


class RagRequest(BaseModel):
    query: str = Field(..., min_length=1)
    scope: str = Field(default="assignments")
    course: str | None = None


@router.post("/query")
async def rag_query(payload: RagRequest, user: User = Depends(get_current_user)):
    _ = user  # auth required
    results = query_assignments_rag(
        payload.query,
        scope=payload.scope,
        course=payload.course,
    )
    return {"results": results}
