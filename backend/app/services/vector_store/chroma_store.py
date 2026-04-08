# -*- coding: utf-8 -*-
"""ChromaDB implementation of :class:`VectorStoreInterface` for BTEC corpus."""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, Dict, List, Optional

from app.services.vector_store.base import VectorStoreInterface, metadata_filter_to_chroma_where

logger = logging.getLogger("cogni.vector_store.chroma")

_EMBED_MODEL_DEFAULT = "text-embedding-3-small"


class ChromaBtecVectorStore(VectorStoreInterface):
    """
    Persistent Chroma collection with OpenAI embeddings, metadata filtering, and
    automatic fallback to unfiltered semantic search when filters yield zero hits.
    """

    def __init__(
        self,
        persist_dir: str,
        collection_name: str,
        embed_model: str = _EMBED_MODEL_DEFAULT,
        embedding_fn: Optional[Callable[[str], List[float]]] = None,
    ) -> None:
        self._persist_dir = persist_dir
        self._collection_name = collection_name
        self._embed_model = embed_model
        self._embedding_fn = embedding_fn
        self._client = None
        self._collection = None

    def _ensure_collection(self):
        if self._collection is not None:
            return self._collection
        try:
            import chromadb  # type: ignore
        except ImportError:
            logger.warning("[ChromaStore] chromadb not installed")
            return None
        try:
            if self._client is None:
                self._client = chromadb.PersistentClient(path=self._persist_dir)
            self._collection = self._client.get_collection(name=self._collection_name)
        except Exception as e:
            logger.warning(
                "[ChromaStore] collection %r unavailable: %s",
                self._collection_name,
                e,
            )
            self._collection = None
        return self._collection

    def _embed_query(self, query: str) -> Optional[List[float]]:
        if self._embedding_fn is not None:
            try:
                return self._embedding_fn(query)
            except Exception as e:
                logger.warning("[ChromaStore] custom embedding_fn failed: %s", e)
                return None
        api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if not api_key:
            logger.warning("[ChromaStore] OPENAI_API_KEY missing — skip query embedding")
            return None
        try:
            from openai import OpenAI

            cli = OpenAI(api_key=api_key)
            r = cli.embeddings.create(model=self._embed_model, input=(query or "")[:8000])
            return list(r.data[0].embedding)
        except Exception as e:
            logger.warning("[ChromaStore] embedding failed: %s", e)
            return None

    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        metadata_list: List[Dict[str, Any]],
        ids: Optional[List[str]] = None,
    ) -> None:
        col = self._ensure_collection()
        if col is None:
            raise RuntimeError("Chroma collection not available")
        if len(documents) != len(metadata_list):
            raise ValueError("documents and metadata_list length mismatch")
        if ids is not None and len(ids) != len(documents):
            raise ValueError("ids length mismatch")
        texts: List[str] = []
        precomputed: List[List[float]] = []
        all_have_emb = True
        for d in documents:
            t = d.get("content")
            if not isinstance(t, str):
                raise ValueError("each document dict must have string 'content'")
            texts.append(t)
            emb = d.get("embedding")
            if isinstance(emb, list) and len(emb) > 0:
                precomputed.append([float(x) for x in emb])
            else:
                all_have_emb = False

        final_ids = ids if ids is not None else [f"row_{i}" for i in range(len(texts))]
        kwargs: Dict[str, Any] = {
            "ids": final_ids,
            "documents": texts,
            "metadatas": metadata_list,
        }
        if all_have_emb and len(precomputed) == len(texts):
            kwargs["embeddings"] = precomputed
        col.add(**kwargs)
        logger.info("[ChromaStore] add_documents count=%d collection=%s", len(texts), self._collection_name)

    def similarity_search(
        self,
        query: str,
        k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        *,
        n_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        col = self._ensure_collection()
        if col is None:
            return []
        try:
            n_docs = col.count()
        except Exception as e:
            logger.warning("[ChromaStore] count failed: %s", e)
            return []
        if n_docs == 0:
            logger.warning("[ChromaStore] collection %r is empty", self._collection_name)
            return []

        vec = self._embed_query(query)
        if not vec:
            return []

        fetch_n = n_results if n_results is not None else k
        fetch_n = max(1, min(int(fetch_n), n_docs))
        where_clause = metadata_filter_to_chroma_where(filters)
        used_filter = bool(where_clause)

        def _do_query(where: Optional[dict]) -> Any:
            qkwargs: Dict[str, Any] = {
                "query_embeddings": [vec],
                "n_results": fetch_n,
                "include": ["documents", "metadatas", "distances"],
            }
            if where is not None:
                qkwargs["where"] = where
            return col.query(**qkwargs)

        try:
            res = _do_query(where_clause)
        except Exception as e:
            logger.warning("[ChromaStore] query failed: %s", e, exc_info=True)
            return []

        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]

        if used_filter and not docs:
            logger.info(
                "[ChromaStore] filtered query returned 0 hits (where=%s, fetch_n=%d) — fallback semantic-only",
                where_clause,
                fetch_n,
            )
            try:
                res = _do_query(None)
            except Exception as e:
                logger.warning("[ChromaStore] fallback query failed: %s", e)
                return []
            docs = (res.get("documents") or [[]])[0]
            metas = (res.get("metadatas") or [[]])[0]
            dists = (res.get("distances") or [[]])[0]

        out: List[Dict[str, Any]] = []
        for i, doc in enumerate(docs or []):
            meta = metas[i] if i < len(metas or []) else {}
            row: Dict[str, Any] = {
                "document": doc or "",
                "metadata": meta if isinstance(meta, dict) else {},
            }
            if dists and i < len(dists):
                try:
                    row["distance"] = float(dists[i])
                except (TypeError, ValueError):
                    pass
            out.append(row)

        logger.info(
            "[ChromaStore] similarity_search raw_hits=%d fetch_n=%d metadata_filter_applied=%s",
            len(out),
            fetch_n,
            used_filter,
        )
        return out

    def is_healthy(self) -> bool:
        """True if the collection can be opened (may still have 0 documents)."""
        return self._ensure_collection() is not None

    def count(self) -> int:
        col = self._ensure_collection()
        if col is None:
            return 0
        try:
            return int(col.count())
        except Exception as e:
            logger.warning("[ChromaStore] count: %s", e)
            return 0

    def delete_collection(self) -> None:
        if self._client is None:
            try:
                import chromadb  # type: ignore

                self._client = chromadb.PersistentClient(path=self._persist_dir)
            except Exception as e:
                logger.error("[ChromaStore] cannot open client for delete: %s", e)
                return
        try:
            self._client.delete_collection(name=self._collection_name)
            logger.warning("[ChromaStore] deleted collection %r", self._collection_name)
        except Exception as e:
            logger.warning("[ChromaStore] delete_collection failed: %s", e)
        self._collection = None
