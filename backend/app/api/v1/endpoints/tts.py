# -*- coding: utf-8 -*-
"""
TTS endpoint: POST /api/v1/tts/generate
Generate Arabic speech (MP3) using Microsoft Edge TTS (edge-tts).
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
from app.services.tts_service import EdgeTTSService, _EDGE_TTS_AVAILABLE

logger = logging.getLogger(__name__)

router = APIRouter()


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Arabic text to speak")
    voice_name: Optional[str] = Field(
        None,
        description="Ignored — use EDGE_TTS_VOICE / TTS_ARABIC_VOICE env.",
    )


def get_tts_service(request: Request) -> EdgeTTSService:
    """Retrieve the TTS service instance stored in app.state."""
    if not hasattr(request.app.state, "tts_service") or request.app.state.tts_service is None:
        raise HTTPException(status_code=503, detail="TTS service not initialized in app state")
    return request.app.state.tts_service


@router.post(
    "/tts/generate",
    summary="Generate Arabic TTS audio",
    response_description="MP3 audio stream",
)
async def generate_tts(
    body: TTSRequest,
    _auth: User = Depends(gate_tts_user),
    service: EdgeTTSService = Depends(get_tts_service),
) -> StreamingResponse:
    """Synthesize *text* to MP3 using Edge TTS."""
    if not _EDGE_TTS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="edge-tts is not installed.",
        )

    try:
        mp3_bytes, _v, _w, _prov = await service.synthesize(
            text=body.text,
            voice_name=body.voice_name,
        )
        if _prov != "edge":
            logger.error("[TTS endpoint] unexpected provider returned: %s", _prov)
            raise HTTPException(status_code=502, detail="TTS integrity: expected Edge provider only.")
        if not mp3_bytes:
            raise HTTPException(status_code=502, detail="Edge TTS returned empty audio.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS request timed out")
    except RuntimeError as exc:
        err = str(exc)
        logger.error("[TTS endpoint] synthesis error: %s", err)
        if "not installed" in err.lower():
            status = 503
        else:
            status = 500
        raise HTTPException(status_code=status, detail=err)
    except Exception as exc:
        logger.exception("[TTS endpoint] unexpected error")
        raise HTTPException(status_code=500, detail="TTS synthesis failed unexpectedly")

    used_voice = service._default_voice or "unknown"

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
    service: EdgeTTSService = Depends(get_tts_service),
) -> dict:
    from app.core.config import settings

    if not settings.DEBUG:
        raise HTTPException(status_code=403, detail="Info endpoint disabled in production")

    return {
        "sdk_available": _EDGE_TTS_AVAILABLE,
        "default_voice": service._default_voice,
        "provider": "edge-tts",
        "env_TTS_ARABIC_VOICE": settings.TTS_ARABIC_VOICE,
    }
