# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.db.models import User
from app.services import usage_service
from app.services.integrity_composite import (
    INTEGRITY_VERSION,
    HitIntegrity,
    build_hit_integrity,
    build_query_integrity_summary,
    citation_alignment_heuristic,
)
from app.services.vector_service import SearchHit, get_vector_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vectors", tags=["vectors"])


class IngestBody(BaseModel):
    text: str = Field(..., min_length=1)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    source_id: Optional[str] = None
    chunk: bool = True


class IngestResponse(BaseModel):
    ids: List[int]


class SearchBody(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(8, ge=1, le=100)
    max_distance: Optional[float] = None
    metadata_filter: Optional[Dict[str, Any]] = None
    include_integrity: bool = Field(
        True,
        description="If true, n-gram overlap + composite integrity score and risk band per hit.",
    )
    count_toward_usage: bool = Field(
        True,
        description=(
            "If true (default), this request counts against the user's monthly plagiarism quota. "
            "Set false for internal corpus checks (e.g. during assessment) so the same action does not double-bill."
        ),
    )
    ngram_n: int = Field(5, ge=3, le=8, description="Word n-gram size for literal overlap vs semantic match.")
    # Optional: plug an external / future AI detector (0–1). Never used alone as a verdict.
    ai_signal: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Optional prior from an AI-likeness detector; omitted uses neutral 0.5 in composite.",
    )


class CopiedEvidenceOut(BaseModel):
    text: str
    length: int
    confidence: float
    source_id: str


class RiskOut(BaseModel):
    band: str
    reasons: List[str] = Field(default_factory=list)


class SearchHitOut(BaseModel):
    id: int
    content: str
    metadata: Dict[str, Any]
    source_id: Optional[str]
    distance: float
    similarity: float
    ngram_overlap: Optional[float] = None
    integrity_score: Optional[float] = None
    risk: Optional[RiskOut] = None
    risk_band: Optional[str] = Field(
        None,
        description="Same as risk.band when include_integrity is true; kept for quick clients.",
    )
    copied_evidence: List[CopiedEvidenceOut] = Field(default_factory=list)
    component_semantic: Optional[float] = None
    component_ngram: Optional[float] = None
    component_citation: Optional[float] = None
    component_ai_effective: Optional[float] = None
    component_behavioral_effective: Optional[float] = None
    component_citation_inflation_damped: Optional[bool] = None
    weight_profile: Optional[str] = Field(
        None, description="default | literal_focus — from dynamic n-gram weighting."
    )
    weights_used: Optional[Dict[str, float]] = Field(
        None,
        description="Active composite weights (semantic, ngram, ai, citation, behavioral).",
    )


class SearchResponse(BaseModel):
    results: List[SearchHitOut] = Field(default_factory=list)
    corpus_chunk_count: int = Field(
        0,
        description="Number of vector-indexed chunks in the database; 0 means run ingest (no matches possible).",
    )
    fallback: bool = Field(
        False,
        description="True when embedding failed; empty results; client may continue grading without corpus match.",
    )
    query_citation_signal: Optional[float] = Field(
        None, description="Heuristic 0–1: citation-like patterns in the query text (submission)."
    )
    integrity_summary: Optional[Dict[str, Any]] = Field(
        None, description="Aggregate: max final score, distribution counts/%, worst-case band."
    )
    integrity_version: str = Field(
        INTEGRITY_VERSION, description="Integrity engine version for client compatibility."
    )


def _hit_to_out(h: SearchHit) -> SearchHitOut:
    return SearchHitOut(
        id=h.id,
        content=h.content,
        metadata=h.metadata,
        source_id=h.source_id,
        distance=h.distance,
        similarity=h.similarity,
    )


def _hit_to_out_enriched(h: SearchHit, hi: HitIntegrity) -> SearchHitOut:
    c = hi.components
    risk = RiskOut(band=hi.risk_band, reasons=list(hi.risk_reasons))
    ev = [
        CopiedEvidenceOut(
            text=e.text,
            length=e.length,
            confidence=e.confidence,
            source_id=e.source_id,
        )
        for e in hi.copied_evidence
    ]
    return SearchHitOut(
        id=h.id,
        content=h.content,
        metadata=h.metadata,
        source_id=h.source_id,
        distance=h.distance,
        similarity=h.similarity,
        ngram_overlap=c.ngram_overlap,
        integrity_score=round(hi.final_score, 4),
        risk=risk,
        risk_band=hi.risk_band,
        copied_evidence=ev,
        component_semantic=c.semantic_similarity,
        component_ngram=c.ngram_overlap,
        component_citation=c.citation_signal,
        component_ai_effective=c.ai_effective,
        component_behavioral_effective=c.behavioral_effective,
        component_citation_inflation_damped=c.citation_inflation_damped,
        weight_profile=c.weight_profile,
        weights_used=c.weights_used,
    )


@router.post("/ingest", response_model=IngestResponse)
def ingest_vectors(
    body: IngestBody,
    _user: User = Depends(get_current_user),
) -> IngestResponse:
    svc = get_vector_service()
    try:
        svc.ensure_schema()
        ids = svc.ingest(
            body.text,
            metadata=body.metadata,
            source_id=body.source_id,
            chunk=body.chunk,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("vectors ingest failed")
        raise HTTPException(status_code=503, detail=str(e)[:2000]) from e
    return IngestResponse(ids=ids)


@router.post("/search", response_model=SearchResponse)
def search_vectors(
    body: SearchBody,
    _user: User = Depends(get_current_user),
) -> SearchResponse:
    count_u = bool(body.count_toward_usage)
    if count_u:
        usage_service.require_plagiarism_allowance(_user)

    def _bump() -> None:
        if count_u:
            usage_service.record_plagiarism_success(_user)

    svc = get_vector_service()
    try:
        svc.ensure_schema()
    except Exception as e:
        logger.exception("vectors search ensure_schema")
        raise HTTPException(status_code=503, detail=str(e)[:2000]) from e

    n_corpus = svc.count_chunks()
    if n_corpus == 0:
        # No index → no vector neighbours; avoid useless OpenAI embedding calls.
        # Do not count toward monthly plagiarism quota (spec: only successful checks count).
        inc = bool(body.include_integrity)
        q_cit = (
            round(citation_alignment_heuristic(body.query), 4) if inc else None
        )
        r = SearchResponse(
            results=[],
            corpus_chunk_count=0,
            fallback=False,
            query_citation_signal=q_cit,
            integrity_summary=None,
            integrity_version=INTEGRITY_VERSION,
        )
        return r
    try:
        hits = svc.search(
            body.query,
            top_k=body.top_k,
            max_distance=body.max_distance,
            metadata_filter=body.metadata_filter,
        )
    except RuntimeError as e:
        msg = str(e)
        if msg.startswith("EMBEDDING_ERROR:") or "EMBEDDING_ERROR" in msg[:60]:
            logger.warning("vector search embedding fallback: %s", e)
            n2 = svc.count_chunks()
            r = SearchResponse(
                results=[],
                corpus_chunk_count=max(0, n2),
                fallback=True,
                query_citation_signal=None,
                integrity_summary=None,
                integrity_version=INTEGRITY_VERSION,
            )
            # Embedding failed — not a successful plagiarism check; do not consume quota.
            return r
        raise HTTPException(status_code=503, detail=msg) from e
    except Exception as e:
        logger.exception("vectors search failed")
        raise HTTPException(status_code=503, detail=str(e)[:2000]) from e
    inc = bool(body.include_integrity)
    if inc:
        enriched = [
            build_hit_integrity(
                body.query,
                h.content,
                h.similarity,
                ngram_n=body.ngram_n,
                ai_signal=body.ai_signal,
                behavioral_signal=None,
                chunk_id=h.id,
                source_row_id=str(h.source_id) if h.source_id is not None else None,
            )
            for h in hits
        ]
        out_rows = [_hit_to_out_enriched(h, hi) for h, hi in zip(hits, enriched)]
        summary = build_query_integrity_summary(enriched)
        q_cit = round(citation_alignment_heuristic(body.query), 4)
    else:
        out_rows = [_hit_to_out(h) for h in hits]
        summary = None
        q_cit = None
    r = SearchResponse(
        results=out_rows,
        corpus_chunk_count=n_corpus,
        fallback=False,
        query_citation_signal=q_cit,
        integrity_summary=summary,
        integrity_version=INTEGRITY_VERSION,
    )
    _bump()
    return r
