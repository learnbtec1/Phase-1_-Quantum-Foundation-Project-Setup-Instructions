# -*- coding: utf-8 -*-
from app.services.providers.base import TTSProvider
from app.services.providers.elevenlabs import ElevenLabsTTSProvider
from app.services.providers.edge_tts import EdgeTTSProvider
from app.services.providers.local_piper import LocalPiperProvider
from app.services.providers.xtts import XTTSTTSProvider

__all__ = [
    "TTSProvider",
    "ElevenLabsTTSProvider",
    "EdgeTTSProvider",
    "LocalPiperProvider",
    "XTTSTTSProvider",
]
