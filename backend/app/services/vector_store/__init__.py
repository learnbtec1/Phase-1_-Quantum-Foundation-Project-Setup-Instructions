# -*- coding: utf-8 -*-
"""Vector store backends for BTEC RAG (Chroma default; Qdrant falls back to Chroma)."""
from __future__ import annotations

import logging
import os
from typing import Optional

from app.services.vector_store.base import VectorStoreInterface, metadata_filter_to_chroma_where
from app.services.vector_store.chroma_store import ChromaBtecVectorStore
from app.services.vector_store.qdrant_store import QdrantBtecVectorStore

logger = logging.getLogger("cogni.vector_store")

_BTEC_COLLECTION = "btec_knowledge_base"
_BTEC_PERSIST_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "chroma_cogni"
)
_EMBED_MODEL = "text-embedding-3-small"

_btec_store_singleton: Optional[VectorStoreInterface] = None


def get_btec_vector_store(*, force_refresh: bool = False) -> VectorStoreInterface:
    """
    Singleton accessor for the BTEC curriculum vector backend.
    ``VECTOR_STORE_TYPE``: ``chromadb`` (default) or ``chroma``. ``qdrant`` is not implemented and falls back here.
    """
    global _btec_store_singleton
    if force_refresh:
        _btec_store_singleton = None
    if _btec_store_singleton is not None:
        return _btec_store_singleton

    vt = (os.getenv("VECTOR_STORE_TYPE") or "chromadb").strip().lower()
    if vt not in ("chromadb", "chroma", ""):
        if vt == "qdrant":
            logger.error(
                "VECTOR_STORE_TYPE=qdrant is not implemented (no qdrant-client wiring). "
                "Falling back to chromadb — set VECTOR_STORE_TYPE=chromadb to silence this.",
            )
        else:
            logger.warning("Unknown VECTOR_STORE_TYPE=%r — falling back to chromadb", vt)
    persist = os.path.abspath(_BTEC_PERSIST_DIR)
    _btec_store_singleton = ChromaBtecVectorStore(
        persist_dir=persist,
        collection_name=_BTEC_COLLECTION,
        embed_model=_EMBED_MODEL,
    )
    logger.debug("BTEC vector store: chromadb persist=%s collection=%s", persist, _BTEC_COLLECTION)

    return _btec_store_singleton


__all__ = [
    "VectorStoreInterface",
    "ChromaBtecVectorStore",
    "QdrantBtecVectorStore",
    "get_btec_vector_store",
    "metadata_filter_to_chroma_where",
]
