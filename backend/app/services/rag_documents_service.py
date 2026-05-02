# -*- coding: utf-8 -*-
"""
Metadata-column RAG: `rag_documents` (grade, term, subject, unit, source) + pgvector.
Filter by metadata in SQL, then ORDER BY embedding <=> query (cosine distance).
Complements `embedding_chunks` (JSONB); used first when academic context is present.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from openai import OpenAI
from psycopg.rows import dict_row

from app.core.config import settings
from app.services.academic_rag_context import (
    infer_grade_tier,
    infer_subject_key,
    normalize_academic_context,
    normalize_term,
)
from app.services.vector_service import (
    SearchHit,
    _require_postgres_url,
    _validate_dim,
    embed_batch_openai_v1,
    pg_connection_with_vector,
)

logger = logging.getLogger(__name__)

TIER_TO_GRADE_NUM = {
    "L2_G10": "10",
    "L3_G11": "11",
    "L3_G12": "12",
}


def build_rag_search_plans(
    ctx: Optional[Dict[str, Any]],
    *,
    normalized: Optional[Dict[str, str]] = None,
) -> List[Tuple[Optional[str], Optional[str], Optional[str]]]:
    """
    (grade, subject, term) tuples — strict to relaxed. Empty if no UI context.
    Pass `normalized` from `normalize_academic_context` to avoid duplicate work/logs.
    """
    n: Dict[str, str] = (
        normalized if normalized is not None else normalize_academic_context(ctx)
    )
    if not any(n.values()):
        return []
    tier = infer_grade_tier(n["grade"])
    sk = infer_subject_key(n["subject"])
    g = TIER_TO_GRADE_NUM.get(tier)
    raw_term = (n.get("term") or n.get("term_raw") or "").strip()
    t = normalize_term(raw_term) if raw_term else None
    s = sk if sk not in ("general",) else None
    out: List[Tuple[Optional[str], Optional[str], Optional[str]]] = []
    if g and s and t:
        out.append((g, s, t))
    if s and t and not g:
        out.append((None, s, t))
    if g and s:
        out.append((g, s, None))
    if g and t and not s:
        out.append((g, None, t))
    if g:
        out.append((g, None, None))
    if s:
        out.append((None, s, None))
    seen: set = set()
    dedup: List[Tuple[Optional[str], Optional[str], Optional[str]]] = []
    for p in out:
        if p in seen:
            continue
        seen.add(p)
        dedup.append(p)
    return dedup


def extract_metadata_from_path(path: Path) -> Dict[str, Optional[str]]:
    """Infer grade / subject / unit from full path. Folder names like `business`, `Grade_10`, `btec_specs`."""
    joined = "/".join(path.parts).lower()
    meta: Dict[str, Optional[str]] = {
        "grade": None,
        "term": None,
        "subject": None,
        "unit": None,
        "source": path.name,
    }
    if re.search(r"grade[ _-]*10|g10|l2_g10|/l2/|btec[ _-]*l2|العاشر|10th", joined):
        meta["grade"] = "10"
    elif re.search(r"grade[ _-]*11|g11|11th", joined):
        meta["grade"] = "11"
    elif re.search(r"grade[ _-]*12|g12|12th|tawjihi", joined):
        meta["grade"] = "12"
    if "btec" in joined or "pearson" in joined or "btec_specs" in joined:
        meta["subject"] = "btec_specs"
    elif re.search(r"business|management|marketing|إدارة|أعمال|تسويق", joined):
        meta["subject"] = "business"
    elif re.search(r"finance|تمويل|accounting|محاسب", joined):
        meta["subject"] = "finance"
    elif re.search(r"hr|human|موارد", joined):
        meta["subject"] = "hr"
    um = re.search(r"unit[ _-]?([0-9]+)", path.name, re.I)
    if not um:
        um = re.search(r"unit[ _-]?([0-9]+)", joined, re.I)
    if um:
        meta["unit"] = f"Unit {um.group(1)}"
    if re.search(r"term[ _-]?3|t3|الفصل[ _-]?الثالث|فصل[ _-]?3", joined):
        meta["term"] = "T3"
    elif re.search(r"term[ _-]?1|t1|الفصل[ _-]?الأول|فصل[ _-]?1", joined):
        meta["term"] = "T1"
    elif re.search(r"term[ _-]?2|t2|فصل[ _-]?2", joined):
        meta["term"] = "T2"
    return meta


def normalized_row_metadata(norm: Dict[str, str], tier: str, subject_key: str) -> Dict[str, Optional[str]]:
    """What we store / match for filtered search (aligned with extract_metadata_from_path)."""
    g = TIER_TO_GRADE_NUM.get(tier)
    if not g and norm.get("grade"):
        g2 = infer_grade_tier(norm["grade"])
        g = TIER_TO_GRADE_NUM.get(g2)
    return {
        "grade": g,
        "term": (norm.get("term") or "").strip() or None,
        "subject": None if subject_key in ("general",) else subject_key,
        "unit": None,
        "source": None,
    }


class RagDocumentsService:
    def __init__(self) -> None:
        self._dim = _validate_dim(int(settings.EMBEDDING_DIMENSIONS))
        self._openai: Optional[OpenAI] = None
        self._model = settings.resolved_openai_embedding_model()

    @property
    def openai(self) -> OpenAI:
        if self._openai is None:
            self._openai = OpenAI(api_key=settings.OPENAI_API_KEY)
        return self._openai

    def ensure_schema(self) -> None:
        _require_postgres_url(settings.DATABASE_URL)
        dim = self._dim
        ddl = f"""
        CREATE TABLE IF NOT EXISTS rag_documents (
            id           BIGSERIAL PRIMARY KEY,
            content      TEXT        NOT NULL,
            embedding    vector({dim}) NOT NULL,
            grade        TEXT,
            term         TEXT,
            subject      TEXT,
            unit         TEXT,
            source       TEXT,
            source_path  TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
        # Cosine: use <=>  (pgvector) with an index; IVFFlat needs sufficient rows — try HNSW first (matches project)
        idx_hnsw = """
        CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx
            ON rag_documents USING hnsw (embedding vector_cosine_ops);
        """
        idx_col = """
        CREATE INDEX IF NOT EXISTS rag_documents_grade_idx ON rag_documents (grade);
        CREATE INDEX IF NOT EXISTS rag_documents_subject_idx ON rag_documents (subject);
        CREATE INDEX IF NOT EXISTS rag_documents_term_idx ON rag_documents (term);
        """
        with pg_connection_with_vector() as conn:
            conn.execute(ddl)
            for stmt in idx_col.split(";"):
                s = stmt.strip()
                if s:
                    try:
                        conn.execute(s)
                    except Exception as e:
                        logger.debug("index stmt skip: %s: %s", s[:50], e)
            try:
                conn.execute(idx_hnsw)
            except Exception as e:
                logger.warning("rag_documents HNSW index: %s", e)
            conn.commit()
        logger.info("rag_documents schema ensured (dim=%s)", dim)

    def delete_by_file_key(self, file_key: str) -> int:
        """Removes all chunks for one file (same `source_path` = resolved file path)."""
        with pg_connection_with_vector() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM rag_documents WHERE source_path = %s", (file_key,))
                n = cur.rowcount or 0
            conn.commit()
        return int(n)

    def ingest_file_chunks(
        self,
        file_path: Path,
        chunks: Sequence[str],
        *,
        grade: Optional[str] = None,
        term: Optional[str] = None,
        subject: Optional[str] = None,
        unit: Optional[str] = None,
        path_extras: Optional[Dict[str, Optional[str]]] = None,
    ) -> int:
        """Delete prior rows for this file, then insert one row per non-empty chunk."""
        pe = path_extras or {}
        g = pe.get("grade") or grade
        te = pe.get("term") or term
        su = pe.get("subject") or subject
        u = pe.get("unit") or unit
        sp = str(file_path.resolve())
        n_insert = 0
        self.delete_by_file_key(sp)
        for ch in chunks:
            t = (ch or "").strip()
            if not t:
                continue
            emb = self.embed_one(t)
            if not emb:
                continue
            self.insert_chunk(
                t,
                emb,
                grade=g,
                term=te,
                subject=su,
                unit=u,
                source=file_path.name,
                source_path=sp,
            )
            n_insert += 1
        logger.info("rag_documents ingest: file=%s rows=%s grade=%r subject=%r", file_path.name, n_insert, g, su)
        return n_insert

    def insert_chunk(
        self,
        content: str,
        embedding: Sequence[float],
        *,
        grade: Optional[str],
        term: Optional[str],
        subject: Optional[str],
        unit: Optional[str],
        source: str,
        source_path: str,
    ) -> int:
        with pg_connection_with_vector() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO rag_documents
                        (content, embedding, grade, term, subject, unit, source, source_path)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (content, list(embedding), grade, term, subject, unit, source, source_path),
                )
                row = cur.fetchone()
            conn.commit()
        return int(row[0]) if row else 0

    def embed_one(self, text: str) -> List[float]:
        v = embed_batch_openai_v1(
            self.openai,
            self._model,
            [text],
            self._dim,
        )
        return v[0] if v else []

    def search_filtered(
        self,
        query: str,
        *,
        top_k: int = 5,
        grade: Optional[str] = None,
        term: Optional[str] = None,
        subject: Optional[str] = None,
    ) -> List[SearchHit]:
        """
        Filter in SQL (WHERE), then rank by cosine distance (embedding <=> q).
        """
        q = (query or "").strip()
        if not q or not (grade or subject or term):
            return []
        top_k = max(1, min(50, int(top_k)))
        qvec = self.embed_one(q)
        if not qvec:
            return []
        conds: List[str] = ["TRUE"]
        filt: List[Any] = []
        if grade is not None and str(grade).strip() != "":
            conds.append("grade = %s")
            filt.append(grade)
        if subject is not None and str(subject).strip() not in ("", "general"):
            conds.append("subject = %s")
            filt.append(subject)
        if term is not None and str(term).strip() != "":
            conds.append("term = %s")
            filt.append(term)
        where_sql = " AND ".join(conds)
        sql = f"""
            SELECT id, content, grade, term, subject, unit, source, source_path,
                   (embedding <=> %s::vector) AS distance
            FROM rag_documents
            WHERE {where_sql}
            ORDER BY embedding <=> %s::vector
            LIMIT %s
        """
        run_args: List[Any] = [qvec] + filt + [qvec, top_k]
        hits: List[SearchHit] = []
        with pg_connection_with_vector() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, run_args)
                for row in cur.fetchall():
                    dist = float(row["distance"])
                    sim = max(0.0, min(1.0, 1.0 - dist))
                    md: Dict[str, Any] = {
                        "source_file": row.get("source") or "?",
                        "grade": row.get("grade"),
                        "term": row.get("term"),
                        "subject": row.get("subject"),
                        "unit": row.get("unit"),
                        "source_path": row.get("source_path"),
                        "rag_table": "rag_documents",
                    }
                    hits.append(
                        SearchHit(
                            id=int(row["id"]),
                            content=str(row["content"] or ""),
                            metadata=md,
                            source_id=row.get("source_path") or str(row.get("id")),
                            distance=dist,
                            similarity=sim,
                        )
                    )
        return hits

    def search_first_matching_plan(
        self,
        query: str,
        plans: List[Tuple[Optional[str], Optional[str], Optional[str]]],
        *,
        top_k: int = 5,
        fallback_query: Optional[str] = None,
    ) -> tuple[List[SearchHit], Optional[dict]]:
        if not plans:
            return [], None
        last_g: Optional[str] = None
        last_s: Optional[str] = None
        last_t: Optional[str] = None
        main_q = (query or "").strip()
        alt = (fallback_query or "").strip()
        _seen: set = set()
        queries: List[str] = []
        for qx in (main_q, alt):
            if qx and qx not in _seen:
                _seen.add(qx)
                queries.append(qx)
        if not queries:
            logger.info(
                "[RAG FILTER] grade=%s, subject=%s, term=%s", None, None, None
            )
            logger.info("[RAG RESULT] found=%s", 0)
            return [], None
        for qstr in queries:
            for g, s, t in plans:
                last_g, last_s, last_t = g, s, t
                hits = self.search_filtered(
                    qstr,
                    top_k=top_k,
                    grade=g,
                    term=t,
                    subject=s,
                )
                if hits:
                    logger.info(
                        "[RAG FILTER] grade=%s, subject=%s, term=%s", g, s, t
                    )
                    logger.info("[RAG RESULT] found=%s", len(hits))
                    return hits, {
                        "grade": g,
                        "subject": s,
                        "term": t,
                    }
        logger.info(
            "[RAG FILTER] grade=%s, subject=%s, term=%s", last_g, last_s, last_t
        )
        logger.info("[RAG RESULT] found=%s", 0)
        return [], None


_rag: Optional[RagDocumentsService] = None


def get_rag_documents_service() -> RagDocumentsService:
    global _rag
    if _rag is None:
        _rag = RagDocumentsService()
    return _rag
