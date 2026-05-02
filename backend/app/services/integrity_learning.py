# -*- coding: utf-8 -*-
"""
Teacher feedback + optional self-tuning (least-squares) weights for integrity scoring.

- Stores feedback and labeled training rows in Postgres.
- `retrain` fits nonnegative normalized weights; activates one row in `integrity_weight_config`.
- Enable with INTEGRITY_USE_LEARNED_WEIGHTS=true and `GET /api/v1/integrity/weights` for inspection.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.core.config import settings
from app.db.integrity_ddl import INTEGRITY_DDL
from app.services.integrity_composite import INTEGRITY_VERSION, _resolve_weights

logger = logging.getLogger(__name__)

_WPack = Tuple[float, float, float, float, float]

# In-process cache for active learned weights (avoid DB on every search row).
_LRU_TS = 0.0
_LRU_TTL = 15.0
_CACHED_LEARNED: Optional[_WPack] = None


def ensure_integrity_schema(dsn: Optional[str] = None) -> None:
    url = dsn or settings.DATABASE_URL
    if not str(url or "").strip().startswith(("postgresql://", "postgres://")):
        return
    with psycopg.connect(url) as conn:
        for stmt in INTEGRITY_DDL:
            with conn.cursor() as cur:
                cur.execute(stmt)
        conn.commit()


def _invalid_learned_cache() -> None:
    global _CACHED_LEARNED, _LRU_TS
    _CACHED_LEARNED = None
    _LRU_TS = 0.0


def get_active_learned_weights() -> Optional[_WPack]:
    global _CACHED_LEARNED, _LRU_TS
    if not (settings.INTEGRITY_USE_LEARNED_WEIGHTS and settings.DATABASE_URL):
        return None
    now = time.monotonic()
    if _CACHED_LEARNED is not None and (now - _LRU_TS) < _LRU_TTL:
        return _CACHED_LEARNED
    try:
        with psycopg.connect(settings.DATABASE_URL) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    """
                    SELECT w_semantic, w_ngram, w_ai, w_citation, w_behavioral
                    FROM integrity_weight_config
                    WHERE is_active = true
                    ORDER BY id DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
    except Exception as e:
        logger.warning("integrity learned weights read failed: %s", e)
        return None
    if not row:
        return None
    t = (
        float(row["w_semantic"]),
        float(row["w_ngram"]),
        float(row["w_ai"]),
        float(row["w_citation"]),
        float(row["w_behavioral"]),
    )
    _CACHED_LEARNED = t
    _LRU_TS = now
    return t


def get_effective_composite_weights(ngram_overlap: float) -> Tuple[_WPack, str]:
    if settings.INTEGRITY_USE_LEARNED_WEIGHTS:
        w = get_active_learned_weights()
        if w is not None:
            return w, "learned"
    return _resolve_weights(ngram_overlap)


def _label_to_target(teacher_label: Optional[str], action_taken: Optional[str]) -> Optional[float]:
    t = (teacher_label or "").strip().lower()
    a = (action_taken or "").strip().lower()
    if t in ("false_positive", "not_plagiarism", "legitimate", "dismiss"):
        return 0.12
    if t in ("confirmed", "true_positive", "plagiarism", "academic_misconduct"):
        return 0.92
    if t in ("needs_review", "unclear", "inconclusive"):
        return 0.55
    if a == "retrain" and not t:
        return None
    if a in ("mark_false_positive", "false_positive"):
        return 0.12
    if a in ("mark_confirmed", "confirmed"):
        return 0.92
    return None


def _snapshot_to_features(
    snap: Any,
) -> Optional[Tuple[float, float, float, float, float]]:
    if not isinstance(snap, dict):
        return None
    def g(*keys: str) -> Optional[float]:
        for k in keys:
            v = snap.get(k)
            if v is not None and isinstance(v, (int, float)):
                return float(v)
        return None
    sem = g("component_semantic", "semantic", "similarity")
    ngr = g("component_ngram", "ngram_overlap", "ngram")
    aiv = g("component_ai_effective", "ai_signal", "ai_effective")
    cit = g("component_citation", "citation", "citation_signal")
    beh = g("component_behavioral_effective", "behavioral", "behavioral_effective")
    if aiv is None:
        aiv = 0.5
    if beh is None:
        beh = 0.5
    if None in (sem, ngr, cit):
        return None
    return (
        max(0.0, min(1.0, sem)),
        max(0.0, min(1.0, ngr)),
        max(0.0, min(1.0, aiv)),
        max(0.0, min(1.0, cit)),
        max(0.0, min(1.0, beh)),
    )


def insert_feedback(
    user_id: int,
    *,
    student_id: Optional[str],
    feedback_text: str,
    action_taken: Optional[str],
    teacher_label: Optional[str],
    integrity_snapshot: Any,
) -> int:
    """Persist feedback; optionally add a training row if label + features exist."""
    snap: Any
    if isinstance(integrity_snapshot, (dict, list)):
        snap = Json(integrity_snapshot)
    else:
        snap = integrity_snapshot

    with psycopg.connect(settings.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO integrity_teacher_feedback
                    (user_id, student_id, feedback_text, action_taken, teacher_label, integrity_snapshot)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (user_id, student_id, feedback_text, action_taken, teacher_label, snap),
            )
            row = cur.fetchone()
            fid = int(row[0]) if row else 0
        tgt = _label_to_target(teacher_label, action_taken)
        feats = _snapshot_to_features(integrity_snapshot) if integrity_snapshot else None
        if tgt is not None and feats is not None and fid:
            s, n, a, c, b = feats
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO integrity_training_sample
                        (semantic, ngram, ai_signal, citation, behavioral, target_score, source_feedback_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (s, n, a, c, b, max(0.0, min(1.0, tgt)), fid),
                )
        conn.commit()
    return fid


@dataclass
class RetrainResult:
    ok: bool
    version: str
    n_samples: int
    weights: Optional[Dict[str, float]]
    message: str


def retrain_least_squares() -> RetrainResult:
    """
    Nonnegative least-squares (projected) on training samples, then L1 normalize.
    Requires at least INTEGRITY_RETRAIN_MIN_SAMPLES rows.
    """
    min_n = int(settings.INTEGRITY_RETRAIN_MIN_SAMPLES)
    with psycopg.connect(settings.DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT semantic, ngram, ai_signal, citation, behavioral, target_score
                FROM integrity_training_sample
                ORDER BY id
                """
            )
            rows = list(cur.fetchall() or [])

    if len(rows) < min_n:
        return RetrainResult(
            ok=False,
            version=INTEGRITY_VERSION,
            n_samples=len(rows),
            weights=None,
            message=f"Not enough training samples: have {len(rows)}, need {min_n}.",
        )

    X = np.array(
        [[r["semantic"], r["ngram"], r["ai_signal"], r["citation"], r["behavioral"]] for r in rows],
        dtype=np.float64,
    )
    y = np.array([float(r["target_score"]) for r in rows], dtype=np.float64)
    if X.shape[0] < X.shape[1] + 1:
        return RetrainResult(
            ok=False,
            version=INTEGRITY_VERSION,
            n_samples=len(rows),
            weights=None,
            message="Too few rows relative to 5 features.",
        )

    # Linear regression, then project to nonnegative simplex
    w, resid, rank, s = np.linalg.lstsq(X, y, rcond=None)
    w = np.maximum(w, 0.0)
    s_ = float(w.sum()) or 1.0
    w = w / s_

    wdict = {
        "semantic": float(w[0]),
        "ngram": float(w[1]),
        "ai": float(w[2]),
        "citation": float(w[3]),
        "behavioral": float(w[4]),
    }
    v = f"learned-{INTEGRITY_VERSION}-{len(rows)}"
    with psycopg.connect(settings.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE integrity_weight_config SET is_active = false")
            cur.execute(
                """
                INSERT INTO integrity_weight_config
                    (version, w_semantic, w_ngram, w_ai, w_citation, w_behavioral, n_samples, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, true)
                """,
                (v, w[0], w[1], w[2], w[3], w[4], len(rows)),
            )
        conn.commit()
    _invalid_learned_cache()
    return RetrainResult(
        ok=True,
        version=v,
        n_samples=len(rows),
        weights=wdict,
        message="Learned weights stored; set INTEGRITY_USE_LEARNED_WEIGHTS=true to apply at runtime.",
    )


def get_weights_status() -> Dict[str, Any]:
    """Active learned row + sample counts for API."""
    ntrain = 0
    active: Optional[Dict[str, Any]] = None
    with psycopg.connect(settings.DATABASE_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT count(*)::int AS c FROM integrity_training_sample")
            r0 = cur.fetchone()
            ntrain = int(r0["c"]) if r0 else 0
            cur.execute(
                """
                SELECT id, version, w_semantic, w_ngram, w_ai, w_citation, w_behavioral, n_samples, is_active, created_at
                FROM integrity_weight_config
                WHERE is_active = true
                ORDER BY id DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row:
                active = dict(row)
    return {
        "integrity_version": INTEGRITY_VERSION,
        "use_learned_weights": bool(settings.INTEGRITY_USE_LEARNED_WEIGHTS),
        "training_sample_count": ntrain,
        "min_samples_for_retrain": int(settings.INTEGRITY_RETRAIN_MIN_SAMPLES),
        "active_learned": active,
    }
