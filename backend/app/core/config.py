# app/core/config.py
from __future__ import annotations

import json
from typing import List, Union

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    # 1. إعدادات البيئة (حل مشكلة is_production)
    ENVIRONMENT: str = Field("development", validation_alias=AliasChoices("ENVIRONMENT", "ENV"))
    API_V1_STR: str = Field("/api/v1")
    BACKEND_CORS_ORIGINS: Union[List[str], str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ]
    )
    ALLOWED_HOSTS: str = Field("")
    AUTO_CREATE_TABLES: bool = Field(False)

    # 2. إعدادات الموديلات (حل مشكلة TUTOR_MODEL_FREE)
    OPENAI_API_KEY: str = Field("")
    TUTOR_MODEL: str = Field("gpt-4o")
    TUTOR_MODEL_FREE: str = Field("gpt-4o-mini")
    THINKER_MODEL: str = Field("gpt-4o-mini")
    PROACTIVE_THOUGHT_COUNT: int = Field(3)

    # 3. إعدادات الصوت — افتراضي: Piper ثم ElevenLabs عبر الراوتر (Edge غالبًا 403 على VPS).
    TTS_PROVIDER: str = Field("local")
    ELEVENLABS_API_KEY: str = Field("")
    # Default: Rachel — works on free tiers; premium-only / library IDs return 402.
    ELEVENLABS_VOICE_ID: str = Field("21m00Tcm4TlvDq8ikWAM")
    # Edge/Azure neural id when Edge is in the chain (Jordanian male Taim — aligns with Piper ar_JO kareem persona).
    TTS_ARABIC_VOICE: str = Field("ar-JO-TaimNeural")
    COGNI_ARABIC_TTS_VOICE_LOCKED: str = Field(
        "ar-JO-TaimNeural",
        validation_alias=AliasChoices("COGNI_ARABIC_TTS_VOICE_LOCKED"),
    )
    # If True, reject non–ar-JO voices and use COGNI_ARABIC_TTS_VOICE_LOCKED (Docker Compose sets true for Cogni).
    TTS_FORCE_JORDANIAN: bool = Field(False)
    
    # 4. إعدادات الأمان (حل مشكلة 401 Unauthorized)
    COGNI_DEV_BYPASS_AUTH: bool = Field(True) # يفتح الباب للتطوير بدون تعقيدات Login
    JWT_SECRET: str = Field("secret")
    # Must match app.core.security (settings.JWT_ALGORITHM / JWT_EXPIRES_MINUTES). Accept legacy env names ALGORITHM / ACCESS_TOKEN_EXPIRE_MINUTES.
    JWT_ALGORITHM: str = Field(
        "HS256",
        validation_alias=AliasChoices("JWT_ALGORITHM", "ALGORITHM"),
    )
    JWT_EXPIRES_MINUTES: int = Field(
        43200,
        validation_alias=AliasChoices("JWT_EXPIRES_MINUTES", "ACCESS_TOKEN_EXPIRE_MINUTES"),
    )

    # وظيفة مساعدة يحتاجها ملف main.py
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() in ("production", "prod")

    def get_cors_origins(self) -> List[str]:
        """
        FastAPI expects a list of origins; .env may provide JSON array, comma-separated string, or list.
        """
        raw = self.BACKEND_CORS_ORIGINS
        if isinstance(raw, list):
            out = [str(o).strip() for o in raw if str(o).strip()]
            return out if out else ["http://localhost:3000"]
        s = str(raw).strip()
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    out = [str(o).strip() for o in parsed if str(o).strip()]
                    return out if out else ["http://localhost:3000"]
            except json.JSONDecodeError:
                pass
        parts = [p.strip() for p in s.split(",") if p.strip()]
        return parts if parts else ["http://localhost:3000"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()