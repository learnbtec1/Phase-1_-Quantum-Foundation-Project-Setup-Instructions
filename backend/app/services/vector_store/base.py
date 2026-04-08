# -*- coding: utf-8 -*-
"""Abstract vector store contract for BTEC RAG (Chroma today, Qdrant later)."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


def metadata_filter_to_chroma_where(filters: Optional[Dict[str, Any]]) -> Optional[dict]:
    """
    Build a ChromaDB ``where`` clause from string metadata filters.
    Accepts dict[str, str] with non-empty values; None / empty dict → no filter.
    """
    if not filters:
        return None
    clauses: List[dict[str, Any]] = []
    for key, val in filters.items():
        v = (str(val) if val is not None else "").strip()
        if not v:
            continue
        clauses.append({key: v})
    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


class VectorStoreInterface(ABC):
    """Pluggable vector backend for curriculum RAG."""

    @abstractmethod
    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        metadata_list: List[Dict[str, Any]],
        ids: Optional[List[str]] = None,
    ) -> None:
        """
        Upsert text chunks. Each entry in ``documents`` must include key ``content`` (str).
        Optional per-document ``embedding`` (list[float]) to skip server-side embedding.
        ``ids`` must match row count when provided.
        """
        raise NotImplementedError

    @abstractmethod
    def similarity_search(
        self,
        query: str,
        k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        *,
        n_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Return hits as dicts: ``document`` (str), ``metadata`` (dict), optional ``distance`` (float).
        Implementations should apply metadata filters when possible and fall back to unfiltered
        semantic search when the filtered query returns no rows (log a warning).
        """
        raise NotImplementedError

    @abstractmethod
    def count(self) -> int:
        """Approximate document count in the collection, or 0 if unavailable."""
        raise NotImplementedError

    @abstractmethod
    def delete_collection(self) -> None:
        """Remove the entire collection/index (destructive; use with care)."""
        raise NotImplementedError
