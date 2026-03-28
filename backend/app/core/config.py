from __future__ import annotations
import json
import os
from typing import List, Optional, Union
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator
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
    # Cogni tutor — model tier (Phase C / V26)
    # ----------------------------
    TUTOR_MODEL: str = Field("gpt-4o", env="TUTOR_MODEL")
    TUTOR_MODEL_FREE: str = Field("gpt-4o-mini", env="TUTOR_MODEL_FREE")

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
    # JWT (Phase A — Cogni accounts)
    # ----------------------------
    JWT_SECRET: str = Field("change_this_in_production", env="JWT_SECRET")
    JWT_ALGORITHM: str = Field("HS256", env="JWT_ALGORITHM")
    JWT_EXPIRES_MINUTES: int = Field(60 * 24 * 7, env="JWT_EXPIRES_MINUTES")

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
    # When True: `/tts-with-timing` does not fall back to edge-tts/gTTS after most Azure failures.
    # Authentication failures (401/403) still fall back so Cogni can speak.
    # Default False keeps edge-tts available as a resilient path after Azure errors.
    TTS_DISABLE_NON_AZURE_FALLBACK: bool = Field(False, env="TTS_DISABLE_NON_AZURE_FALLBACK")
    # HTTP + WebSocket synthesis: "edge" tries Microsoft Edge online TTS first (free, no Azure key).
    # "azure" preserves legacy Azure-first ordering when credentials are configured.
    TTS_PRIMARY_PROVIDER: str = Field("edge", env="TTS_PRIMARY_PROVIDER")
    # Retries inside AzureTTSService.synthesize on transient 429 / rate-limit errors
    TTS_AZURE_RETRY_COUNT: int = Field(3, env="TTS_AZURE_RETRY_COUNT")
    TTS_AZURE_RETRY_DELAY_SEC: float = Field(2.5, env="TTS_AZURE_RETRY_DELAY_SEC")
    # When True: if Azure returns 429/rate-limit, fall through to edge-tts (same ar-JO voice name) instead of HTTP 503.
    # Ignored if TTS_DISABLE_NON_AZURE_FALLBACK is True. Default True keeps Azure→edge resilient in tts-with-timing.
    TTS_AZURE_429_FALLBACK_EDGE: bool = Field(True, env="TTS_AZURE_429_FALLBACK_EDGE")
    # Last resort when edge-tts + Azure both fail (e.g. corporate firewall). Uses MSA Arabic, not Jordanian.
    TTS_ALLOW_GTTS_ARABIC_FALLBACK: bool = Field(False, env="TTS_ALLOW_GTTS_ARABIC_FALLBACK")
    # Arabic gTTS runs only after this many consecutive Arabic TTS failures (503). 0 = legacy (flag alone).
    TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES: int = Field(0, env="TTS_GTTS_ARABIC_MIN_CONSECUTIVE_FAILURES")

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