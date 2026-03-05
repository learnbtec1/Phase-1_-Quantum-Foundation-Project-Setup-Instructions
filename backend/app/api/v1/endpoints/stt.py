# -*- coding: utf-8 -*-
"""
STT endpoint: POST /api/v1/stt - Speech-to-Text using Whisper.
Accepts raw audio bytes (16-bit PCM mono, 16kHz) or base64.
"""
from __future__ import annotations

import base64
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File

from app.services.whisper_stt import is_available, transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/stt")
async def stt_transcribe(
    audio: UploadFile = File(..., description="Audio file (WAV/raw PCM mono 16kHz)"),
):
    """Transcribe audio to text. Returns { transcript: str }."""
    if not is_available():
        raise HTTPException(status_code=503, detail="Whisper STT not available. Install faster-whisper or openai-whisper.")
    try:
        raw = await audio.read()
        if len(raw) < 100:
            raise HTTPException(status_code=400, detail="Audio too short")
        text = await transcribe_audio(raw)
        return {"transcript": text or ""}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("STT error: %s", e)
        raise HTTPException(status_code=500, detail="Transcription failed")
