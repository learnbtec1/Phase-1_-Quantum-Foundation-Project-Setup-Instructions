# -*- coding: utf-8 -*-
"""Edge TTS circuit breaker — shared by HTTP TTS and pluggable Edge provider."""
from __future__ import annotations

import logging
import time
from threading import Lock

logger = logging.getLogger(__name__)

_CB_LOCK = Lock()
_cb_failures: int = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD = 5
_CB_COOLDOWN = 20.0
# Set when Edge returns HTTP 403 / WebSocket blocked (typical on datacenter IPs). Cleared on tts_cb_record_success().
_edge_ws_forbidden: bool = False


def tts_cb_ok() -> bool:
    if _edge_ws_forbidden:
        return False
    return time.monotonic() >= _cb_open_until


def tts_cb_record_failure() -> None:
    global _cb_failures, _cb_open_until
    with _CB_LOCK:
        _cb_failures += 1
        if _cb_failures >= _CB_THRESHOLD:
            _cb_open_until = time.monotonic() + _CB_COOLDOWN
            logger.warning(
                "Edge TTS circuit OPENED — %d consecutive failures, cooldown %.0fs",
                _cb_failures,
                _CB_COOLDOWN,
            )


def tts_cb_record_success() -> None:
    global _cb_failures, _cb_open_until, _edge_ws_forbidden
    with _CB_LOCK:
        if _cb_failures:
            logger.info("Edge TTS circuit CLOSED after %d failure(s)", _cb_failures)
        _cb_failures = 0
        _cb_open_until = 0.0
        _edge_ws_forbidden = False


def tts_cb_record_edge_forbidden() -> None:
    """Edge WebSocket rejected (403 / blocked IP). Skip Edge until admin resets circuit or success clears it."""
    global _edge_ws_forbidden, _cb_failures, _cb_open_until
    with _CB_LOCK:
        already = _edge_ws_forbidden
        _edge_ws_forbidden = True
        _cb_failures = max(_cb_failures, _CB_THRESHOLD)
        _cb_open_until = float("inf")
    if not already:
        logger.error(
            "Edge TTS marked unhealthy: WebSocket blocked (HTTP 403 / datacenter IP). "
            "Use local Piper or ElevenLabs. Reset via POST /api/v1/tts-reset-circuit after fixing proxy."
        )


def tts_cb_snapshot() -> dict:
    with _CB_LOCK:
        ok = time.monotonic() >= _cb_open_until and not _edge_ws_forbidden
        return {
            "failures": _cb_failures,
            "open_until_monotonic": _cb_open_until,
            "circuit_closed": ok,
            "edge_ws_forbidden": _edge_ws_forbidden,
        }
