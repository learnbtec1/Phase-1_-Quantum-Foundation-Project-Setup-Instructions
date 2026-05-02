# -*- coding: utf-8 -*-
"""
Grader A/B metrics: **Redis (distributed, atomic Lua)** when `ASSESSMENT_AB_USE_REDIS` and URL set;
**JSON file (fallback)** on failure or when AB Redis disabled. Grading/ billing unchanged.

- Hash key: `{ASSESSMENT_REDIS_KEY_PREFIX}:grader_ab_metrics` (HINCRBY / HINCRBYFLOAT, no file races)
- Fields: total_samples, mismatch_count, sum_abs_conf_delta, sum_conf_shift
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_PATH: Optional[Path] = None

_lua_append_sha: Optional[str] = None
# After Redis reports migrated=1 or a successful one-shot import, skip GET on hot path.
_migrated_probed: bool = False

# Single atomic op: HINCRBY total, optional mismatch, HINCRBYFLOAT sums
_LUA_APPEND = """
local h = KEYS[1]
local mismatch = tonumber(ARGV[1])
local ad = tonumber(ARGV[2])
local cs = tonumber(ARGV[3])
if mismatch == 1 then
  redis.call('HINCRBY', h, 'mismatch_count', 1)
end
redis.call('HINCRBY', h, 'total_samples', 1)
redis.call('HINCRBYFLOAT', h, 'sum_abs_conf_delta', ad)
redis.call('HINCRBYFLOAT', h, 'sum_conf_shift', cs)
return 1
"""


def _redis_prefix() -> str:
    pfx = (getattr(settings, "ASSESSMENT_REDIS_KEY_PREFIX", "eduvor:assessment") or "eduvor:assessment").strip()
    return pfx.rstrip(":")


def _ab_redis_key() -> str:
    return f"{_redis_prefix()}:grader_ab_metrics"


def _migrated_flag_key() -> str:
    """String key: value '1' = JSON import attempted / completed or Redis already held counts."""
    return f"{_redis_prefix()}:grader_ab_migrated"


def _migration_lock_key() -> str:
    return f"{_redis_prefix()}:grader_ab_migration_lock"


def maybe_migrate_json_to_redis() -> None:
    """
    One-time: if Redis A/B hash has no total_samples but JSON has samples, HSET rolled-up sums, SET migrated=1.
    If Redis already has rows, only SET migrated=1. Safe across workers (SETNX lock, no double import).
    """
    global _migrated_probed
    if _migrated_probed:
        return
    if not getattr(settings, "ASSESSMENT_AB_MIGRATE_JSON_TO_REDIS", True):
        _migrated_probed = True
        return
    if not getattr(settings, "ASSESSMENT_AB_USE_REDIS", True):
        return
    r = _get_redis()
    if r is None:
        return
    try:
        if r.get(_migrated_flag_key()) == "1":
            _migrated_probed = True
            return
    except Exception:
        return
    try:
        if not r.set(_migration_lock_key(), "1", nx=True, ex=60):
            return
    except Exception:
        return
    try:
        if r.get(_migrated_flag_key()) == "1":
            _migrated_probed = True
            return
        key = _ab_redis_key()
        ts = r.hget(key, "total_samples")
        n_exist = int(ts or 0) if ts is not None else 0
        if n_exist > 0:
            r.set(_migrated_flag_key(), "1")
            _migrated_probed = True
            logger.info("grader_ab_store: Redis A/B hash already has data; set grader_ab_migrated=1")
            return
        with _lock:
            samples = _load_file_samples()
        if not samples:
            r.set(_migrated_flag_key(), "1")
            _migrated_probed = True
            logger.info("grader_ab_store: no JSON A/B rows; set grader_ab_migrated=1 (noop)")
            return
        n = len(samples)
        mismatch_n = sum(1 for x in samples if x.get("mismatch"))
        sum_ad = sum(float(x.get("avg_abs_confidence_delta", 0) or 0) for x in samples)
        sum_shift = sum(
            float(x.get("mean_conf_split", 0) or 0) - float(x.get("mean_conf_single", 0) or 0) for x in samples
        )
        r.hset(
            key,
            mapping={
                "total_samples": str(n),
                "mismatch_count": str(mismatch_n),
                "sum_abs_conf_delta": str(sum_ad),
                "sum_conf_shift": str(sum_shift),
            },
        )
        r.set(_migrated_flag_key(), "1")
        _migrated_probed = True
        logger.info(
            "grader_ab_store: migrated %s A/B JSON rows to Redis (one-time, migrated=1)",
            n,
        )
    except Exception as e:
        logger.warning("grader_ab_store: JSON→Redis migration failed (%s); will retry on next A/B op", e)
    finally:
        try:
            r.delete(_migration_lock_key())
        except Exception:
            pass


def _redis_url() -> str:
    u = (getattr(settings, "ASSESSMENT_REDIS_URL", None) or getattr(settings, "REDIS_URL", None) or "").strip()
    return u


def _get_redis() -> Optional[Any]:
    """A/B metrics Redis client, or None → caller uses JSON (see `app.services.redis_client`)."""
    if not getattr(settings, "ASSESSMENT_AB_USE_REDIS", True):
        return None
    from app.services.redis_client import get_grader_ab_redis

    return get_grader_ab_redis()


def _file_path() -> Path:
    global _PATH
    if _PATH is None:
        base = Path(__file__).resolve().parent.parent.parent
        rel = (getattr(settings, "ASSESSMENT_AB_STORE_PATH", "data/grader_ab_store.json") or "").strip() or "data/grader_ab_store.json"
        p = Path(rel)
        _PATH = p if p.is_absolute() else (base / p)
    return _PATH


def _max_samples() -> int:
    try:
        n = int(getattr(settings, "ASSESSMENT_AB_STORE_MAX_SAMPLES", 1000) or 1000)
    except (TypeError, ValueError):
        n = 1000
    return max(100, min(n, 10_000))


def _load_file_samples() -> List[Dict[str, Any]]:
    p = _file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.is_file():
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return []
        s = raw.get("samples")
        if not isinstance(s, list):
            return []
        out: List[Dict[str, Any]] = []
        for x in s:
            if isinstance(x, dict):
                out.append(x)
        return out
    except Exception:
        logger.exception("grader_ab_store: file load failed, starting empty")
        return []


def _save_file_samples(samples: List[Dict[str, Any]]) -> None:
    p = _file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    max_n = _max_samples()
    trimmed = samples[-max_n:]
    try:
        tmp = p.with_suffix(f".{os.getpid()}.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": 2,
                    "updated_at": time.time(),
                    "max_samples": max_n,
                    "samples": trimmed,
                },
                f,
                ensure_ascii=False,
                indent=0,
            )
        os.replace(str(tmp), str(p))
    except Exception:
        logger.exception("grader_ab_store: file save failed")


def _append_redis(
    r: Any,
    *,
    mismatch: int,
    avg_abs: float,
    conf_shift: float,
) -> bool:
    global _lua_append_sha
    key = _ab_redis_key()
    try:
        if _lua_append_sha is None:
            _lua_append_sha = r.script_load(_LUA_APPEND)
        r.evalsha(_lua_append_sha, 1, key, str(mismatch), str(avg_abs), str(conf_shift))
        return True
    except Exception as e:
        try:
            _lua_append_sha = r.script_load(_LUA_APPEND)
            r.evalsha(_lua_append_sha, 1, key, str(mismatch), str(avg_abs), str(conf_shift))
            return True
        except Exception:
            logger.warning("grader_ab_store: Redis append failed (%s), using file", e)
            return False


def _aggregate_from_redis(r: Any) -> Optional[Dict[str, Any]]:
    d = r.hgetall(_ab_redis_key())
    if not d:
        return None
    try:
        n = int(d.get("total_samples") or 0)
    except (TypeError, ValueError):
        n = 0
    if n <= 0:
        return None
    try:
        mc = int(d.get("mismatch_count") or 0)
    except (TypeError, ValueError):
        mc = 0
    try:
        s_ad = float(d.get("sum_abs_conf_delta") or 0.0)
    except (TypeError, ValueError):
        s_ad = 0.0
    try:
        s_cs = float(d.get("sum_conf_shift") or 0.0)
    except (TypeError, ValueError):
        s_cs = 0.0
    return {
        "total_samples": n,
        "mismatch_count": mc,
        "mismatch_rate": mc / n,
        "avg_abs_confidence_delta": s_ad / n,
        "mean_confidence_split_minus_single": s_cs / n,
    }


def _aggregate_from_file_samples(s: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(s)
    if n == 0:
        return {
            "total_samples": 0,
            "mismatch_count": 0,
            "mismatch_rate": 0.0,
            "avg_abs_confidence_delta": 0.0,
            "mean_confidence_split_minus_single": 0.0,
        }
    mismatch_n = sum(1 for x in s if x.get("mismatch"))
    sum_d = sum(float(x.get("avg_abs_confidence_delta", 0) or 0) for x in s)
    sum_shift = sum(
        float(x.get("mean_conf_split", 0) or 0) - float(x.get("mean_conf_single", 0) or 0) for x in s
    )
    return {
        "total_samples": n,
        "mismatch_count": mismatch_n,
        "mismatch_rate": mismatch_n / n,
        "avg_abs_confidence_delta": sum_d / n,
        "mean_confidence_split_minus_single": sum_shift / n,
    }


def append_grader_ab_row(row: Dict[str, Any]) -> None:
    """
    One sample: try Redis (atomic); on failure fall back to JSON file ring buffer.
    """
    maybe_migrate_json_to_redis()
    mismatch = 1 if row.get("mismatch") else 0
    try:
        ad = float(row.get("avg_abs_confidence_delta", 0) or 0.0)
    except (TypeError, ValueError):
        ad = 0.0
    try:
        m_s = float(row.get("mean_conf_single", 0) or 0.0)
    except (TypeError, ValueError):
        m_s = 0.0
    try:
        m_sp = float(row.get("mean_conf_split", 0) or 0.0)
    except (TypeError, ValueError):
        m_sp = 0.0
    cs = m_sp - m_s

    def _after_ab_row_persisted() -> None:
        try:
            from app.services.auto_rollout_service import maybe_step_auto_rollout

            maybe_step_auto_rollout()
        except Exception:
            logger.debug("grader_ab_store: auto_rollout step skipped", exc_info=True)

    r = _get_redis()
    if r is not None and _append_redis(r, mismatch=mismatch, avg_abs=ad, conf_shift=cs):
        _after_ab_row_persisted()
        return

    with _lock:
        cur = _load_file_samples()
        cur.append({**row, "ts": time.time()})
        max_n = _max_samples()
        if len(cur) > max_n:
            cur = cur[-max_n:]
        _save_file_samples(cur)
    _after_ab_row_persisted()


def get_persisted_samples() -> List[Dict[str, Any]]:
    """File fallback samples only; empty when all data lives in Redis."""
    with _lock:
        return list(_load_file_samples())


def compute_aggregate_from_samples(
    samples: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if samples is not None:
        return _aggregate_from_file_samples(samples)
    maybe_migrate_json_to_redis()
    r = _get_redis()
    if r is not None:
        try:
            agg = _aggregate_from_redis(r)
            if agg is not None and int(agg.get("total_samples", 0) or 0) > 0:
                return agg
        except Exception:
            logger.exception("grader_ab_store: Redis aggregate read failed")
    with _lock:
        return _aggregate_from_file_samples(_load_file_samples())


def get_readiness_state() -> str:
    from app.core.config import settings as s

    agg = compute_aggregate_from_samples()
    n = int(agg["total_samples"])
    try:
        min_s = int(getattr(s, "ASSESSMENT_AB_READINESS_MIN_SAMPLES", 0) or 0)
    except (TypeError, ValueError):
        min_s = 0
    if min_s <= 0:
        try:
            min_s = int(getattr(s, "ASSESSMENT_AB_MIN_SAMPLES_FOR_RECOMMENDATION", 20) or 20)
        except (TypeError, ValueError):
            min_s = 20
    try:
        max_mis = float(getattr(s, "ASSESSMENT_AB_MAX_MISMATCH_PCT", 5.0) or 5.0) / 100.0
    except (TypeError, ValueError):
        max_mis = 0.05
    conf_shift = float(agg.get("mean_confidence_split_minus_single", 0) or 0)
    mis_r = float(agg.get("mismatch_rate", 0) or 0)
    if n >= min_s and mis_r < max_mis and conf_shift >= -0.02:
        return "READY_TO_SCALE"
    return "HOLD"


def get_full_summary() -> Dict[str, Any]:
    """Aggregates: Redis when it has data, else file ring buffer. Meta indicates primary backend."""
    agg = compute_aggregate_from_samples()
    n_redis = 0
    r = _get_redis()
    if r is not None:
        try:
            v = r.hget(_ab_redis_key(), "total_samples")
            n_redis = int(v or 0) if v is not None else 0
        except Exception:
            n_redis = 0
    with _lock:
        n_file = len(_load_file_samples())
    if n_redis > 0:
        store_backend = "redis"
    elif n_file > 0:
        store_backend = "file"
    else:
        store_backend = "none"
    ab_json_migrated: Optional[bool] = None
    if r is not None:
        try:
            ab_json_migrated = r.get(_migrated_flag_key()) == "1"
        except Exception:
            ab_json_migrated = None
    return {
        **agg,
        "readiness": get_readiness_state(),
        "store_backend": store_backend,
        "ab_use_redis": bool(getattr(settings, "ASSESSMENT_AB_USE_REDIS", True)),
        "ab_json_migrated": ab_json_migrated,
        "store_path": str(_file_path()),
        "redis_key": _ab_redis_key()
        if (getattr(settings, "ASSESSMENT_AB_USE_REDIS", True) and _redis_url())
        else None,
    }
