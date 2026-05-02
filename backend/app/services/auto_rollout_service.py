# -*- coding: utf-8 -*-
"""
Conservative auto-adjust of split-grader **rollout percent** from A/B aggregates only.
- Does not change rubrics, models, or billing.
- Respects ASSESSMENT_GRADER_FORCE_SINGLE_MODE / FORCE_SPLIT_MODE (no-op in step()).
- Never auto-targets 100% (capped by AUTO_ROLLOUT_MAX_ROLLOUT_PERCENT, default 80).

Effective percent is read via get_effective_split_rollout_percent() (wires into sticky cohort routing).
State: Redis (same client as A/B when available) or JSON file fallback.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from app.core.config import settings
from app.services.grader_ab_store import compute_aggregate_from_samples

logger = logging.getLogger(__name__)

_file_lock = threading.Lock()
_file_cache: Optional[Path] = None

_STATE_VERSION = 1


def _backend_base() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _state_file_path() -> Path:
    global _file_cache
    if _file_cache is None:
        rel = (getattr(settings, "AUTO_ROLLOUT_STATE_PATH", "data/auto_rollout_state.json") or "").strip()
        rel = rel or "data/auto_rollout_state.json"
        p = Path(rel)
        _file_cache = p if p.is_absolute() else (_backend_base() / p)
    return _file_cache


def _redis_key() -> str:
    pfx = (getattr(settings, "ASSESSMENT_REDIS_KEY_PREFIX", "eduvor:assessment") or "eduvor:assessment").strip().rstrip(":")
    return f"{pfx}:auto_rollout_state"


def _get_redis() -> Optional[Any]:
    from app.services.redis_client import get_grader_ab_redis

    return get_grader_ab_redis()


def _max_auto_percent() -> int:
    try:
        m = int(getattr(settings, "AUTO_ROLLOUT_MAX_ROLLOUT_PERCENT", 80) or 0)
    except (TypeError, ValueError):
        m = 80
    return max(0, min(99, m))


def _clamp_rollout(n: int) -> int:
    m = _max_auto_percent()
    n = int(n) if n is not None else 0
    return max(0, min(n, m, 99))


def _default_state(rollout: int) -> Dict[str, Any]:
    return {
        "v": _STATE_VERSION,
        "rollout_percent": _clamp_rollout(rollout),
        "last_update_ts": 0.0,
        "last_action": "none",
        "last_reason": "",
    }


def _load_state_json() -> Optional[Dict[str, Any]]:
    p = _state_file_path()
    if not p.is_file():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(d, dict):
        return None
    return d


def _save_state_json(d: Dict[str, Any]) -> None:
    p = _state_file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=0)
    tmp.replace(p)


def _load_state() -> Optional[Dict[str, Any]]:
    r = _get_redis()
    if r is not None:
        try:
            raw = r.get(_redis_key())
        except Exception:
            raw = None
        if raw:
            try:
                d = json.loads(raw) if isinstance(raw, str) else None
            except (TypeError, json.JSONDecodeError):
                d = None
            if isinstance(d, dict) and d.get("v") == _STATE_VERSION:
                d["rollout_percent"] = _clamp_rollout(int(d.get("rollout_percent", 0) or 0))
                return d
    with _file_lock:
        d = _load_state_json()
    if isinstance(d, dict) and d.get("v") == _STATE_VERSION:
        d["rollout_percent"] = _clamp_rollout(int(d.get("rollout_percent", 0) or 0))
        return d
    return None


def _save_state(d: Dict[str, Any]) -> None:
    d = dict(d)
    d["v"] = _STATE_VERSION
    d["rollout_percent"] = _clamp_rollout(int(d.get("rollout_percent", 0) or 0))
    r = _get_redis()
    if r is not None:
        try:
            r.set(_redis_key(), json.dumps(d, separators=(",", ":")))
        except Exception:
            logger.debug("auto_rollout: redis save failed, falling back to file")
    with _file_lock:
        _save_state_json(d)


def get_effective_split_rollout_percent() -> int:
    """
    Rollout 0-100 for sticky cohort (capped; never 100 from auto). When AUTO_ROLLOUT_ENABLED is
    off, this equals ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT from config.
    """
    if not getattr(settings, "AUTO_ROLLOUT_ENABLED", False):
        try:
            rp = int(getattr(settings, "ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT", 0) or 0)
        except (TypeError, ValueError):
            rp = 0
        return max(0, min(100, rp))
    st = _load_state()
    if st is not None:
        return _clamp_rollout(int(st.get("rollout_percent", 0) or 0))
    try:
        rp0 = int(getattr(settings, "ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT", 0) or 0)
    except (TypeError, ValueError):
        rp0 = 0
    return _clamp_rollout(rp0)


def get_auto_rollout_status() -> Dict[str, Any]:
    """In-process + persisted snapshot for ops/audit (not an HTTP API by default)."""
    enabled = bool(getattr(settings, "AUTO_ROLLOUT_ENABLED", False))
    st = _load_state() if enabled else None
    eff = get_effective_split_rollout_percent()
    return {
        "enabled": enabled,
        "effective_rollout_percent": eff,
        "stored_rollout_percent": (st or {}).get("rollout_percent") if st else None,
        "last_action": (st or {}).get("last_action", ""),
        "last_reason": (st or {}).get("last_reason", ""),
        "last_update_ts": (st or {}).get("last_update_ts", 0.0),
        "config_rollout_percent": int(getattr(settings, "ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT", 0) or 0),
        "max_auto_cap": _max_auto_percent(),
        "redis_key": _redis_key() if _get_redis() is not None else None,
        "state_path": str(_state_file_path()),
    }


def _decide_action(
    total: int, mismatch_rate: float, conf_delta: float
) -> tuple[str, str]:
    """Return (INCREASE|DECREASE|HOLD, reason)."""
    try:
        min_s = int(getattr(settings, "AUTO_ROLLOUT_MIN_SAMPLES", 50) or 0)
    except (TypeError, ValueError):
        min_s = 50
    if total < min_s:
        return "HOLD", f"insufficient_samples total={total} < {min_s}"
    try:
        max_m = float(getattr(settings, "AUTO_ROLLOUT_MAX_MISMATCH_PCT", 5.0) or 5.0)
    except (TypeError, ValueError):
        max_m = 5.0
    m_pct = float(mismatch_rate) * 100.0
    if m_pct > max_m:
        return "DECREASE", f"mismatch_rate={m_pct:.2f}% > max={max_m}"
    try:
        min_c = float(getattr(settings, "AUTO_ROLLOUT_MIN_CONF_DELTA", -0.02) or -0.02)
    except (TypeError, ValueError):
        min_c = -0.02
    # Signed mean (split - single) confidence; same signal as A/B readiness heuristics.
    if conf_delta >= min_c:
        return "INCREASE", f"mean_conf_split_minus_single={conf_delta:.4f} >= {min_c}"
    return "HOLD", f"conf_delta={conf_delta:.4f} < {min_c} and mismatch within bound"


def maybe_step_auto_rollout() -> None:
    """
    Call after a new A/B row is persisted. Cooldown and manual overrides are enforced here.
    """
    if not getattr(settings, "AUTO_ROLLOUT_ENABLED", False):
        return
    if getattr(settings, "ASSESSMENT_GRADER_FORCE_SINGLE_MODE", False):
        logger.debug("auto_rollout: skip (FORCE_SINGLE_MODE)")
        return
    if getattr(settings, "ASSESSMENT_GRADER_FORCE_SPLIT_MODE", False):
        logger.debug("auto_rollout: skip (FORCE_SPLIT_MODE)")
        return
    if not getattr(settings, "ASSESSMENT_GRADER_SPLIT_ENABLED", False):
        logger.debug("auto_rollout: skip (SPLIT_ENABLED is false; no auto adjustment)")
        return
    now = time.time()
    try:
        cd = int(getattr(settings, "AUTO_ROLLOUT_COOLDOWN_SECONDS", 600) or 0)
    except (TypeError, ValueError):
        cd = 600
    try:
        min_s = int(getattr(settings, "AUTO_ROLLOUT_MIN_SAMPLES", 50) or 0)
    except (TypeError, ValueError):
        min_s = 50
    try:
        agg = compute_aggregate_from_samples()
    except Exception:
        logger.debug("auto_rollout: compute_aggregate_from_samples failed", exc_info=True)
        return
    n = int(agg.get("total_samples", 0) or 0)
    m_rate = float(agg.get("mismatch_rate", 0) or 0.0)
    conf_delta = float(agg.get("mean_confidence_split_minus_single", 0) or 0.0)
    if n < min_s:
        logger.debug("auto_rollout: hold — samples %s < %s", n, min_s)
        return

    st = _load_state()
    if st is None:
        try:
            seed = int(getattr(settings, "ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT", 0) or 0)
        except (TypeError, ValueError):
            seed = 0
        st = _default_state(seed)
        _save_state(st)

    last_ts = float(st.get("last_update_ts", 0) or 0)
    if cd > 0 and (now - last_ts) < float(cd) and last_ts > 0:
        logger.debug("auto_rollout: cooldown (%.0fs < %ss)", now - last_ts, cd)
        return

    action, reason = _decide_action(n, m_rate, conf_delta)
    try:
        up = int(getattr(settings, "AUTO_ROLLOUT_STEP_UP", 10) or 0)
    except (TypeError, ValueError):
        up = 10
    try:
        down = int(getattr(settings, "AUTO_ROLLOUT_STEP_DOWN", 10) or 0)
    except (TypeError, ValueError):
        down = 10
    old = int(st.get("rollout_percent", 0) or 0)
    if action == "INCREASE":
        new = _clamp_rollout(old + up)
    elif action == "DECREASE":
        new = _clamp_rollout(old - down)
    else:
        new = _clamp_rollout(old)

    final_action = action
    final_reason = reason
    if action == "INCREASE" and new == old and up > 0:
        final_action = "HOLD"
        final_reason = reason + " (at cap, no change)"
    elif action == "DECREASE" and new == old and down > 0:
        final_action = "HOLD"
        final_reason = reason + " (at floor, no change)"
    st["rollout_percent"] = new
    st["last_update_ts"] = now
    st["last_action"] = final_action
    st["last_reason"] = final_reason
    _save_state(st)
    # Grep-friendly: "AutoRollout" (ops checklist after enabling AUTO_ROLLOUT_ENABLED).
    logger.info(
        "AutoRollout decision=%s old_rollout=%s new_rollout=%s samples=%s "
        "mismatch_rate=%.4f mean_conf_split_minus_single=%.4f reason=%s",
        final_action,
        old,
        new,
        n,
        m_rate,
        conf_delta,
        final_reason,
    )
