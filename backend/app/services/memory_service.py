# -*- coding: utf-8 -*-
# app/services/memory_service.py
"""
Optional long-term knowledge store using ChromaDB + OpenAI embeddings.
This service is NOT imported on startup — it is opt-in.
Install: pip install chromadb
"""
from __future__ import annotations

import time
import logging

logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


class MemoryService:
    """Vector-based knowledge store backed by ChromaDB."""

    def __init__(self, collection_name: str = "dr_hamza_knowledge"):
        try:
            from chromadb import PersistentClient
            import openai as _openai  # noqa: F401 — presence check
        except ImportError as exc:
            raise RuntimeError(
                "MemoryService requires chromadb: pip install chromadb"
            ) from exc

        from chromadb import PersistentClient

        self._openai_module = None  # lazy import in methods
        self.client = PersistentClient(path="./chroma_db")
        self.collection = self.client.get_or_create_collection(name=collection_name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_openai(self):
        if self._openai_module is None:
            import openai
            self._openai_module = openai
        return self._openai_module

    async def _embed(self, text: str) -> list:
        openai = self._get_openai()
        response = openai.embeddings.create(
            input=text,
            model="text-embedding-3-small",
        )
        return response.data[0].embedding

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def add_knowledge(self, text: str, metadata: dict | None = None) -> None:
        """Embed *text* and store it in the collection."""
        vector = await self._embed(text)
        self.collection.add(
            ids=[f"id_{_now_ms()}"],
            embeddings=[vector],
            documents=[text],
            metadatas=[metadata or {}],
        )
        logger.debug("MemoryService: added document (%d chars)", len(text))

    async def query_knowledge(self, user_query: str, n_results: int = 3) -> str:
        """Return the most relevant stored documents as a joined string."""
        query_vector = await self._embed(user_query)
        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=n_results,
        )
        documents: list[str] = results.get("documents", [[]])[0]
        return "\n".join(documents)
