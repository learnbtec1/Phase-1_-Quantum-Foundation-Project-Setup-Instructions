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
        default_factory=lambda: ["http://localhost:3000", "http://localhost:3011"]
    )
    ALLOWED_HOSTS: str = Field("")
    AUTO_CREATE_TABLES: bool = Field(False)

    # 2. إعدادات الموديلات (حل مشكلة TUTOR_MODEL_FREE)
    OPENAI_API_KEY: str = Field("")
    TUTOR_MODEL: str = Field("gpt-4o")
    TUTOR_MODEL_FREE: str = Field("gpt-4o-mini")
    THINKER_MODEL: str = Field("gpt-4o-mini")
    PROACTIVE_THOUGHT_COUNT: int = Field(3)

    # 3. إعدادات الصوت (حل مشكلة ElevenLabs و TTS_ARABIC_VOICE)
    TTS_PROVIDER: str = Field("elevenlabs")
    ELEVENLABS_API_KEY: str = Field("")
    # Pre-made / legacy free API voices (e.g. Bella EXAVITQu4vr4xnSDxMaL, Rachel 21m00Tcm4TlvDq8ikWAM)
    ELEVENLABS_VOICE_ID: str = Field("EXAVITQu4vr4xnSDxMaL")
    TTS_ARABIC_VOICE: str = Field("ar-JO-TaimNeural") # هذا "الاسم" الذي يطلبه الكود
    
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