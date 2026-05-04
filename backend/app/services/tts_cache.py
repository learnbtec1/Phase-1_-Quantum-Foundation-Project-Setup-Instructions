# -*- coding: utf-8 -*-
"""
Best-effort TTS audio cache: Redis when REDIS_URL works, else in-process LRU.

v1 key = SHA-256(chain + text) — legacy; may return wrong audio if voice changed.
v2 key adds edge voice, ElevenLabs voice id, and optional TTS_CACHE_MODEL_TAG.
Lookups try v2 first (when context is passed). If TTS_CACHE_DISABLE_V1_FALLBACK is set,
v1 legacy keys are not read after a v2 miss (recommended for production).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from collections import OrderedDict
from threading import Lock
from typing import TYPE_CHECKING, Optional

from app.services.providers.base import TTSSynthesisResult

if TYPE_CHECKING:
    from app.services.tts_context import SynthesisContext

logger = logging.getLogger(__name__)

_ENABLED = (os.getenv("TTS_AUDIO_CACHE", "true") or "").strip().lower() in ("true", "1", "yes")
_COLLAPSE_WS = (os.getenv("TTS_CACHE_COLLAPSE_WHITESPACE", "false") or "").strip().lower() in (
    "true",
    "1",
    "yes",
)
_REDIS_TTL = int(os.getenv("TTS_CACHE_REDIS_TTL_SEC", "86400"))
_MEMORY_MAX = max(32, int(os.getenv("TTS_CACHE_MEMORY_MAX", "256")))

_mem_lock = Lock()
_memory: OrderedDict[str, TTSSynthesisResult] = OrderedDict()

_REDIS_PREFIX = "cogni:tts:audio:v1:"


def _cache_enabled() -> bool:
    return _ENABLED


def _normalize_cache_text(text: str) -> str:
    if _COLLAPSE_WS:
        return " ".join((text or "").split())
    return text or ""


def make_cache_key(chain: list[str], text: str) -> str:
    t = _normalize_cache_text(text)
    raw = "v1\n" + ",".join(chain) + "\n" + t
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def make_cache_key_v2(chain: list[str], text: str, ctx: "SynthesisContext") -> str:
    """Include voice context so cache entries do not bleed across voice changes."""
    t = _normalize_cache_text(text)
    ev = (ctx.edge_voice or "").strip().lower()
    el = (ctx.elevenlabs_voice_id or "").strip()
    extra = (os.getenv("TTS_CACHE_MODEL_TAG") or "").strip()
    raw = "v2\n" + ",".join(chain) + "\n" + ev + "\n" + el + "\n" + extra + "\n" + t
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _memory_touch(key: str) -> Optional[TTSSynthesisResult]:
    with _mem_lock:
        hit = _memory.pop(key, None)
        if hit is None:
            return None
        _memory[key] = hit
        return hit


def _memory_put(key: str, result: TTSSynthesisResult) -> None:
    with _mem_lock:
        _memory[key] = result
        while len(_memory) > _MEMORY_MAX:
            _memory.popitem(last=False)


def _v1_fallback_disabled() -> bool:
    raw = (os.getenv("TTS_CACHE_DISABLE_V1_FALLBACK") or "").strip().lower()
    return raw in ("true", "1", "yes")


def get_cached(
    chain: list[str], text: str, ctx: Optional["SynthesisContext"] = None
) -> Optional[TTSSynthesisResult]:
    if not _cache_enabled():
        return None

    v2_attempted = False
    if ctx is not None:
        v2_attempted = True
        key2 = make_cache_key_v2(chain, text, ctx)
        r = _redis_get(key2)
        if r is not None:
            return r
        hit = _memory_touch(key2)
        if hit is not None:
            return hit
        if _v1_fallback_disabled():
            logger.debug("[TTSCache] v2 miss; v1 fallback disabled (TTS_CACHE_DISABLE_V1_FALLBACK)")
            return None

    key = make_cache_key(chain, text)
    r = _redis_get(key)
    if r is not None:
        if v2_attempted:
            logger.info(
                "cache_v1_fallback_used chain=%s text_len=%s",
                ",".join(chain),
                len(text or ""),
            )
        return r
    hit = _memory_touch(key)
    if hit is not None and v2_attempted:
        logger.info(
            "cache_v1_fallback_used chain=%s text_len=%s",
            ",".join(chain),
            len(text or ""),
        )
    return hit


def set_cached(
    chain: list[str],
    text: str,
    result: TTSSynthesisResult,
    ctx: Optional["SynthesisContext"] = None,
) -> None:
    if not _cache_enabled():
        return
    if ctx is not None:
        key2 = make_cache_key_v2(chain, text, ctx)
        if _redis_set(key2, result):
            _memory_put(key2, result)
            return
        _memory_put(key2, result)
        return

    key = make_cache_key(chain, text)
    if _redis_set(key, result):
        return
    _memory_put(key, result)


def _redis_get(key: str) -> Optional[TTSSynthesisResult]:
    try:
        from app.core.redis_client import get_redis
    except Exception:
        return None
    client = get_redis()
    if not client:
        return None
    try:
        raw = client.get(_REDIS_PREFIX + key)
        if not raw:
            return None
        import json

        data = json.loads(raw)
        b64 = data.get("audio_mp3_b64")
        if not isinstance(b64, str):
            return None
        mp3 = base64.b64decode(b64, validate=True)
        return TTSSynthesisResult(
            audio_mp3=mp3,
            provider_id=str(data.get("provider_id", "")),
            sample_rate=int(data.get("sample_rate", 24000)),
            voice_label=str(data.get("voice_label", "")),
        )
    except Exception as e:
        logger.debug("[TTSCache] redis get failed: %s", e)
        return None


def _redis_set(key: str, result: TTSSynthesisResult) -> bool:
    try:
        from app.core.redis_client import get_redis
    except Exception:
        return False
    client = get_redis()
    if not client:
        return False
    try:
        import json

        payload = json.dumps(
            {
                "audio_mp3_b64": base64.b64encode(result.audio_mp3).decode("ascii"),
                "provider_id": result.provider_id,
                "sample_rate": result.sample_rate,
                "voice_label": result.voice_label,
            },
            ensure_ascii=False,
        )
        client.setex(_REDIS_PREFIX + key, _REDIS_TTL, payload)
        return True
    except Exception as e:
        logger.debug("[TTSCache] redis set failed: %s", e)
        return False
