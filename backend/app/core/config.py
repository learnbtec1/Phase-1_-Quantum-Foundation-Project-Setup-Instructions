# app/core/config.py
from __future__ import annotations
import json
import os
from typing import List, Optional, Union
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from dotenv import load_dotenv

# Load .env from current working directory (backend root)
load_dotenv()

class Settings(BaseSettings):
    # ----------------------------
    # FastAPI server configuration
    # ----------------------------
    API_V1_STR: str = Field("/api/v1", env="API_V1_STR")
    BACKEND_CORS_ORIGINS: Union[List[str], str] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        env="BACKEND_CORS_ORIGINS"
    )

    # ----------------------------
    # Database configuration
    # ----------------------------
    DATABASE_URL: str = Field("sqlite:///./test.db", env="DATABASE_URL")

    # ----------------------------
    # LLM / Grader configuration
    # ----------------------------
    OPENAI_API_KEY: str = Field("", env="OPENAI_API_KEY")
    DEFAULT_MODEL: str = Field("gpt-4o", env="GRADER_MODEL")
    HARD_DEADLINE_SEC: int = Field(70, env="GRADER_HARD_DEADLINE_SEC")
    SELF_CONSISTENCY: int = Field(1, env="GRADER_SELF_CONSISTENCY")
    MAX_TOKENS: int = Field(2600, env="GRADER_MAX_TOKENS")
    PROMPT_VERSION: str = Field("2026.03.02-Ultimate-Single-File", env="GRADER_PROMPT_VERSION")
    TOPIC_MATCH_THRESHOLD: float = Field(0.35, env="GRADER_TOPIC_THRESHOLD")

    # ----------------------------
    # Plagiarism Guard
    # ----------------------------
    PLAGIARISM_MIN_LEN: int = Field(80, env="PLAGIARISM_MIN_LEN")
    PLAGIARISM_STRICT: bool = Field(False, env="PLAGIARISM_STRICT")

    # ----------------------------
    # Logging Configuration
    # ----------------------------
    LOG_LEVEL: str = Field("INFO", env="LOG_LEVEL")

    # ----------------------------
    # Azure Cognitive Services — Speech (TTS / STT)
    # ----------------------------
    AZURE_SPEECH_KEY:    str = Field("", env="AZURE_SPEECH_KEY")
    AZURE_SPEECH_REGION: str = Field("eastus", env="AZURE_SPEECH_REGION")

    # ----------------------------
    # TTS / Avatar Voice Configuration
    # ----------------------------
    # Jordanian Arabic voices (ar-JO dialect)
    TTS_ARABIC_VOICE:        str = Field("ar-JO-TaimNeural", env="TTS_ARABIC_VOICE")
    TTS_ARABIC_VOICE_FEMALE: str = Field("ar-JO-SanaNeural", env="TTS_ARABIC_VOICE_FEMALE")

    # ----------------------------
    # Helper for OpenAI API Key Validation
    # ----------------------------
    def validate_openai_key(self):
        if not self.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is not set. Please configure it in the .env file.")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    def get_cors_origins(self) -> List[str]:
        """تحويل BACKEND_CORS_ORIGINS إلى قائمة."""
        if isinstance(self.BACKEND_CORS_ORIGINS, list):
            return self.BACKEND_CORS_ORIGINS
        raw = str(self.BACKEND_CORS_ORIGINS or "").strip()
        if not raw:
            return []
        if raw.startswith("[") and raw.endswith("]"):
            try:
                arr = json.loads(raw)
                if isinstance(arr, list):
                    return [str(x).strip() for x in arr if x]
            except Exception:
                pass
        return [x.strip() for x in raw.split(",") if x.strip()]

    def validate_openai_key(self) -> None:
        """Optional: raise only when OpenAI is required (e.g. legacy endpoints)."""
        if not self.OPENAI_API_KEY and os.getenv("REQUIRE_OPENAI") == "true":
            raise ValueError("OPENAI_API_KEY is not set. Set REQUIRE_OPENAI=true only when needed.")


settings = Settings()