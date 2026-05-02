# -*- coding: utf-8 -*-
"""
pgvector-backed embedding store. Embeddings: OpenAI official SDK (v1) `embeddings.create` only.
No local / beta embedding endpoints. Dimension fixed to 1536 for text-embedding-3-small.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

import psycopg
from openai import OpenAI
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from app.core.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_DIMS = frozenset({1536})

# In-process cache for *query* embeddings in search() only (reduces OpenAI load & repeated failures).
class _QueryEmbedTTLRU:
    """LRU by access order; each entry has a monotonic expiry (TTL)."""

    def __init__(self, capacity: int, ttl_sec: float) -> None:
        self._od: "OrderedDict[str, Tuple[List[float], float]]" = OrderedDict()
        self._capacity = max(1, int(capacity))
        self._ttl = float(ttl_sec)

    def get(self, key: str) -> Optional[List[float]]:
        now = time.monotonic()
        t = self._od.get(key)
        if not t:
            return None
        vec, exp = t
        if exp < now:
            del self._od[key]
            return None
        self._od.move_to_end(key)
        return vec

    def set(self, key: str, vec: List[float]) -> None:
        now = time.monotonic()
        self._od[key] = (vec, now + self._ttl)
        self._od.move_to_end(key)
        while len(self._od) > self._capacity:
            self._od.popitem(last=False)


_query_embed_lru: Optional[_QueryEmbedTTLRU] = None
_query_embed_lru_sig: Optional[Tuple[int, int]] = None  # (capacity, ttl_ms)


def _get_query_embed_lru() -> _QueryEmbedTTLRU:
    """Build or rebuild LRU when settings capacity/TTL change (avoids import-order issues)."""
    global _query_embed_lru, _query_embed_lru_sig
    try:
        cap = int(getattr(settings, "ASSESSMENT_QUERY_EMBED_CACHE_MAX_ENTRIES", 500) or 500)
    except (TypeError, ValueError):
        cap = 500
    try:
        ttl = float(getattr(settings, "ASSESSMENT_QUERY_EMBED_CACHE_TTL_SECONDS", 3600.0) or 3600.0)
    except (TypeError, ValueError):
        ttl = 3600.0
    cap = max(1, min(cap, 10_000))
    sig = (cap, int(ttl * 1000.0))
    if _query_embed_lru is None or _query_embed_lru_sig != sig:
        _query_embed_lru = _QueryEmbedTTLRU(cap, ttl)
        _query_embed_lru_sig = sig
    return _query_embed_lru


def _require_postgres_url(url: str) -> None:
    if not url or not str(url).startswith(("postgresql://", "postgres://")):
        raise RuntimeError("VectorService requires a PostgreSQL DATABASE_URL (pgvector). SQLite is not supported.")


@contextmanager
def pg_connection_with_vector(dsn: Optional[str] = None) -> Iterator[psycopg.Connection]:
    """
    Single entry point: connect, CREATE EXTENSION vector + commit, then register_vector, then yield.
    Use for any code path that needs pgvector types on the connection (embedding_chunks, rag_documents).
    """
    url = (dsn or settings.DATABASE_URL) or ""
    _require_postgres_url(url)
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        conn.commit()
        register_vector(conn)
        yield conn


def _validate_dim(dim: int) -> int:
    if dim not in _ALLOWED_DIMS:
        raise ValueError(f"EMBEDDING_DIMENSIONS must be 1536 for this project; got {dim}")
    return dim


def chunk_text(text: str, max_chars: int, overlap: int) -> List[str]:
    t = (text or "").strip()
    if not t:
        return []
    max_chars = max(200, int(max_chars))
    overlap = max(0, min(int(overlap), max_chars // 2))
    if len(t) <= max_chars:
        return [t]
    chunks: List[str] = []
    start = 0
    while start < len(t):
        end = min(start + max_chars, len(t))
        chunk = t[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(t):
            break
        start = end - overlap
    return chunks


@dataclass
class SearchHit:
    id: int
    content: str
    metadata: Dict[str, Any]
    source_id: Optional[str]
    distance: float
    similarity: float


def embed_batch_openai_v1(
    client: OpenAI,
    model: str,
    texts: Sequence[str],
    dimensions: int,
) -> List[List[float]]:
    """
    Batch embedding via the stable OpenAI API surface (`client.embeddings.create`).
    Not the deprecated beta embeddings API.
    """
    clean = [re.sub(r"\s+", " ", (t or "").strip()) for t in texts]
    if not any(clean):
        return []
    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("EMBEDDING_ERROR: OPENAI_API_KEY is required for embeddings")
    out: List[List[float]] = []
    batch_size = 100
    timeout = float(settings.OPENAI_EMBED_TIMEOUT_SECONDS)
    for i in range(0, len(clean), batch_size):
        batch = clean[i : i + batch_size]
        kwargs: Dict[str, Any] = {"model": model, "input": batch}
        if str(model).startswith("text-embedding-3"):
            kwargs["dimensions"] = int(dimensions)

        def _create() -> Any:
            return client.embeddings.create(**kwargs)

        try:
            with ThreadPoolExecutor(max_workers=1) as ex:
                fut = ex.submit(_create)
                try:
                    resp = fut.result(timeout=timeout)
                except FutureTimeout as e:
                    raise RuntimeError(
                        f"EMBEDDING_ERROR: embedding call timed out after {timeout}s"
                    ) from e
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"EMBEDDING_ERROR: {e!s}") from e
        out.extend(list(d.embedding) for d in resp.data)
    for vec in out:
        if len(vec) != dimensions:
            raise RuntimeError(
                f"EMBEDDING_ERROR: length {len(vec)} != expected {dimensions} (check model and EMBEDDING_DIMENSIONS)"
            )
    return out


class VectorService:
    """Ingest: embed + insert. Search: embed query + ORDER BY embedding <=> query_vector (cosine)."""

    def __init__(self) -> None:
        self._model_name = settings.resolved_openai_embedding_model()
        self._dim = _validate_dim(int(settings.EMBEDDING_DIMENSIONS))
        self._max_ingest = int(settings.VECTOR_INGEST_MAX_CHARS)
        self._chunk_chars = int(settings.VECTOR_CHUNK_CHARS)
        self._chunk_overlap = int(settings.VECTOR_CHUNK_OVERLAP)
        self._openai: Optional[OpenAI] = None

    def _query_cache_key(self, q: str) -> str:
        return hashlib.sha256(
            f"{self._model_name}\n{self._dim}\n{q}".encode("utf-8"),
        ).hexdigest()

    @property
    def openai(self) -> OpenAI:
        if self._openai is None:
            self._openai = OpenAI(api_key=settings.OPENAI_API_KEY)
        return self._openai

    @contextmanager
    def _conn(self) -> Iterator[psycopg.Connection]:
        with pg_connection_with_vector() as conn:
            yield conn

    def count_chunks(self) -> int:
        """Number of rows in `embedding_chunks` (for health checks and empty-corpus detection)."""
        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*)::bigint FROM embedding_chunks")
                    row = cur.fetchone()
                    if not row or row[0] is None:
                        return 0
                    return int(row[0])
        except Exception as e:
            logger.warning("count_chunks failed: %s", e)
            return 0

    def ensure_schema(self) -> None:
        """Create `embedding_chunks` with `vector(1536)` + indexes."""
        dim = self._dim
        ddl_table = f"""
        CREATE TABLE IF NOT EXISTS embedding_chunks (
            id           BIGSERIAL PRIMARY KEY,
            content      TEXT        NOT NULL,
            source_id    TEXT,
            metadata     JSONB       NOT NULL DEFAULT '{{}}'::jsonb,
            embedding    vector({dim}) NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
        ddl_meta_idx = """
        CREATE INDEX IF NOT EXISTS embedding_chunks_metadata_gin_idx
            ON embedding_chunks USING gin (metadata jsonb_path_ops);
        """
        ddl_hnsw = f"""
        CREATE INDEX IF NOT EXISTS embedding_chunks_embedding_hnsw_idx
            ON embedding_chunks USING hnsw (embedding vector_cosine_ops);
        """
        with self._conn() as conn:
            # vector extension: ensured in _conn() before register_vector
            conn.execute(ddl_table)
            conn.execute(ddl_meta_idx)
            try:
                conn.execute(ddl_hnsw)
            except Exception as e:
                logger.warning("HNSW index create skipped or failed: %s", e)
            conn.commit()

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:
        return embed_batch_openai_v1(
            self.openai,
            self._model_name,
            texts,
            self._dim,
        )

    def ingest(
        self,
        text: str,
        *,
        metadata: Optional[Dict[str, Any]] = None,
        source_id: Optional[str] = None,
        chunk: bool = True,
    ) -> List[int]:
        if len(text) > self._max_ingest:
            raise ValueError(f"Text exceeds VECTOR_INGEST_MAX_CHARS ({self._max_ingest})")
        pieces = (
            chunk_text(text, self._chunk_chars, self._chunk_overlap) if chunk else [text.strip()]
        )
        pieces = [p for p in pieces if p and p.strip()]
        if not pieces:
            return []
        vectors = self.embed_batch(pieces)
        if len(vectors) != len(pieces):
            raise RuntimeError("embed_batch size mismatch")
        meta = metadata or {}
        ids: List[int] = []
        with self._conn() as conn:
            with conn.cursor() as cur:
                for content, vec in zip(pieces, vectors):
                    cur.execute(
                        """
                        INSERT INTO embedding_chunks (content, source_id, metadata, embedding)
                        VALUES (%s, %s, %s::jsonb, %s)
                        RETURNING id
                        """,
                        (content, source_id, json.dumps(meta), vec),
                    )
                    row = cur.fetchone()
                    if row:
                        ids.append(int(row[0]))
            conn.commit()
        return ids

    def ingest_chunks(
        self,
        pieces: Sequence[str],
        *,
        metadata: Optional[Dict[str, Any]] = None,
        source_id: Optional[str] = None,
    ) -> List[int]:
        raw = [(p or "").strip() for p in pieces]
        too_long = [i for i, p in enumerate(raw) if len(p) > self._max_ingest]
        if too_long:
            raise ValueError(
                f"{len(too_long)} chunk(s) exceed VECTOR_INGEST_MAX_CHARS ({self._max_ingest})"
            )
        cleaned = [p for p in raw if p]
        if not cleaned:
            return []
        vectors = self.embed_batch(cleaned)
        if len(vectors) != len(cleaned):
            raise RuntimeError("embed_batch size mismatch")
        meta = metadata or {}
        ids: List[int] = []
        with self._conn() as conn:
            with conn.cursor() as cur:
                for content, vec in zip(cleaned, vectors):
                    cur.execute(
                        """
                        INSERT INTO embedding_chunks (content, source_id, metadata, embedding)
                        VALUES (%s, %s, %s::jsonb, %s)
                        RETURNING id
                        """,
                        (content, source_id, json.dumps(meta), vec),
                    )
                    row = cur.fetchone()
                    if row:
                        ids.append(int(row[0]))
            conn.commit()
        return ids

    def search(
        self,
        query: str,
        *,
        top_k: int = 8,
        max_distance: Optional[float] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
    ) -> List[SearchHit]:
        q = (query or "").strip()
        if not q:
            return []
        top_k = max(1, min(int(top_k), 100))
        ck = self._query_cache_key(q)
        lru = _get_query_embed_lru()
        qvec: Optional[List[float]] = lru.get(ck)
        if qvec is None:
            logger.info("EMBED CACHE MISS")
            vecs = self.embed_batch([q])
            if not vecs:
                raise RuntimeError("EMBEDDING_ERROR: empty embedding for non-empty query")
            qvec = vecs[0]
            lru.set(ck, qvec)
        else:
            logger.info("EMBED CACHE HIT")
        sql = """
            SELECT id, content, metadata, source_id,
                   (embedding <=> %(qv)s::vector) AS distance
            FROM embedding_chunks
        """
        params: Dict[str, Any] = {"qv": qvec, "lim": top_k}
        if metadata_filter:
            sql += " WHERE metadata @> %(mf)s::jsonb"
            params["mf"] = json.dumps(metadata_filter)
        sql += " ORDER BY embedding <=> %(qv)s::vector LIMIT %(lim)s"
        hits: List[SearchHit] = []
        try:
            with self._conn() as conn:
                with conn.cursor(row_factory=dict_row) as cur:
                    cur.execute(sql, params)
                    for row in cur.fetchall():
                        dist = float(row["distance"])
                        sim = max(0.0, min(1.0, 1.0 - dist))
                        if max_distance is not None and dist > float(max_distance):
                            continue
                        hits.append(
                            SearchHit(
                                id=int(row["id"]),
                                content=str(row["content"]),
                                metadata=dict(row["metadata"] or {}),
                                source_id=row.get("source_id"),
                                distance=dist,
                                similarity=sim,
                            )
                        )
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"DB_VECTOR_ERROR: {e!s}") from e
        return hits

    def delete_by_source_id(self, source_id: str) -> int:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM embedding_chunks WHERE source_id = %s",
                    (source_id,),
                )
                n = cur.rowcount or 0
            conn.commit()
        return int(n)


def get_vector_service() -> VectorService:
    return VectorService()
