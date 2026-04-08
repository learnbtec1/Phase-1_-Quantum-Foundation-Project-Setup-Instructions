# -*- coding: utf-8 -*-
"""
Retrieve BTEC curriculum chunks from the configured vector store (ChromaDB by default).

Populated by ``backend/scripts/btec_ingest.py``; uses the same persist directory as
``episodic_memory`` and the same embedding model as ingestion (text-embedding-3-small).

Switch backend with env ``VECTOR_STORE_TYPE=chromadb|qdrant`` (Qdrant is stub-only until implemented).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from app.services.vector_store import get_btec_vector_store, metadata_filter_to_chroma_where
from app.services.vector_store.chroma_store import ChromaBtecVectorStore
from app.services.vector_store.qdrant_store import QdrantBtecVectorStore

logger = logging.getLogger(__name__)

_COLLECTION_NAME = "btec_knowledge_base"
_DEFAULT_TOP_K = 4
_MAX_QUERY_CHARS = 8000

# Same path as app.services.episodic_memory._DATA_DIR
_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "chroma_cogni")

# session_id -> (normalized_query, formatted_block) — avoids duplicate embed calls same turn
_btec_rag_cache: dict[str, tuple[str, str]] = {}
_CACHE_MAX_SESSIONS = 512


def _normalize_query(q: str) -> str:
    t = (q or "").strip()
    if "[SYSTEM_EVENT:" in t:
        t = re.sub(r"\[SYSTEM_EVENT:[^\]]*\]", "", t, flags=re.I).strip()
    return t[:_MAX_QUERY_CHARS]


def _format_chroma_results(documents: List[str], metadatas: List[dict]) -> str:
    lines: List[str] = []
    for i, (doc, meta) in enumerate(zip(documents, metadatas), start=1):
        src = ""
        page = ""
        crit = ""
        if isinstance(meta, dict):
            src = str(meta.get("source_file") or meta.get("source") or "").strip()
            pn = meta.get("page_number", meta.get("page"))
            if pn is not None:
                page = str(pn).strip()
            crit = str(meta.get("criterion_code") or "").strip()
        head = f"[{i}]"
        if src:
            head += f" source: {src}"
        if page:
            head += f" | page: {page}"
        if crit:
            head += f" | criterion: {crit}"
        body = (doc or "").strip()
        if not body:
            continue
        lines.append(f"{head}\n{body}")
    return "\n\n---\n\n".join(lines)


_QUICK_REVIEW_HEADING_RE = re.compile(
    r"(summary|key\s*concept|overview|ملخص|مفهوم\s*رئيسي|المفاهيم\s*الأساسية)",
    re.I,
)

# BTEC criterion markers in text or filenames: P1, M2, D3, A.P1, 1.M2 (keep in sync with btec_ingest.py)
BTEC_CRITERION_CODE_RE = re.compile(
    r"\b(?:[A-Za-z]\.|[0-9]\.)?([PpMmDd])(\d{1,2})\b",
)


def extract_btec_chroma_filters_from_context(
    message: str,
    context: Optional[dict] = None,
) -> Dict[str, str]:
    """
    Build optional metadata filter fields from user text and tutor context (deep_link unit, focus).
    Returns only non-empty string values. Empty dict means no metadata filter (semantic-only).
    """
    context = context or {}
    parts: List[str] = []
    if message and str(message).strip():
        parts.append(str(message).strip())
    fs = context.get("focus_subject")
    if fs and str(fs).strip():
        parts.append(str(fs).strip())
    dl = context.get("deep_link")
    if isinstance(dl, dict):
        du = str(dl.get("unit") or "").strip()
        if du:
            parts.append(du)
    blob = "\n".join(parts)

    out: Dict[str, str] = {}
    if isinstance(dl, dict):
        u = str(dl.get("unit") or "").strip()
        if u:
            um = re.search(r"(\d+)", u)
            if um:
                out["unit_id"] = f"unit_{um.group(1)}"

    cm = BTEC_CRITERION_CODE_RE.search(blob)
    if cm:
        pm = cm.group(1).upper()
        out["criterion_code"] = f"{pm}{cm.group(2)}"
    return out


def _filters_cache_key(filters: Optional[dict[str, str]]) -> str:
    if not filters:
        return ""
    items = sorted((k, str(v).strip()) for k, v in filters.items() if str(v).strip())
    if not items:
        return ""
    return json.dumps(items, ensure_ascii=True)


def _chroma_where_clause(filters: Optional[dict[str, str]]) -> Optional[dict[str, Any]]:
    """Backward-compatible name; delegates to shared helper."""
    if not filters:
        return None
    return metadata_filter_to_chroma_where({k: str(v) for k, v in filters.items()})


def retrieve_btec_chroma_block_sync(
    query: str,
    *,
    session_id: str = "",
    top_k: int = _DEFAULT_TOP_K,
    use_cache: bool = True,
    quick_review: bool = False,
    filters: Optional[dict[str, str]] = None,
) -> str:
    """
    Return formatted curriculum text for system prompt, or empty string if none / error.

    Optional ``filters`` (e.g. ``{"criterion_code": "P1", "unit_id": "unit_4"}``) are passed to the
    vector store. Chroma applies ``where`` metadata filters with semantic fallback when 0 hits.
    """
    nq = _normalize_query(query)
    if len(nq) < 8:
        return ""

    sid = (session_id or "default").strip()[:128]
    fk = _filters_cache_key(filters)
    _cache_key = f"{nq}\x1fqr={int(bool(quick_review))}\x1ff={fk}"
    if use_cache and sid in _btec_rag_cache:
        cached_q, block = _btec_rag_cache[sid]
        if cached_q == _cache_key and block:
            logger.debug("[BtecChromaRAG] cache hit session=%s", sid[:32])
            return block

    store = get_btec_vector_store()
    try:
        n = store.count()
    except Exception as e:
        logger.warning("[BtecChromaRAG] count failed: %s", e)
        return ""

    if n == 0:
        if isinstance(store, QdrantBtecVectorStore):
            logger.warning("[BtecChromaRAG] Qdrant stub active — no corpus; use VECTOR_STORE_TYPE=chromadb")
        else:
            logger.warning("[BtecChromaRAG] collection %r is empty — run btec_ingest.py", _COLLECTION_NAME)
        return ""

    k = max(1, min(int(top_k), 12, n))
    fetch_n = min(n, max(k, k * 4 if quick_review else k, 8 if quick_review else k))
    where_clause = _chroma_where_clause(filters)
    used_filter = bool(where_clause)

    if isinstance(store, QdrantBtecVectorStore):
        rows: List[Dict[str, Any]] = []
    else:
        rows = store.similarity_search(
            nq,
            k=k,
            filters=filters,
            n_results=fetch_n,
        )

    docs = [str(r.get("document") or "") for r in rows]
    metas = [r.get("metadata") if isinstance(r.get("metadata"), dict) else {} for r in rows]

    if not docs:
        logger.warning("[BtecChromaRAG] no documents returned for query (n=%d)", fetch_n)
        return ""

    raw_count = len(docs)

    if quick_review:
        pairs = list(zip(docs, metas if metas else [{}] * len(docs)))
        pref = [(d, m) for d, m in pairs if _QUICK_REVIEW_HEADING_RE.search((d or "")[:900])]
        if len(pref) >= k:
            sel = pref[:k]
        elif pref:
            rest = [p for p in pairs if p not in pref]
            sel = pref + rest[: max(0, k - len(pref))]
        else:
            sel = pairs[:k]
        docs = [p[0] for p in sel]
        metas = [p[1] if isinstance(p[1], dict) else {} for p in sel]
    else:
        docs = docs[:k]
        metas = (metas or [])[:k]

    formatted = _format_chroma_results(docs, metas if metas else [{}] * len(docs))
    if not formatted.strip():
        return ""

    logger.info(
        "[BtecChromaRAG] retrieved %d chunk(s) from %s (collection docs≈%s, metadata_filter=%s, raw_before_trim=%d)",
        len(docs),
        _COLLECTION_NAME,
        n,
        where_clause if used_filter else None,
        raw_count,
    )

    if use_cache:
        if len(_btec_rag_cache) >= _CACHE_MAX_SESSIONS:
            _btec_rag_cache.clear()
        _btec_rag_cache[sid] = (_cache_key, formatted)

    return formatted


async def retrieve_btec_chroma_block(
    query: str,
    *,
    session_id: str = "",
    top_k: int = _DEFAULT_TOP_K,
    use_cache: bool = True,
    quick_review: bool = False,
    filters: Optional[dict[str, str]] = None,
) -> str:
    """Async wrapper — runs sync retrieval in the default executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: retrieve_btec_chroma_block_sync(
            query,
            session_id=session_id,
            top_k=top_k,
            use_cache=use_cache,
            quick_review=quick_review,
            filters=filters,
        ),
    )


def btec_chroma_rag_status() -> dict[str, Any]:
    """Lightweight health check for ops / debugging."""
    vt = (os.getenv("VECTOR_STORE_TYPE") or "chromadb").strip().lower()
    store = get_btec_vector_store()
    out: dict[str, Any] = {
        "vector_store_type": vt,
        "persist_dir": os.path.abspath(_DATA_DIR),
        "collection": _COLLECTION_NAME,
        "available": False,
        "count": None,
    }
    if isinstance(store, ChromaBtecVectorStore):
        out["available"] = store.is_healthy()
        try:
            out["count"] = store.count()
        except Exception as e:
            out["count_error"] = str(e)
    else:
        out["available"] = False
        out["count"] = store.count()
        out["note"] = "qdrant stub — no local Chroma corpus attached to this backend"
    return out
