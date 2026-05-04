# -*- coding: utf-8 -*-
"""Optional POST /synthesize to each configured local_tts instance at API startup (Piper ONNX warm paths)."""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)


async def warmup_local_tts_instances() -> None:
    raw = (os.getenv("LOCAL_TTS_STARTUP_WARMUP", "true") or "").strip().lower()
    if raw not in ("1", "true", "yes"):
        return

    from app.services.providers.local_piper import _parse_env_synthesize_urls

    urls = _parse_env_synthesize_urls()
    if not urls:
        return

    text = (os.getenv("LOCAL_TTS_WARMUP_TEXT", "test") or "test").strip() or "test"
    timeout = float(os.getenv("LOCAL_TTS_WARMUP_TIMEOUT_SEC", "15"))
    timeout_cfg = httpx.Timeout(timeout)

    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        for u in urls:
            try:
                r = await client.post(
                    u,
                    json={"text": text},
                    headers={"Content-Type": "application/json"},
                )
                logger.info("[LocalPiper] startup warmup %s -> HTTP %s", u, r.status_code)
            except Exception as e:
                logger.warning("[LocalPiper] startup warmup failed for %s: %s", u, e)
