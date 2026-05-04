# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
import threading
import time
from urllib.parse import urlparse

import httpx

from app.services.audio_ffmpeg import TARGET_TTS_SAMPLE_RATE_HZ, normalize_mp3_to_24k_hz
from app.services.tts_context import SynthesisContext
from app.services.tts_metrics import (
    piper_active_decrement,
    piper_active_increment,
    record_piper_hedge_spawn,
    record_piper_hedge_success,
    record_piper_instance_failure,
    record_piper_instance_use,
    record_piper_queue_wait,
)
from app.services.providers.base import TTSProvider, TTSSynthesisResult

logger = logging.getLogger(__name__)

PIPER_CONCURRENCY_LIMIT = max(1, int(os.getenv("PIPER_CONCURRENCY_LIMIT", "2")))
PIPER_INSTANCE_UNHEALTHY_SEC = float(os.getenv("PIPER_INSTANCE_UNHEALTHY_SEC", "10"))

_semaphores: dict[str, asyncio.Semaphore] = {}
_sem_create_lock = threading.Lock()

_rr_lock = asyncio.Lock()
_rr_index = 0

_wrr_current: dict[str, int] = {}
_weights_mismatch_logged = False

_unhealthy_until: dict[str, float] = {}


def _piper_metric_key(synthesize_url: str) -> str:
    try:
        p = urlparse(synthesize_url)
        host = p.hostname or "unknown"
        port = p.port or (443 if p.scheme == "https" else 80)
        return f"{host}:{port}"
    except Exception:
        return synthesize_url[:96]


def _normalize_synthesize_url(raw: str) -> str:
    s = raw.strip().rstrip("/")
    if not s.endswith("/synthesize"):
        s = f"{s}/synthesize"
    return s


def _parse_env_synthesize_urls() -> list[str]:
    multi = os.getenv("LOCAL_TTS_URLS", "").strip()
    out: list[str] = []
    if multi:
        for part in multi.split(","):
            p = part.strip()
            if p:
                out.append(_normalize_synthesize_url(p))
        return out
    single = (os.getenv("LOCAL_TTS_URL", "") or "").strip()
    if single:
        return [_normalize_synthesize_url(single)]
    return []


def _get_semaphore(synthesize_url: str) -> asyncio.Semaphore:
    with _sem_create_lock:
        if synthesize_url not in _semaphores:
            _semaphores[synthesize_url] = asyncio.Semaphore(PIPER_CONCURRENCY_LIMIT)
        return _semaphores[synthesize_url]


def _health_url_from_synthesize(synth_url: str) -> str:
    if synth_url.endswith("/synthesize"):
        return synth_url[: -len("/synthesize")] + "/health"
    if synth_url.endswith("/"):
        return synth_url + "health"
    return synth_url.rsplit("/", 1)[0] + "/health"


def _is_url_temporarily_unhealthy(synth_url: str) -> bool:
    until = _unhealthy_until.get(synth_url)
    if until is None:
        return False
    if time.monotonic() >= until:
        del _unhealthy_until[synth_url]
        return False
    return True


def _mark_instance_unhealthy(synth_url: str) -> None:
    _unhealthy_until[synth_url] = time.monotonic() + PIPER_INSTANCE_UNHEALTHY_SEC
    record_piper_instance_failure(_piper_metric_key(synth_url))
    logger.info(
        "[LocalPiper] instance %s marked unhealthy for %.1fs",
        _piper_metric_key(synth_url),
        PIPER_INSTANCE_UNHEALTHY_SEC,
    )


def _parse_weights_for_urls(urls: list[str]) -> dict[str, int] | None:
    global _weights_mismatch_logged
    raw = (os.getenv("LOCAL_TTS_WEIGHTS", "") or "").strip()
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) != len(urls):
        if not _weights_mismatch_logged:
            logger.warning(
                "[LocalPiper] LOCAL_TTS_WEIGHTS count (%d) != URL count (%d) — plain RR",
                len(parts),
                len(urls),
            )
            _weights_mismatch_logged = True
        return None
    out: dict[str, int] = {}
    for u, p in zip(urls, parts):
        try:
            out[u] = max(1, min(100, int(p)))
        except ValueError:
            if not _weights_mismatch_logged:
                logger.warning("[LocalPiper] LOCAL_TTS_WEIGHTS invalid — plain RR")
                _weights_mismatch_logged = True
            return None
    return out


async def _pick_rr_round_robin(urls: list[str]) -> str:
    global _rr_index
    if len(urls) == 1:
        return urls[0]
    async with _rr_lock:
        n = len(urls)
        for offset in range(n):
            idx = (_rr_index + offset) % n
            u = urls[idx]
            if not _is_url_temporarily_unhealthy(u):
                _rr_index = (idx + 1) % n
                return u
        u = urls[_rr_index % n]
        _rr_index = (_rr_index + 1) % n
        return u


async def _pick_weighted(urls: list[str], weights: dict[str, int]) -> str:
    healthy = [u for u in urls if not _is_url_temporarily_unhealthy(u)]
    if not healthy:
        return await _pick_rr_round_robin(urls)
    async with _rr_lock:
        tw = sum(weights.get(u, 1) for u in healthy)
        for u in healthy:
            _wrr_current[u] = _wrr_current.get(u, 0) + weights.get(u, 1)
        best = max(healthy, key=lambda x: _wrr_current[x])
        _wrr_current[best] -= tw
        return best


async def _pick_backend_url(urls: list[str]) -> str:
    if len(urls) == 1:
        return urls[0]
    wm = _parse_weights_for_urls(urls)
    if wm:
        return await _pick_weighted(urls, wm)
    return await _pick_rr_round_robin(urls)


async def _pick_alternate_subset(urls: list[str], avoid: str) -> str | None:
    sub = [u for u in urls if u != avoid]
    if not sub:
        return None
    return await _pick_backend_url(sub)


async def _race_first_ok(
    task_p: asyncio.Task,
    url_p: str,
    task_s: asyncio.Task,
    url_s: str,
) -> tuple[TTSSynthesisResult, str]:
    pending: set[asyncio.Task] = {task_p, task_s}
    errors: list[BaseException] = []
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            try:
                out = t.result()
                winner = url_p if t is task_p else url_s
                for o in pending:
                    o.cancel()
                for o in pending:
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await o
                return out, winner
            except BaseException as e:
                errors.append(e)
    if errors:
        raise errors[0]
    raise RuntimeError("Piper hedge race produced no result")


def _hedge_ms() -> float:
    try:
        return float(os.getenv("PIPER_HEDGE_AFTER_MS", "0"))
    except ValueError:
        return 0.0


def _piper_http_timeout_sec(ctx: SynthesisContext) -> float:
    env_raw = os.getenv("PIPER_HTTP_TIMEOUT_SEC", os.getenv("PIPER_TIMEOUT", "8"))
    try:
        env_t = float(env_raw)
    except ValueError:
        env_t = 8.0
    return max(1.0, min(env_t, float(ctx.local_timeout_sec)))


class LocalPiperProvider(TTSProvider):
    """HTTP client to one or more local_tts (Piper) instances — WRR, optional hedge, per-node semaphores."""

    name = "local_piper"

    def __init__(self, base_url: str | None = None) -> None:
        self._override_url: str | None = None
        if base_url is not None:
            s = base_url.strip()
            if s:
                self._override_url = _normalize_synthesize_url(s)

    def _urls_for(self) -> list[str]:
        if self._override_url:
            return [self._override_url]
        return _parse_env_synthesize_urls()

    def is_available(self) -> bool:
        return bool(self._urls_for())

    async def is_healthy(self) -> bool:
        urls = self._urls_for()
        if not urls:
            return False
        force_health = (os.getenv("LOCAL_TTS_HEALTH_URL") or "").strip()
        timeout = float(os.getenv("LOCAL_TTS_HEALTH_TIMEOUT_SEC", "2"))
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if force_health:
                    r = await client.get(force_health)
                    if r.status_code != 200:
                        return False
                    try:
                        data = r.json()
                        return bool(data.get("ok", True))
                    except Exception:
                        return True
                for u in urls:
                    if _is_url_temporarily_unhealthy(u):
                        continue
                    h = _health_url_from_synthesize(u)
                    try:
                        r = await client.get(h)
                        if r.status_code != 200:
                            continue
                        try:
                            data = r.json()
                            if not bool(data.get("ok", True)):
                                continue
                        except Exception:
                            pass
                        return True
                    except Exception as e:
                        logger.debug("[LocalPiper] health %s failed: %s", h, e)
                        continue
        except Exception as e:
            logger.debug("[LocalPiper] health batch failed: %s", e)
            return False
        return False

    async def synthesize(self, text: str, ctx: SynthesisContext) -> TTSSynthesisResult:
        urls = self._urls_for()
        if not urls:
            raise RuntimeError("LOCAL_TTS_URL is not set")

        hms = _hedge_ms()
        if len(urls) >= 2 and hms > 0.0:
            return await self._synthesize_hedged(text, ctx, urls, hms)
        return await self._synthesize_direct(text, ctx, urls)

    async def _synthesize_direct(self, text: str, ctx: SynthesisContext, urls: list[str]) -> TTSSynthesisResult:
        picked = await _pick_backend_url(urls)
        sem = _get_semaphore(picked)
        t_queue = time.perf_counter()
        await sem.acquire()
        record_piper_queue_wait((time.perf_counter() - t_queue) * 1000.0)
        piper_active_increment()
        try:
            result = await self._post_synthesize(text, ctx, picked)
            record_piper_instance_use(_piper_metric_key(picked))
            return result
        except Exception:
            _mark_instance_unhealthy(picked)
            raise
        finally:
            piper_active_decrement()
            sem.release()

    async def _synthesize_hedged(self, text: str, ctx: SynthesisContext, urls: list[str], hedge_ms: float) -> TTSSynthesisResult:
        primary = await _pick_backend_url(urls)
        sem_p = _get_semaphore(primary)
        t_queue = time.perf_counter()
        await sem_p.acquire()
        record_piper_queue_wait((time.perf_counter() - t_queue) * 1000.0)
        piper_active_increment()

        task_p: asyncio.Task = asyncio.create_task(self._post_synthesize(text, ctx, primary))
        sem_s: asyncio.Semaphore | None = None
        task_s: asyncio.Task | None = None
        secondary_url: str | None = None

        try:
            try:
                out = await asyncio.wait_for(asyncio.shield(task_p), hedge_ms / 1000.0)
                record_piper_instance_use(_piper_metric_key(primary))
                return out
            except asyncio.TimeoutError:
                secondary_url = await _pick_alternate_subset(urls, primary)
                if secondary_url is None:
                    out = await task_p
                    record_piper_instance_use(_piper_metric_key(primary))
                    return out
                sem_s = _get_semaphore(secondary_url)
                t2 = time.perf_counter()
                await sem_s.acquire()
                record_piper_queue_wait((time.perf_counter() - t2) * 1000.0)
                piper_active_increment()
                record_piper_hedge_spawn()
                logger.info(
                    "[LocalPiper] hedge_trigger request_id=%s primary=%s secondary=%s hedge_ms=%.1f",
                    getattr(ctx, "request_id", None),
                    primary,
                    secondary_url,
                    hedge_ms,
                )
                task_s = asyncio.create_task(self._post_synthesize(text, ctx, secondary_url))
                out, winner = await _race_first_ok(task_p, primary, task_s, secondary_url)
                record_piper_hedge_success()
                record_piper_instance_use(_piper_metric_key(winner))
                return out
        except Exception:
            _mark_instance_unhealthy(primary)
            if task_s is not None and secondary_url is not None:
                _mark_instance_unhealthy(secondary_url)
            raise
        finally:
            piper_active_decrement()
            sem_p.release()
            if sem_s is not None:
                piper_active_decrement()
                sem_s.release()
            if not task_p.done():
                task_p.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task_p
            if task_s is not None and not task_s.done():
                task_s.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task_s

    async def _post_synthesize(self, text: str, ctx: SynthesisContext, synthesize_url: str) -> TTSSynthesisResult:
        timeout_sec = _piper_http_timeout_sec(ctx)
        timeout = httpx.Timeout(timeout_sec)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(
                    synthesize_url,
                    json={"text": text},
                    headers={"Content-Type": "application/json"},
                )
                r.raise_for_status()
                data = r.json()
        except httpx.TimeoutException as e:
            logger.warning("[LocalPiper] HTTP timeout after %.1fs: %s", timeout_sec, e)
            raise
        except httpx.HTTPError as e:
            logger.warning("[LocalPiper] HTTP error: %s", e)
            raise RuntimeError(f"Local TTS HTTP failed: {e}") from e

        b64 = data.get("audio_base64")
        if not isinstance(b64, str) or not b64.strip():
            raise RuntimeError("Local TTS returned no audio_base64")
        try:
            mp3 = base64.b64decode(b64, validate=True)
        except Exception as e:
            raise RuntimeError("Local TTS invalid base64") from e
        if len(mp3) < 32:
            raise RuntimeError("Local TTS returned short audio")
        mp3 = normalize_mp3_to_24k_hz(mp3)
        if len(mp3) < 32:
            raise RuntimeError("Local TTS returned short audio after normalize")
        fmt = (data.get("format") or "mp3").lower()
        if fmt != "mp3":
            logger.warning("[LocalPiper] expected format=mp3, got %s — client may fail", fmt)
        provider = str(data.get("provider") or "local_piper")
        voice = str(data.get("voice") or "piper")
        return TTSSynthesisResult(
            audio_mp3=mp3,
            provider_id=provider,
            sample_rate=TARGET_TTS_SAMPLE_RATE_HZ,
            voice_label=voice,
        )
