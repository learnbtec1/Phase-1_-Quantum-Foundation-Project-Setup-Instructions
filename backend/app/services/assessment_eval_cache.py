# -*- coding: utf-8 -*-
"""
Audit-grade result cache: L1 in-process LRU → L2 Redis (optional) → recompute (LLM).

- Per-criterion keys include a fingerprint of SYSTEM_EVIDENCE + SYSTEM_EVALUATE.
- Full-pipeline keys include all main pipeline prompts (extract, evidence, eval, aggregate, review) + embedding model.

Redis: set ASSESSMENT_REDIS_URL (or REDIS_URL). Falls back to local-only if unset or connection fails.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import threading
from collections import OrderedDict
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def build_criterion_result_cache_key(
    *,
    student_work: str,
    assignment_criteria: str,
    criterion: Dict[str, str],
    btec_unit: str = "",
    assessment_model: str = "",
    max_pipeline_chunks: int = 50,
    criterion_path_fingerprint: str = "",
    academic_context_json: str = "",
) -> str:
    """
    Stable SHA-256 key for a single criterion’s pipeline result.
    `criterion_path_fingerprint` should hash( SYSTEM_EVIDENCE + SYSTEM_EVALUATE ) (or similar) from assessment_pipeline
    so evidence + eval prompt edits invalidate the cache.
    """
    payload = {
        "pf": (criterion_path_fingerprint or "").strip(),
        "m": (assessment_model or "").strip(),
        "mc": int(max_pipeline_chunks),
        "unit": (btec_unit or "").strip(),
        "sw": student_work,
        "ac": (assignment_criteria or "").strip(),
        "code": (criterion.get("code") or "").strip(),
        "desc": (criterion.get("description") or "").strip(),
        "ctx": (academic_context_json or "").strip(),
    }
    raw = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_full_pipeline_cache_key(
    *,
    student_work: str,
    assignment_criteria: str,
    btec_unit: str = "",
    assessment_model: str = "",
    max_pipeline_chunks: int = 50,
    min_words: int = 150,
    enable_final_review: bool = False,
    pipeline_llm_fingerprint: str = "",
    chat_model: str = "",
    embedding_model: str = "",
    academic_context_json: str = "",
) -> str:
    """
    Key for the entire grade-pipeline response (not per-criterion only).
    `pipeline_llm_fingerprint` should cover all pipeline prompts (extract, evidence, eval, aggregate, review).
    """
    payload = {
        "pfull": (pipeline_llm_fingerprint or "").strip(),
        "m": (assessment_model or "").strip(),
        "mchat": (chat_model or "").strip(),
        "emb": (embedding_model or "").strip(),
        "mc": int(max_pipeline_chunks),
        "minw": int(min_words),
        "fr": bool(enable_final_review),
        "unit": (btec_unit or "").strip(),
        "sw": student_work,
        "ac": (assignment_criteria or "").strip(),
        "ctx": (academic_context_json or "").strip(),
    }
    raw = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class CriterionResultLRUCache:
    """Thread-safe LRU: stores JSON-serializable dicts (copies on read)."""

    def __init__(self, max_entries: int) -> None:
        self._max = max(1, int(max_entries))
        self._lock = threading.RLock()
        self._data: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return copy.deepcopy(self._data[key])

    def set(self, key: str, value: Dict[str, Any]) -> None:
        with self._lock:
            self._data[key] = copy.deepcopy(value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)


class TieredResultCache:
    """
    L1: process LRU. L2: Redis. get: L1 → L2 (promote to L1 on hit). set: both.
    """

    def __init__(self, l1_max: int) -> None:
        self._l1 = CriterionResultLRUCache(max_entries=l1_max)
        self._redis = _RedisAdapter()

    @property
    def redis_reachable(self) -> bool:
        return self._redis.available

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        v = self._l1.get(key)
        if v is not None:
            return v
        v2 = self._redis.get(key)
        if v2 is not None:
            self._l1.set(key, v2)
            return copy.deepcopy(v2)
        return None

    def set(self, key: str, value: Dict[str, Any]) -> None:
        self._l1.set(key, value)
        self._redis.set(key, value)


class _RedisAdapter:
    """JSON blob store; no-op if Redis URL missing or import/connection failure."""

    def __init__(self) -> None:
        self._r = _connect_redis()
        self._ttl = int(getattr(settings, "ASSESSMENT_REDIS_TTL_SECONDS", 604_800) or 604_800)
        self._prefix = (getattr(settings, "ASSESSMENT_REDIS_KEY_PREFIX", "eduvor:assessment") or "eduvor:assessment").strip()

    @property
    def available(self) -> bool:
        return self._r is not None

    def _k(self, key: str) -> str:
        return f"{self._prefix}:v1:{key}"

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        if self._r is None:
            return None
        try:
            raw = self._r.get(self._k(key))
        except Exception as e:
            logger.warning("redis get failed: %s", e)
            return None
        if not raw:
            return None
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return None
        if isinstance(raw, (bytes, bytearray)):
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return None
        return None

    def set(self, key: str, value: Dict[str, Any]) -> None:
        if self._r is None:
            return
        try:
            raw = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
            self._r.set(self._k(key), raw, ex=self._ttl)
        except Exception as e:
            logger.warning("redis set failed: %s", e)


def _connect_redis():
    try:
        import redis as redis_lib  # type: ignore[import-not-found]
    except ImportError:
        logger.info("redis package not installed; L2 cache disabled")
        return None
    url = (getattr(settings, "ASSESSMENT_REDIS_URL", None) or getattr(settings, "REDIS_URL", None) or "").strip()
    if not url:
        return None
    try:
        r = redis_lib.from_url(url, decode_responses=True, socket_connect_timeout=2.0)
        r.ping()
        logger.info("assessment L2 cache: Redis connected")
        return r
    except Exception as e:
        logger.warning("assessment L2 cache: Redis unavailable (%s) — L1 only", e)
        return None


_tier: Optional[TieredResultCache] = None
_tier_init_lock = threading.Lock()


def get_tiered_result_cache() -> Optional[TieredResultCache]:
    if not bool(getattr(settings, "ASSESSMENT_EVAL_CACHE_ENABLED", True)):
        return None
    global _tier
    if _tier is not None:
        return _tier
    with _tier_init_lock:
        if _tier is None:
            n = int(getattr(settings, "ASSESSMENT_EVAL_CACHE_MAX_ENTRIES", 2000) or 2000)
            _tier = TieredResultCache(l1_max=n)
            logger.info("assessment tiered cache: L1 max_entries=%s, L2=%s", n, _tier.redis_reachable)
    return _tier


# Back-compat alias
def get_criterion_result_cache() -> Optional[TieredResultCache]:
    return get_tiered_result_cache()
