# -*- coding: utf-8 -*-
"""
Retrieve BTEC curriculum chunks from ChromaDB collection ``btec_knowledge_base``.

Populated by ``backend/scripts/btec_ingest.py``; uses the same persist directory as
``episodic_memory`` and the same embedding model as ingestion (text-embedding-3-small).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

_COLLECTION_NAME = "btec_knowledge_base"
_EMBED_MODEL = "text-embedding-3-small"
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


_chroma_client = None


def _get_chroma_collection():
    """Return the BTEC collection, or None if Chroma / collection is missing."""
    global _chroma_client
    try:
        import chromadb  # type: ignore
    except ImportError:
        logger.warning("[BtecChromaRAG] chromadb not installed")
        return None
    try:
        if _chroma_client is None:
            _chroma_client = chromadb.PersistentClient(path=_DATA_DIR)
        return _chroma_client.get_collection(name=_COLLECTION_NAME)
    except Exception as e:
        logger.warning("[BtecChromaRAG] collection %r unavailable: %s", _COLLECTION_NAME, e)
        return None


def _embed_query_sync(query: str) -> Optional[List[float]]:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        logger.warning("[BtecChromaRAG] OPENAI_API_KEY missing — skip Chroma query")
        return None
    try:
        from openai import OpenAI

        cli = OpenAI(api_key=api_key)
        r = cli.embeddings.create(model=_EMBED_MODEL, input=query[:8000])
        return list(r.data[0].embedding)
    except Exception as e:
        logger.warning("[BtecChromaRAG] embedding failed: %s", e)
        return None


def _format_chroma_results(documents: List[str], metadatas: List[dict]) -> str:
    lines: List[str] = []
    for i, (doc, meta) in enumerate(zip(documents, metadatas), start=1):
        src = ""
        page = ""
        if isinstance(meta, dict):
            src = str(meta.get("source_file") or meta.get("source") or "").strip()
            pn = meta.get("page_number", meta.get("page"))
            if pn is not None:
                page = str(pn).strip()
        head = f"[{i}]"
        if src:
            head += f" source: {src}"
        if page:
            head += f" | page: {page}"
        body = (doc or "").strip()
        if not body:
            continue
        lines.append(f"{head}\n{body}")
    return "\n\n---\n\n".join(lines)


_QUICK_REVIEW_HEADING_RE = re.compile(
    r"(summary|key\s*concept|overview|ملخص|مفهوم\s*رئيسي|المفاهيم\s*الأساسية)",
    re.I,
)


def retrieve_btec_chroma_block_sync(
    query: str,
    *,
    session_id: str = "",
    top_k: int = _DEFAULT_TOP_K,
    use_cache: bool = True,
    quick_review: bool = False,
) -> str:
    """
    Return formatted curriculum text for system prompt, or empty string if none / error.
    """
    nq = _normalize_query(query)
    if len(nq) < 8:
        return ""

    sid = (session_id or "default").strip()[:128]
    _cache_key = f"{nq}\x1fqr={int(bool(quick_review))}"
    if use_cache and sid in _btec_rag_cache:
        cached_q, block = _btec_rag_cache[sid]
        if cached_q == _cache_key and block:
            logger.debug("[BtecChromaRAG] cache hit session=%s", sid[:32])
            return block

    col = _get_chroma_collection()
    if col is None:
        return ""

    try:
        n = col.count()
        if n == 0:
            logger.warning("[BtecChromaRAG] collection %r is empty — run btec_ingest.py", _COLLECTION_NAME)
            return ""
    except Exception as e:
        logger.warning("[BtecChromaRAG] count failed: %s", e)
        return ""

    vec = _embed_query_sync(nq)
    if not vec:
        return ""

    k = max(1, min(int(top_k), 12, n))
    fetch_n = min(n, max(k, k * 4 if quick_review else k, 8 if quick_review else k))
    try:
        res = col.query(
            query_embeddings=[vec],
            n_results=fetch_n,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        logger.warning("[BtecChromaRAG] query failed: %s", e)
        return ""

    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    if not docs:
        logger.warning("[BtecChromaRAG] no documents returned for query (n=%d)", fetch_n)
        return ""

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
        "[BtecChromaRAG] retrieved %d chunk(s) from %s (collection docs≈%s)",
        len(docs),
        _COLLECTION_NAME,
        n,
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
        ),
    )


def btec_chroma_rag_status() -> dict[str, Any]:
    """Lightweight health check for ops / debugging."""
    col = _get_chroma_collection()
    out: dict[str, Any] = {
        "persist_dir": _DATA_DIR,
        "collection": _COLLECTION_NAME,
        "available": col is not None,
        "count": None,
    }
    if col is not None:
        try:
            out["count"] = col.count()
        except Exception as e:
            out["count_error"] = str(e)
    return out
