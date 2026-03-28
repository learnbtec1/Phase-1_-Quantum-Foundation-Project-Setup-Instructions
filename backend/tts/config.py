# -*- coding: utf-8 -*-
"""
NEXUS TTS Config — V110 Sovereign Azure layer.

Reads environment variables with multi-name fallback so the module works
regardless of whether the env uses AZURE_SPEECH_KEY, TTS_DEFAULT_VOICE,
TTS_ARABIC_VOICE, or TTS_VOICE.

Call TTSConfig.validate() before synthesis to get an early, clear error.
"""
import os


def _env(*names: str, default: str | None = None) -> str | None:
    """Return the first non-empty env var from *names*, else *default*."""
    for n in names:
        v = os.getenv(n)
        if v and str(v).strip():
            return str(v).strip()
    return default


class TTSConfig:
    provider: str = (_env("TTS_PROVIDER", default="azure") or "azure").lower()
    azure_key: str | None = _env("AZURE_SPEECH_KEY", "SPEECH_KEY")
    azure_region: str = _env("AZURE_SPEECH_REGION", "SPEECH_REGION", default="eastus") or "eastus"
    # Prefer TTS_DEFAULT_VOICE, fall back to the existing ARABIC_VOICE / TTS_VOICE aliases
    default_voice: str = (
        _env("TTS_DEFAULT_VOICE", "TTS_ARABIC_VOICE", "TTS_VOICE", default="ar-JO-TaimNeural")
        or "ar-JO-TaimNeural"
    )
    disable_non_azure: bool = (
        _env("TTS_DISABLE_NON_AZURE_FALLBACK", default="true") or "true"
    ).lower() == "true"
    allow_dev_fallback: bool = (
        _env("TTS_FALLBACK_ALLOW_DEV", default="false") or "false"
    ).lower() == "true"

    @classmethod
    def validate(cls) -> None:
        """Raise RuntimeError with a clear message if Azure credentials are missing."""
        if cls.provider != "azure":
            raise RuntimeError(
                f"TTS provider must be 'azure', got '{cls.provider}'. "
                "Set TTS_PROVIDER=azure in .env."
            )
        if not cls.azure_key:
            raise RuntimeError(
                "Azure Speech key missing — set AZURE_SPEECH_KEY in .env"
            )
        if not cls.azure_region:
            raise RuntimeError(
                "Azure Speech region missing — set AZURE_SPEECH_REGION in .env"
            )

    @classmethod
    def masked_key(cls) -> str:
        """Return the key with all but the last 4 chars replaced by * for logging."""
        k = cls.azure_key or ""
        if len(k) <= 4:
            return "****"
        return "*" * (len(k) - 4) + k[-4:]
