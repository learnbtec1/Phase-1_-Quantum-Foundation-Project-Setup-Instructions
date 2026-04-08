# -*- coding: utf-8 -*-
"""
Qdrant backend placeholder — not wired in requirements.txt yet.

When migrating:
  1. Add ``qdrant-client`` and configure QDRANT_URL + QDRANT_API_KEY (or local binary).
  2. Create a collection with the same vector size as the embedding model (e.g. 1536 for text-embedding-3-small).
  3. Map ``metadata_filter_to_chroma_where``-style filters to Qdrant ``Filter`` / ``FieldCondition``.
  4. Implement ``add_documents`` via ``upsert``; ``similarity_search`` via ``query_points`` / ``search``.
  5. Set ``VECTOR_STORE_TYPE=qdrant`` after validation.

Do not import qdrant_client here until the dependency is added.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.services.vector_store.base import VectorStoreInterface

logger = logging.getLogger("cogni.vector_store.qdrant")


class QdrantBtecVectorStore(VectorStoreInterface):
    """Stub store: logs and returns empty results until Qdrant is implemented."""

    def __init__(self, **kwargs: Any) -> None:
        self._kwargs = kwargs
        logger.warning(
            "QdrantBtecVectorStore is a stub — set VECTOR_STORE_TYPE=chromadb for real RAG, "
            "or finish implementing this class and add qdrant-client."
        )

    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        metadata_list: List[Dict[str, Any]],
        ids: Optional[List[str]] = None,
    ) -> None:
        logger.debug(
            "Qdrant add_documents skipped (stub) would add %d rows",
            len(documents),
        )

    def similarity_search(
        self,
        query: str,
        k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        *,
        n_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        # TODO: embed query → client.search(collection_name, query_vector, limit=..., query_filter=...)
        logger.debug(
            "Qdrant similarity_search stub k=%s n_results=%s filters=%s",
            k,
            n_results,
            bool(filters),
        )
        return []

    def count(self) -> int:
        return 0

    def delete_collection(self) -> None:
        logger.warning("Qdrant delete_collection (stub) — no-op")
