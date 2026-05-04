# -*- coding: utf-8 -*-
"""Thread-safe aggregates for TTS router observability (enterprise-style counters)."""
from __future__ import annotations

import os
from collections import deque
from threading import Lock
from typing import Any, Dict

_lock = Lock()
_tts_requests_total = 0
_tts_failures_total = 0
_tts_cache_hits_total = 0
_latency_sum_ms = 0.0
_latency_count = 0
_provider_usage: Dict[str, int] = {}
_tts_live_success_total = 0
_tts_fallback_success_total = 0

_latency_samples: deque[float] = deque(
    maxlen=max(64, int(os.getenv("TTS_METRICS_LATENCY_BUFFER", "2048")))
)

# Piper (local_tts) concurrency gate — queue wait + active in-flight HTTP calls
_piper_active_requests = 0
_piper_queue_wait_sum_ms = 0.0
_piper_queue_wait_count = 0
_piper_rejections_total = 0
_piper_instance_usage: Dict[str, int] = {}
_piper_instance_failures: Dict[str, int] = {}
_piper_hedge_spawn_total = 0
_piper_hedge_success_total = 0


def _percentile(samples: list[float], p: float) -> float:
    if not samples:
        return 0.0
    xs = sorted(samples)
    n = len(xs)
    if n == 1:
        return xs[0]
    k = (n - 1) * p
    f = int(k)
    c = min(f + 1, n - 1)
    if f == c:
        return xs[f]
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def record_request() -> None:
    global _tts_requests_total
    with _lock:
        _tts_requests_total += 1


def record_cache_hit() -> None:
    global _tts_cache_hits_total
    with _lock:
        _tts_cache_hits_total += 1


def record_success(
    latency_ms: float,
    provider_id: str,
    *,
    from_cache: bool = False,
    fallback_used: bool = False,
) -> None:
    global _latency_sum_ms, _latency_count, _provider_usage
    global _tts_live_success_total, _tts_fallback_success_total
    with _lock:
        lat = max(0.0, float(latency_ms))
        _latency_sum_ms += lat
        _latency_count += 1
        _latency_samples.append(lat)
        _provider_usage[provider_id] = _provider_usage.get(provider_id, 0) + 1
        if not from_cache:
            _tts_live_success_total += 1
            if fallback_used:
                _tts_fallback_success_total += 1


def record_failure() -> None:
    global _tts_failures_total
    with _lock:
        _tts_failures_total += 1


def record_piper_queue_wait(wait_ms: float) -> None:
    """Time spent waiting for a Piper slot (semaphore) before the HTTP call."""
    global _piper_queue_wait_sum_ms, _piper_queue_wait_count
    with _lock:
        _piper_queue_wait_sum_ms += max(0.0, float(wait_ms))
        _piper_queue_wait_count += 1


def piper_active_increment() -> None:
    global _piper_active_requests
    with _lock:
        _piper_active_requests += 1


def piper_active_decrement() -> None:
    global _piper_active_requests
    with _lock:
        _piper_active_requests = max(0, _piper_active_requests - 1)


def record_piper_rejection() -> None:
    """Reserved for fast-fail when Piper queue is saturated (optional policy)."""
    global _piper_rejections_total
    with _lock:
        _piper_rejections_total += 1


def record_piper_instance_use(instance_key: str) -> None:
    global _piper_instance_usage
    with _lock:
        _piper_instance_usage[instance_key] = _piper_instance_usage.get(instance_key, 0) + 1


def record_piper_instance_failure(instance_key: str) -> None:
    global _piper_instance_failures
    with _lock:
        _piper_instance_failures[instance_key] = _piper_instance_failures.get(instance_key, 0) + 1


def record_piper_hedge_spawn() -> None:
    global _piper_hedge_spawn_total
    with _lock:
        _piper_hedge_spawn_total += 1


def record_piper_hedge_success() -> None:
    global _piper_hedge_success_total
    with _lock:
        _piper_hedge_success_total += 1


def snapshot() -> Dict[str, Any]:
    with _lock:
        avg = (_latency_sum_ms / _latency_count) if _latency_count else 0.0
        qw_avg = (
            (_piper_queue_wait_sum_ms / _piper_queue_wait_count)
            if _piper_queue_wait_count
            else 0.0
        )
        limit = max(1, int(os.getenv("PIPER_CONCURRENCY_LIMIT", "2")))
        pool_raw = os.getenv("LOCAL_TTS_URLS", "").strip()
        if pool_raw:
            pool_n = max(1, len([x for x in pool_raw.split(",") if x.strip()]))
        elif (os.getenv("LOCAL_TTS_URL", "") or "").strip():
            pool_n = 1
        else:
            pool_n = 0
        cap = limit * pool_n if pool_n else limit
        lat_copy = list(_latency_samples)
        p95 = round(_percentile(lat_copy, 0.95), 2)
        p99 = round(_percentile(lat_copy, 0.99), 2)
        fb_rate = (
            round(_tts_fallback_success_total / max(1, _tts_live_success_total), 6)
            if _tts_live_success_total
            else 0.0
        )
        hedge_ok_rate = (
            round(_piper_hedge_success_total / max(1, _piper_hedge_spawn_total), 6)
            if _piper_hedge_spawn_total
            else 0.0
        )
        return {
            "tts_requests_total": _tts_requests_total,
            "tts_failures_total": _tts_failures_total,
            "tts_cache_hits_total": _tts_cache_hits_total,
            "tts_latency_ms_avg": round(avg, 2),
            "tts_latency_ms_p95": p95,
            "tts_latency_ms_p99": p99,
            "tts_latency_samples": _latency_count,
            "tts_live_success_total": _tts_live_success_total,
            "tts_fallback_success_total": _tts_fallback_success_total,
            "tts_fallback_rate": fb_rate,
            "tts_provider_usage": dict(_provider_usage),
            "piper_active_requests": _piper_active_requests,
            "piper_queue_wait_avg_ms": round(qw_avg, 2),
            "piper_queue_wait_samples": _piper_queue_wait_count,
            "piper_rejections_total": _piper_rejections_total,
            "piper_concurrency_limit": limit,
            "piper_pool_size": pool_n,
            "piper_effective_concurrency_cap": cap,
            "piper_instance_usage": dict(_piper_instance_usage),
            "piper_instance_failures": dict(_piper_instance_failures),
            "piper_hedge_spawn_total": _piper_hedge_spawn_total,
            "piper_hedge_success_total": _piper_hedge_success_total,
            "piper_hedge_success_rate": hedge_ok_rate,
        }
