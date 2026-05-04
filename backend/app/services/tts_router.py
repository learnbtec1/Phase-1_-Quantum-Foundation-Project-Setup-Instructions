# -*- coding: utf-8 -*-
"""
Pluggable TTS router — all provider selection lives here, not in FastAPI endpoints.

Order comes from TTS_FALLBACK_CHAIN or defaults derived from TTS_PROVIDER / request mode.
Health-aware: skips unhealthy providers before invoking synthesize.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import List, Sequence

import httpx

from app.services.tts_cache import get_cached, set_cached
from app.services.tts_context import SynthesisContext
from app.services.tts_exceptions import AllTTSProvidersFailedError, FatalTTSError
from app.services.tts_metrics import record_cache_hit, record_failure, record_request, record_success
from app.services.providers import (
    EdgeTTSProvider,
    ElevenLabsTTSProvider,
    LocalPiperProvider,
    TTSProvider,
    XTTSTTSProvider,
)
from app.services.providers.base import TTSSynthesisResult

logger = logging.getLogger(__name__)

_REGISTRY: dict[str, type[TTSProvider]] = {
    "elevenlabs": ElevenLabsTTSProvider,
    "edge": EdgeTTSProvider,
    "local": LocalPiperProvider,
    "local_piper": LocalPiperProvider,
    "xtts": XTTSTTSProvider,
}


def _parse_chain(raw: str) -> List[str]:
    parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
    out: List[str] = []
    for p in parts:
        if p == "local":
            out.append("local_piper")
        elif p in _REGISTRY:
            out.append(p)
        else:
            logger.warning("[TTSRouter] unknown chain token %r — skipped", p)
    return out


def default_chain_for_mode(
    env_provider: str,
    *,
    payload_forces_edge: bool,
    payload_forces_local: bool = False,
    allow_edge_after_elevenlabs: bool,
) -> List[str]:
    """Backward-compatible defaults when TTS_FALLBACK_CHAIN is unset."""
    if payload_forces_local:
        custom = (os.getenv("TTS_FALLBACK_CHAIN") or "").strip()
        if custom:
            chain = _parse_chain(custom)
            chain = [p for p in chain if p in ("local_piper", "edge", "elevenlabs", "xtts")]
            if chain:
                return _apply_edge_policy(
                    chain,
                    env_provider,
                    allow_edge_after_elevenlabs,
                    payload_forces_edge,
                    payload_forces_local=True,
                )
        return ["local_piper", "elevenlabs"]

    custom = (os.getenv("TTS_FALLBACK_CHAIN") or "").strip()
    if custom:
        chain = _parse_chain(custom)
        if chain:
            return _apply_edge_policy(
                chain,
                env_provider,
                allow_edge_after_elevenlabs,
                payload_forces_edge,
                False,
            )

    env_provider = env_provider.lower().strip()
    # Default (VPS / cloud): Piper first — Edge is often blocked (403) on datacenter IPs.
    if payload_forces_edge:
        chain = ["edge", "local_piper", "elevenlabs"]
    elif env_provider == "elevenlabs":
        chain = ["local_piper", "elevenlabs"]
    elif env_provider == "local":
        chain = ["local_piper", "elevenlabs"]
    else:
        chain = ["local_piper", "elevenlabs"]

    return _apply_edge_policy(
        chain,
        env_provider,
        allow_edge_after_elevenlabs,
        payload_forces_edge,
        False,
    )


def _apply_edge_policy(
    chain: Sequence[str],
    env_provider: str,
    allow_edge_after_elevenlabs: bool,
    payload_forces_edge: bool,
    payload_forces_local: bool,
) -> List[str]:
    if payload_forces_local:
        return [p for p in chain if p in ("local_piper", "edge", "elevenlabs", "xtts")]
    if payload_forces_edge:
        return [p for p in chain if p in ("edge", "local_piper", "elevenlabs", "xtts")]
    if env_provider == "elevenlabs" and not allow_edge_after_elevenlabs:
        return [p for p in chain if p != "edge"]
    return list(chain)


def _instantiate(name: str) -> TTSProvider:
    if name == "local_piper":
        return LocalPiperProvider()
    cls = _REGISTRY.get(name)
    if cls is None:
        raise KeyError(name)
    return cls()


def _is_timeout_error(exc: BaseException) -> bool:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    return isinstance(exc, httpx.TimeoutException)


def _validate_tts_text(text: str) -> str:
    """Normalize input and enforce max length (abuse guard for all router entry points)."""
    s = (text or "").strip()
    if not s:
        raise ValueError("TTS text is empty")
    max_len = max(1, int(os.getenv("TTS_ROUTER_MAX_TEXT_CHARS", "12000")))
    if len(s) > max_len:
        raise ValueError(f"TTS text exceeds maximum length ({max_len} characters)")
    return s


class TTSRouter:
    """Try healthy providers in order until one returns TTSSynthesisResult."""

    async def synthesize(self, text: str, ctx: SynthesisContext, chain: List[str]) -> TTSSynthesisResult:
        text = _validate_tts_text(text)
        rid = getattr(ctx, "request_id", None)
        record_request()
        t0 = time.perf_counter()
        slow_ms = float(os.getenv("TTS_SLOW_REQUEST_WARN_MS", "15000"))

        cached = get_cached(chain, text, ctx)
        if cached is not None:
            record_cache_hit()
            record_ms = (time.perf_counter() - t0) * 1000.0
            record_success(
                record_ms, cached.provider_id, from_cache=True, fallback_used=False
            )
            if record_ms > slow_ms:
                logger.warning(
                    "[TTSRouter] slow_request source=cache request_id=%s latency_ms=%.1f",
                    rid,
                    record_ms,
                )
            return cached

        providers: List[tuple[str, TTSProvider]] = []
        for name in chain:
            try:
                p = _instantiate(name)
            except KeyError:
                continue
            if not p.is_available():
                logger.debug("[TTSRouter] skip unavailable provider %s", name)
                continue
            if not await p.is_healthy():
                logger.info(
                    "[TTSRouter] skip_unhealthy request_id=%s provider=%s",
                    rid,
                    name,
                )
                continue
            providers.append((name, p))

        resolved_names = [n for n, _ in providers]
        logger.info(
            "[TTSRouter] synthesize_start request_id=%s chain=%s resolved_providers=%s text_len=%s",
            rid,
            chain,
            resolved_names,
            len(text),
        )

        if not providers:
            record_failure()
            logger.error(
                "NO_TTS_PROVIDER_AVAILABLE request_id=%s chain=%s reason=no_healthy_or_configured "
                "(set LOCAL_TTS_URL or ELEVENLABS_API_KEY; Edge often blocked on cloud IPs)",
                rid,
                chain,
            )
            raise AllTTSProvidersFailedError(
                "No healthy TTS providers available for this chain (check keys, LOCAL_TTS_URL, Piper).",
                None,
            )

        last_exc: Exception | None = None
        for idx, (name, provider) in enumerate(providers):
            for attempt in range(2):
                try:
                    result = await provider.synthesize(text, ctx)
                    lat_ms = (time.perf_counter() - t0) * 1000.0
                    fb = idx > 0
                    record_success(
                        lat_ms,
                        result.provider_id,
                        from_cache=False,
                        fallback_used=fb,
                    )
                    if fb:
                        logger.info(
                            "[TTSRouter] fallback_success request_id=%s provider=%s provider_index=%s",
                            rid,
                            name,
                            idx,
                        )
                    if lat_ms > slow_ms:
                        logger.warning(
                            "[TTSRouter] slow_request request_id=%s latency_ms=%.1f provider=%s fallback_used=%s",
                            rid,
                            lat_ms,
                            result.provider_id,
                            fb,
                        )
                    set_cached(chain, text, result, ctx)
                    return result
                except FatalTTSError:
                    record_failure()
                    raise
                except Exception as e:
                    last_exc = e
                    if attempt == 0 and _is_timeout_error(e):
                        logger.warning(
                            "[TTSRouter] provider_timeout request_id=%s provider=%s retry=1/2 exc=%s",
                            rid,
                            name,
                            type(e).__name__,
                        )
                        continue
                    logger.warning(
                        "[TTSRouter] provider_failed request_id=%s provider=%s is_timeout=%s error=%s",
                        rid,
                        name,
                        _is_timeout_error(e),
                        str(e)[:280],
                    )
                    if idx + 1 < len(providers):
                        logger.info(
                            "[TTSRouter] fallback_event request_id=%s from_provider=%s to_provider=%s",
                            rid,
                            name,
                            providers[idx + 1][0],
                        )
                    break

        record_failure()
        logger.error(
            "NO_TTS_PROVIDER_AVAILABLE request_id=%s chain=%s last_error=%s",
            rid,
            chain,
            type(last_exc).__name__ if last_exc else None,
        )
        raise AllTTSProvidersFailedError(
            "All configured TTS providers failed for this request.",
            last_exc,
        )


_router_singleton: TTSRouter | None = None


def get_tts_router() -> TTSRouter:
    global _router_singleton
    if _router_singleton is None:
        _router_singleton = TTSRouter()
    return _router_singleton
