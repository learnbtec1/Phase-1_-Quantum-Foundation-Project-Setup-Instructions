# -*- coding: utf-8 -*-
"""
Long-term episodic memory for Cogni — vector retrieval (ChromaDB) with in-memory fallback.

Stores short turn summaries per ``session_id`` scope (caller supplies id: e.g. WS uses a stable
user id when persistence is allowed, or ``http_chat:<client_id>`` for REST). Injects snippets into the tutor prompt.
If ChromaDB is unavailable, uses a simple per-session list (keyword overlap).
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid

logger = logging.getLogger(__name__)

_MAX_DOCS_PER_SESSION = int(os.getenv("COGNI_EPISODIC_MAX_DOCS", "80"))
_MAX_PROMPT_CHARS = int(os.getenv("COGNI_EPISODIC_PROMPT_CHAR_BUDGET", "2400"))
_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "chroma_cogni")
os.makedirs(_DATA_DIR, exist_ok=True)

_chroma_client = None
_chroma_ok = False

try:
    import chromadb  # type: ignore
    _chroma_client = chromadb.PersistentClient(path=_DATA_DIR)
    _chroma_ok = True
    logger.info("[EpisodicMemory] ChromaDB persistent store at %s", _DATA_DIR)
except Exception as e:
    logger.warning("[EpisodicMemory] ChromaDB unavailable (%s) — using in-memory fallback", e)


def _safe_collection_name(session_id: str) -> str:
    h = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:24]
    return f"cogni_{h}"


def _fallback_store() -> dict:
    if not hasattr(_fallback_store, "_d"):
        _fallback_store._d = {}  # type: ignore[attr-defined]
    return _fallback_store._d  # type: ignore[attr-defined]


def add_episode(
    session_id: str,
    user_snippet: str,
    assistant_snippet: str,
    emotion: str = "neutral",
    *,
    user_mood: str | None = None,
) -> None:
    """Record one dialogue turn (short strings).

    ``emotion`` = tag on the **avatar** reply (TTS / [EMOTION: …]).
    ``user_mood`` = inferred / SER mood of the **student** when available.
    """
    um = (user_mood or "neutral").strip() or "neutral"
    text = (
        f"User: {user_snippet[:400]}\n"
        f"Assistant: {assistant_snippet[:400]}\n"
        f"Avatar reply emotion: {emotion}\n"
        f"User mood (inferred): {um}"
    )
    if _chroma_ok and _chroma_client is not None:
        try:
            col = _chroma_client.get_or_create_collection(
                name=_safe_collection_name(session_id),
                metadata={"session": session_id[:200]},
            )
            uid = str(uuid.uuid4())
            col.add(
                ids=[uid],
                documents=[text],
                metadatas=[{"avatar_emotion": emotion, "user_mood": um}],
            )
            # Trim oldest if huge (best-effort)
            try:
                n = col.count()
                if n > _MAX_DOCS_PER_SESSION:
                    all_ids = col.get(include=[])["ids"]
                    excess = max(0, n - _MAX_DOCS_PER_SESSION)
                    drop = all_ids[: excess + 5]
                    if drop:
                        col.delete(ids=drop)
            except Exception:
                pass
            return
        except Exception as e:
            logger.debug("[EpisodicMemory] Chroma add failed: %s", e)

    fb = _fallback_store().setdefault(session_id, [])
    fb.append(text)
    if len(fb) > _MAX_DOCS_PER_SESSION:
        del fb[: len(fb) - _MAX_DOCS_PER_SESSION]


def _token_overlap(query: str, doc: str) -> float:
    q = set(re.findall(r"[\w\u0600-\u06FF]{3,}", query.lower()))
    d = set(re.findall(r"[\w\u0600-\u06FF]{3,}", doc.lower()))
    if not q:
        return 0.0
    return len(q & d) / len(q)


def retrieve_for_prompt(session_id: str, query: str, k: int = 4) -> str:
    """
    Return a compact block for the system prompt (Arabic-friendly).
    Empty string if nothing relevant.
    """
    query = (query or "").strip()
    if not query:
        return ""

    if _chroma_ok and _chroma_client is not None:
        try:
            col = _chroma_client.get_or_create_collection(name=_safe_collection_name(session_id))
            if col.count() == 0:
                return ""
            res = col.query(query_texts=[query], n_results=min(k, max(1, col.count())))
            docs = (res.get("documents") or [[]])[0]
            if not docs:
                return ""
            lines = []
            for i, d in enumerate(docs[:k], 1):
                lines.append(f"{i}. {d[:500]}")
            block = "\n".join(lines)
            if len(block) > _MAX_PROMPT_CHARS:
                block = block[: _MAX_PROMPT_CHARS] + "\n…"
            return block
        except Exception as e:
            logger.debug("[EpisodicMemory] Chroma query failed: %s", e)

    fb = _fallback_store().get(session_id) or []
    if not fb:
        return ""
    scored = sorted((( _token_overlap(query, d), d) for d in fb), reverse=True)[:k]
    lines = [
        f"{i+1}. {d[:500]}"
        for i, (ov, d) in enumerate(scored)
        if ov > 0.05 or i < 2
    ]
    if not lines and fb:
        lines = [fb[-1][:600]]
    block_fb = "\n".join(lines)
    if len(block_fb) > _MAX_PROMPT_CHARS:
        block_fb = block_fb[: _MAX_PROMPT_CHARS] + "\n…"
    return block_fb
