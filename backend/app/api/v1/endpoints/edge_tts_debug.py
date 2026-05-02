# -*- coding: utf-8 -*-
"""Minimal Edge TTS smoke route — verifies router registration + synthesis."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import gate_tts_user
from app.services.tts_service import synthesize_edge_tts_async

router = APIRouter()


@router.get("/debug/edge-tts")
async def debug_edge_tts(user=Depends(gate_tts_user)):  # noqa: B008 — FastAPI pattern
    audio = await synthesize_edge_tts_async("مرحبا")
    return {
        "ok": True,
        "audio_bytes": len(audio) if audio else 0,
    }
