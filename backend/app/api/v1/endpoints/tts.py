# -*- coding: utf-8 -*-
"""
TTS endpoint: POST /api/v1/tts/generate
Generate Jordanian Arabic speech (MP3) using Azure Neural TTS.
"""
from __future__ import annotations

import io
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.api.v1.dependencies.phase2_gates import gate_tts_user
from app.models.db_models import User
from app.services.tts_service import AzureTTSService, _SDK_AVAILABLE

logger = logging.getLogger(__name__)

router = APIRouter()


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Arabic text to speak")
    voice_name: Optional[str] = Field(
        None,
        description="Azure neural voice name override. Defaults to ar-JO-TaimNeural.",
    )


def get_tts_service(request: Request) -> AzureTTSService:
    """Retrieve the TTS service instance stored in app.state."""
    if not hasattr(request.app.state, "tts_service") or request.app.state.tts_service is None:
        raise HTTPException(status_code=503, detail="TTS service not initialized in app state")
    return request.app.state.tts_service


@router.post(
    "/tts/generate",
    summary="Generate Jordanian Arabic TTS audio",
    response_description="MP3 audio stream",
)
async def generate_tts(
    body: TTSRequest,
    _auth: User = Depends(gate_tts_user),
    service: AzureTTSService = Depends(get_tts_service),
) -> StreamingResponse:
    """
    Synthesize *text* to Jordanian Arabic MP3 using Azure Neural TTS.
    """
    if not _SDK_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Azure Speech SDK not installed. Please install azure-cognitiveservices-speech."
        )

    try:
        mp3_bytes, _v, _w, _prov = await service.synthesize(
            text=body.text,
            voice_name=body.voice_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS request timed out")
    except RuntimeError as exc:
        err = str(exc)
        logger.error("[TTS endpoint] synthesis error: %s", err)
        if "credentials" in err.lower() or "not installed" in err.lower():
            status = 503
        else:
            status = 500
        raise HTTPException(status_code=status, detail=err)
    except Exception as exc:
        logger.exception("[TTS endpoint] unexpected error")
        raise HTTPException(status_code=500, detail="TTS synthesis failed unexpectedly")

    used_voice = body.voice_name or service._default_voice or "unknown"

    return StreamingResponse(
        io.BytesIO(mp3_bytes),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(len(mp3_bytes)),
            "Cache-Control": "no-store",
            "X-Voice": used_voice,
        },
    )


@router.get(
    "/tts/info",
    summary="Show current TTS configuration (debug)",
    include_in_schema=False,
)
async def tts_info(
    _auth: User = Depends(get_current_user),
    service: AzureTTSService = Depends(get_tts_service),
) -> dict:
    from app.core.config import settings

    if not settings.DEBUG:
        raise HTTPException(status_code=403, detail="Info endpoint disabled in production")

    key = service._key or ""

    return {
        "sdk_available": _SDK_AVAILABLE,
        "default_voice": service._default_voice,
        "region": service._region,
        "prosody_rate": service._prosody_rate,
        "timeout": service._timeout,
        "key_prefix": (key[:8] + "...") if len(key) >= 8 else ("<not set>" if not key else key),
        "env_TTS_ARABIC_VOICE": settings.TTS_ARABIC_VOICE,
        "env_AZURE_SPEECH_REGION": settings.AZURE_SPEECH_REGION,
    }