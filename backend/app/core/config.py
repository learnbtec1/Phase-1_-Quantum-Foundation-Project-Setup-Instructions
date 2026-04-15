# app/core/config.py
from __future__ import annotations
import json
import os
from typing import List, Optional, Union
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field, field_validator, model_validator
from dotenv import load_dotenv

# Load .env from current working directory (backend root)
load_dotenv()

class Settings(BaseSettings):
    # ----------------------------
    # Environment (Phase 4 — production guards)
    # ----------------------------
    ENVIRONMENT: str = Field(
        "development",
        validation_alias=AliasChoices("ENVIRONMENT", "ENV"),
    )

    # ----------------------------
    # FastAPI server configuration
    # ----------------------------
    API_V1_STR: str = Field("/api/v1", env="API_V1_STR")
    BACKEND_CORS_ORIGINS: Union[List[str], str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
        ],
        env="BACKEND_CORS_ORIGINS",
    )
    # Phase 5 — TrustedHostMiddleware in production (comma-separated hostnames, no scheme/port).
    ALLOWED_HOSTS: str = Field("", env="ALLOWED_HOSTS")

    # ----------------------------
    # Database configuration
    # ----------------------------
    DATABASE_URL: str = Field("sqlite:///./test.db", env="DATABASE_URL")

    # ----------------------------
    # JWT (Phase A — Cogni accounts) + schema auto-create (Phase 4)
    # ----------------------------
    JWT_SECRET: str = Field("change_this_in_production", env="JWT_SECRET")
    JWT_ALGORITHM: str = Field("HS256", env="JWT_ALGORITHM")
    JWT_EXPIRES_MINUTES: int = Field(60 * 24 * 7, env="JWT_EXPIRES_MINUTES")
    # When None: True in development, False in production (use Alembic migrations in prod).
    AUTO_CREATE_TABLES: Optional[bool] = Field(default=None, env="AUTO_CREATE_TABLES")

    # ----------------------------
    # LLM / Grader configuration
    # ----------------------------
    OPENAI_API_KEY: str = Field("", env="OPENAI_API_KEY")
    DEFAULT_MODEL: str = Field("gpt-5", env="GRADER_MODEL")
    HARD_DEADLINE_SEC: int = Field(70, env="GRADER_HARD_DEADLINE_SEC")
    SELF_CONSISTENCY: int = Field(1, env="GRADER_SELF_CONSISTENCY")
    MAX_TOKENS: int = Field(2600, env="GRADER_MAX_TOKENS")
    PROMPT_VERSION: str = Field("2026.03.02-Ultimate-Single-File", env="GRADER_PROMPT_VERSION")
    TOPIC_MATCH_THRESHOLD: float = Field(0.35, env="GRADER_TOPIC_THRESHOLD")

    # ----------------------------
    # Cogni tutor — model tier (Phase C / V26)
    # ----------------------------
    TUTOR_MODEL: str = Field("gpt-4o", env="TUTOR_MODEL")
    TUTOR_MODEL_FREE: str = Field("gpt-4o-mini", env="TUTOR_MODEL_FREE")
    # Inner monologue / planning — same family as free tier by default; override via THINKER_MODEL.
    THINKER_MODEL: str = Field("gpt-4o-mini", env="THINKER_MODEL")

    # ----------------------------
    # Plagiarism Guard
    # ----------------------------
    PLAGIARISM_MIN_LEN: int = Field(80, env="PLAGIARISM_MIN_LEN")
    PLAGIARISM_STRICT: bool = Field(False, env="PLAGIARISM_STRICT")

    # ----------------------------
    # Cogni Thinker — proactive / inner monologue thresholds
    # ----------------------------
    PROACTIVE_THOUGHT_COUNT: int = Field(3, env="PROACTIVE_THOUGHT_COUNT")
    PROACTIVE_COOLDOWN_SEC: int = Field(90, env="PROACTIVE_COOLDOWN_SEC")
    THOUGHT_SIMILARITY_THRESHOLD: float = Field(0.7, env="THOUGHT_SIMILARITY_THRESHOLD")
    # Approximate browser playback tail after WS sends audio (proactive / thinker safety)
    TTS_PLAYBACK_GRACE_SEC: float = Field(0.8, env="TTS_PLAYBACK_GRACE_SEC")
    PLANNING_ENABLED: bool = Field(True, env="PLANNING_ENABLED")
    PLANNING_INTERVAL_TURNS: int = Field(5, env="PLANNING_INTERVAL_TURNS")

    # LLM failure backoff (quota / transient errors) — tutor + thinker + proactive
    LLM_FAILURE_COOLDOWN_SEC: int = Field(60, env="LLM_FAILURE_COOLDOWN_SEC")
    LLM_FAILURE_COOLDOWN_COUNT: int = Field(3, env="LLM_FAILURE_COOLDOWN_COUNT")
    FALLBACK_VARIANT_WINDOW_SEC: int = Field(30, env="FALLBACK_VARIANT_WINDOW_SEC")
    # After this many consecutive LLM failures in Thinker, pause inner monologue
    THINKER_LLM_STRIKE_COOLDOWN_SEC: int = Field(300, env="THINKER_LLM_STRIKE_COOLDOWN_SEC")

    @field_validator("PLANNING_ENABLED", mode="before")
    @classmethod
    def _parse_planning_enabled(cls, v: object) -> bool:
        if v is None:
            return True
        if isinstance(v, bool):
            return v
        s = str(v).strip().lower()
        if s in ("", "0", "false", "no", "off"):
            return False
        return s in ("1", "true", "yes", "on")

    # ----------------------------
    # V28 Digital Human — feature flags (staged rollout)
    # ----------------------------
    ENABLE_CAMERA_FEED: bool = Field(default=True, env="ENABLE_CAMERA_FEED")
    ENABLE_DEVICE_CONTEXT: bool = Field(default=True, env="ENABLE_DEVICE_CONTEXT")
    ENABLE_THEORY_OF_MIND: bool = Field(default=True, env="ENABLE_THEORY_OF_MIND")
    ENABLE_EMOTIONAL_CONTAGION: bool = Field(default=True, env="ENABLE_EMOTIONAL_CONTAGION")
    ENABLE_ACTIVE_EMPATHY: bool = Field(default=True, env="ENABLE_ACTIVE_EMPATHY")
    ENABLE_PERSONA_LEARNING: bool = Field(default=True, env="ENABLE_PERSONA_LEARNING")
    ENABLE_YEARLY_MEMORY: bool = Field(default=True, env="ENABLE_YEARLY_MEMORY")
    ENABLE_SESSION_TIMELINE: bool = Field(default=True, env="ENABLE_SESSION_TIMELINE")
    ENABLE_POST_SESSION_REFLECTION: bool = Field(default=True, env="ENABLE_POST_SESSION_REFLECTION")
    ENABLE_TRAINING_DATA: bool = Field(default=True, env="ENABLE_TRAINING_DATA")
    ENABLE_RL_POLICY: bool = Field(default=False, env="ENABLE_RL_POLICY")
    ENABLE_REDIS_SESSION_SYNC: bool = Field(default=True, env="ENABLE_REDIS_SESSION_SYNC")
    ENABLE_ETHICAL_FILTER: bool = Field(default=True, env="ENABLE_ETHICAL_FILTER")
    # Cogni Brain — dynamic prompt suffix from behavior_router + firasah reference
    ENABLE_EMOTIONAL_INTELLIGENCE: bool = Field(default=True, env="ENABLE_EMOTIONAL_INTELLIGENCE")
    ENABLE_LAYERED_TTS: bool = Field(default=False, env="ENABLE_LAYERED_TTS")
    EMOTIONAL_CONTAGION_INTENSITY: float = Field(0.65, env="EMOTIONAL_CONTAGION_INTENSITY")

    # ----------------------------
    # Logging Configuration
    # ----------------------------
    LOG_LEVEL: str = Field("INFO", env="LOG_LEVEL")

    # ----------------------------
    # Azure Cognitive Services — Speech (TTS / STT)
    # ----------------------------
    AZURE_SPEECH_KEY:    str = Field("", env="AZURE_SPEECH_KEY")
    AZURE_SPEECH_REGION: str = Field("eastus", env="AZURE_SPEECH_REGION")

    @field_validator("AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", mode="before")
    @classmethod
    def _strip_azure_speech_secrets(cls, v: object) -> str:
        """Trim whitespace and strip BOM / zero-width chars from .env pastes."""
        if v is None:
            return ""
        s = str(v).replace("\ufeff", "").replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
        return s.strip()

    # ----------------------------
    # TTS / Avatar Voice Configuration
    # ----------------------------
    # Jordanian Arabic voices (ar-JO dialect)
    # ar-JO-OmarNeural / ar-JO-HamedNeural are NOT available in eastus region.
    # ar-JO-TaimNeural (male) + ar-JO-SanaNeural (female) are confirmed working.
    # Synthesis paths force COGNI_ARABIC_TTS_VOICE_LOCKED so a mis-set TTS_ARABIC_VOICE cannot switch gender.
    TTS_ARABIC_VOICE:        str = Field("ar-JO-TaimNeural",   env="TTS_ARABIC_VOICE")
    TTS_ARABIC_VOICE_FEMALE: str = Field("ar-JO-SanaNeural",   env="TTS_ARABIC_VOICE_FEMALE")
    COGNI_ARABIC_TTS_VOICE_LOCKED: str = Field("ar-JO-TaimNeural", env="COGNI_ARABIC_TTS_VOICE_LOCKED")
    # When True: WebSocket TTS uses Azure only (no Edge/Kokoro/gTTS fallbacks).
    TTS_AZURE_ONLY: bool = Field(True, env="TTS_AZURE_ONLY")
    # When True: legacy flag — no non-Azure TTS fallbacks (default True; Cogni is Azure-only).
    TTS_DISABLE_NON_AZURE_FALLBACK: bool = Field(True, env="TTS_DISABLE_NON_AZURE_FALLBACK")
    # Ignored when TTS_AZURE_ONLY=True (Edge is disabled).
    TTS_PRIMARY_PROVIDER: str = Field("azure", env="TTS_PRIMARY_PROVIDER")
    # Must stay False in production — Edge TTS is disabled when TTS_AZURE_ONLY=True.
    TTS_FORCE_FALLBACK: bool = Field(False, env="TTS_FORCE_FALLBACK")
    # Retries inside AzureTTSService.synthesize on transient 429 / rate-limit errors
    TTS_AZURE_RETRY_COUNT: int = Field(3, env="TTS_AZURE_RETRY_COUNT")
    TTS_AZURE_RETRY_DELAY_SEC: float = Field(2.5, env="TTS_AZURE_RETRY_DELAY_SEC")
    # Legacy (unused): Edge fallback removed; Azure retries only.
    TTS_AZURE_429_FALLBACK_EDGE: bool = Field(False, env="TTS_AZURE_429_FALLBACK_EDGE")

    # Jordanian dialect lock (TTS + optional text pass)
    TTS_FORCE_JORDANIAN: bool = Field(True, env="TTS_FORCE_JORDANIAN")
    TTS_ARABIC_VOICE_FALLBACK: str = Field("ar-JO-TaimNeural", env="TTS_ARABIC_VOICE_FALLBACK")
    TTS_REJECT_EGYPTIAN_VOCABULARY: bool = Field(True, env="TTS_REJECT_EGYPTIAN_VOCABULARY")
    TTS_EDGE_FALLBACK_VOICE: str = Field("ar-JO-TaimNeural", env="TTS_EDGE_FALLBACK_VOICE")
    TTS_LOG_DIALECT_CORRECTIONS: bool = Field(True, env="TTS_LOG_DIALECT_CORRECTIONS")

    @field_validator(
        "TTS_FORCE_JORDANIAN",
        "TTS_REJECT_EGYPTIAN_VOCABULARY",
        "TTS_LOG_DIALECT_CORRECTIONS",
        mode="before",
    )
    @classmethod
    def _parse_tts_dialect_bools(cls, v: object) -> bool:
        if v is None:
            return True
        if isinstance(v, bool):
            return v
        s = str(v).strip().lower()
        if s in ("", "0", "false", "no", "off"):
            return False
        return s in ("1", "true", "yes", "on")

    @field_validator("AUTO_CREATE_TABLES", mode="before")
    @classmethod
    def _parse_auto_create_tables(cls, v: object) -> Optional[bool]:
        if v is None or v == "":
            return None
        if isinstance(v, bool):
            return v
        s = str(v).strip().lower()
        if s in ("0", "false", "no", "off"):
            return False
        if s in ("1", "true", "yes", "on"):
            return True
        return None

    @model_validator(mode="after")
    def _phase4_production_defaults(self) -> Settings:
        from app.core.production_guards import (
            environment_is_production,
            validate_jwt_secret_for_production,
        )

        if self.TTS_AZURE_ONLY:
            if not (self.AZURE_SPEECH_KEY or "").strip():
                raise ValueError(
                    "TTS_AZURE_ONLY=true requires AZURE_SPEECH_KEY. "
                    "Set Azure Speech credentials or TTS_AZURE_ONLY=false for local dev without Azure."
                )
            if not (self.AZURE_SPEECH_REGION or "").strip():
                raise ValueError(
                    "TTS_AZURE_ONLY=true requires AZURE_SPEECH_REGION."
                )
            if self.TTS_FORCE_FALLBACK:
                raise ValueError(
                    "TTS_FORCE_FALLBACK must be false when TTS_AZURE_ONLY=true (Azure-only enforcement)."
                )

        is_prod = environment_is_production(self.ENVIRONMENT)
        if self.AUTO_CREATE_TABLES is None:
            self.AUTO_CREATE_TABLES = False if is_prod else True
        if is_prod:
            validate_jwt_secret_for_production(self.JWT_SECRET)
            ws_anon = os.getenv("COGNI_WS_ALLOW_ANONYMOUS", "false").lower() in (
                "1",
                "true",
                "yes",
            )
            if ws_anon:
                raise ValueError(
                    "COGNI_WS_ALLOW_ANONYMOUS must be false in production; "
                    "use JWT subprotocol or an auth frame for /ws/agent."
                )
        return self

    @property
    def is_production(self) -> bool:
        from app.core.production_guards import environment_is_production

        return environment_is_production(self.ENVIRONMENT)

    # ----------------------------
    # Helper for OpenAI API Key Validation
    # ----------------------------
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