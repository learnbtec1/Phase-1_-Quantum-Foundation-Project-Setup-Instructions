# -*- coding: utf-8 -*-
"""
Assignment-scoped RAG (Chroma when available; deterministic fallback list).
"""
from __future__ import annotations

import logging
import re
from typing import List

from app.services.btec_chroma_rag import retrieve_btec_chroma_block_sync

logger = logging.getLogger(__name__)

_STATIC_ASSIGNMENT_SECTIONS: List[str] = [
    "Executive Summary",
    "Market Analysis",
    "Target Audience",
    "Marketing Strategy",
    "Budget Planning",
]


def _split_block_to_results(block: str) -> List[str]:
    if not block or not block.strip():
        return []
    parts = re.split(r"\n---\n|\n\n", block)
    out: List[str] = []
    for p in parts:
        t = (p or "").strip()
        if not t:
            continue
        first_line = t.split("\n", 1)[0].strip()
        if len(first_line) > 240:
            first_line = first_line[:237] + "…"
        out.append(first_line if first_line else t[:240])
    return out[:12]


def query_assignments_rag(
    query: str,
    *,
    scope: str = "assignments",
    course: str | None = None,
) -> List[str]:
    """
    Return short result lines for UI/TTS. Uses BTEC Chroma when populated; else static list.
    """
    nq = (query or "").strip()
    if len(nq) < 4:
        nq = "marketing plan assignment criteria BTEC"
    if scope:
        nq = f"{nq} {scope}".strip()
    if course:
        nq = f"{nq} {course}".strip()

    try:
        block = retrieve_btec_chroma_block_sync(
            nq,
            session_id="rag_assignments_api",
            top_k=6,
            use_cache=True,
        )
        results = _split_block_to_results(block)
        if results:
            return results
    except Exception as e:
        logger.warning("[rag_service] Chroma retrieval failed: %s", e)

    return list(_STATIC_ASSIGNMENT_SECTIONS)
