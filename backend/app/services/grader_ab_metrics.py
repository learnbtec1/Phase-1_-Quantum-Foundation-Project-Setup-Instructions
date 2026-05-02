# -*- coding: utf-8 -*-
"""
Single vs split grader A/B: comparison helpers, logging, and persistence via grader_ab_store
(Redis + JSON fallback; distributed-safe when ASSESSMENT_AB_USE_REDIS and REDIS_URL are set).
Shadow runs do not change billing or the returned grade.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from app.services.grader_ab_store import append_grader_ab_row, compute_aggregate_from_samples, get_full_summary

logger = logging.getLogger(__name__)


def _mean_confidence(d: Dict[str, Any]) -> float:
    cr = d.get("criteria_results") or []
    vals: List[float] = []
    for x in cr:
        if isinstance(x, dict) and isinstance(x.get("confidence"), (int, float)):
            vals.append(float(x["confidence"]))
    return sum(vals) / len(vals) if vals else 0.0


def _compare_grader_outputs(single: Dict[str, Any], split: Dict[str, Any]) -> Dict[str, Any]:
    b1, b2 = single.get("grade_band"), split.get("grade_band")
    band_mismatch = b1 != b2
    cr1 = single.get("criteria_results") or []
    cr2 = split.get("criteria_results") or []
    by2 = {str(r.get("code")): r for r in cr2 if isinstance(r, dict)}
    ach_diff = 0
    paired = 0
    conf_abs = 0.0
    conf_n = 0
    for r in cr1:
        if not isinstance(r, dict):
            continue
        code = str(r.get("code") or "")
        o2 = by2.get(code)
        if not o2:
            continue
        paired += 1
        if bool(r.get("achieved")) != bool(o2.get("achieved")):
            ach_diff += 1
        c1, c2 = r.get("confidence"), o2.get("confidence")
        if isinstance(c1, (int, float)) and isinstance(c2, (int, float)):
            conf_abs += abs(float(c1) - float(c2))
            conf_n += 1
    avg_conf_delta = conf_abs / conf_n if conf_n else 0.0
    mismatch = bool(band_mismatch) or ach_diff > 0
    m_s = _mean_confidence(single)
    m_sp = _mean_confidence(split)
    return {
        "mismatch": mismatch,
        "band_mismatch": band_mismatch,
        "achieved_diff_count": ach_diff,
        "paired_rows": paired,
        "avg_abs_confidence_delta": avg_conf_delta,
        "mean_conf_single": m_s,
        "mean_conf_split": m_sp,
    }


def record_grader_ab_pair(single: Dict[str, Any], split: Dict[str, Any]) -> None:
    """Persist compact row, log, optional recommendation (never changes rollout in code)."""
    from app.core.config import settings

    row = _compare_grader_outputs(single, split)
    store_row = {
        "mismatch": bool(row["mismatch"]),
        "band_mismatch": bool(row["band_mismatch"]),
        "achieved_diff_count": int(row["achieved_diff_count"]),
        "avg_abs_confidence_delta": float(row["avg_abs_confidence_delta"]),
        "mean_conf_single": float(row["mean_conf_single"]),
        "mean_conf_split": float(row["mean_conf_split"]),
    }
    append_grader_ab_row(store_row)
    logger.info(
        "grader_ab sample mismatch=%s band_single=%s band_split=%s ach_diff=%s paired=%s "
        "avg_abs_dconf=%.4f mean_conf_single=%.3f mean_conf_split=%.3f",
        row["mismatch"],
        single.get("grade_band"),
        split.get("grade_band"),
        row["achieved_diff_count"],
        row["paired_rows"],
        row["avg_abs_confidence_delta"],
        row["mean_conf_single"],
        row["mean_conf_split"],
    )
    _maybe_emit_recommendation(settings)


def _aggregate() -> Tuple[int, float, float, float]:
    """From persisted samples: n, mismatch_rate, avg_abs_conf_delta, mean conf shift."""
    agg = compute_aggregate_from_samples()
    n = int(agg["total_samples"])
    if n == 0:
        return 0, 0.0, 0.0, 0.0
    return (
        n,
        float(agg["mismatch_rate"]),
        float(agg["avg_abs_confidence_delta"]),
        float(agg["mean_confidence_split_minus_single"]),
    )


def _maybe_emit_recommendation(settings: Any) -> None:
    try:
        min_s = int(getattr(settings, "ASSESSMENT_AB_MIN_SAMPLES_FOR_RECOMMENDATION", 20) or 20)
    except (TypeError, ValueError):
        min_s = 20
    try:
        max_mis = float(getattr(settings, "ASSESSMENT_AB_MAX_MISMATCH_PCT", 5.0) or 5.0)
    except (TypeError, ValueError):
        max_mis = 5.0
    n, mis_rate, _avg_dconf, conf_improve = _aggregate()
    if n < max(5, min_s):
        return
    mis_pct = mis_rate * 100.0
    if mis_pct < max_mis and conf_improve >= -0.02:
        logger.info(
            "grader_ab RECOMMENDATION: consider raising ASSESSMENT_GRADER_SPLIT_ROLLOUT_PERCENT "
            "(persisted_samples=%s mismatch_rate=%.2f%% mean_conf_split_minus_single=%.4f) — manual only",
            n,
            mis_pct,
            conf_improve,
        )
    elif mis_pct >= max_mis:
        logger.info(
            "grader_ab RECOMMENDATION: keep or reduce split rollout (persisted_samples=%s mismatch_rate=%.2f%%)",
            n,
            mis_pct,
        )


def get_grader_ab_summary() -> Dict[str, Any]:
    """Aggregates + readiness + path (persisted; survives worker restart)."""
    return get_full_summary()
