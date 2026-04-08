# -*- coding: utf-8 -*-
"""Startup warnings for security and RAG/corpus misconfiguration (non-fatal in development)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from app.core.production_guards import (
    JWT_SECRET_MIN_LEN,
    _FORBIDDEN_JWT_SECRETS,
    environment_is_production,
)

logger = logging.getLogger(__name__)


def log_startup_security_and_ops_warnings(*, environment: str, jwt_secret: str) -> None:
    """
    Log high-signal warnings. Production hard failures remain in Settings validators.
    """
    is_prod = environment_is_production(environment)
    raw = (jwt_secret or "").strip()
    low = raw.lower()

    if not is_prod:
        if low in _FORBIDDEN_JWT_SECRETS or len(raw) < JWT_SECRET_MIN_LEN:
            logger.warning(
                "[startup] JWT_SECRET is weak or default — fine for local dev only. "
                "Use a long random secret before any shared/staging/production deploy "
                "(see .env.example).",
            )

    ws_anon = os.getenv("COGNI_WS_ALLOW_ANONYMOUS", "false").lower() in ("1", "true", "yes")
    if ws_anon:
        logger.warning(
            "[startup] COGNI_WS_ALLOW_ANONYMOUS=true — /ws/agent accepts guests without JWT. "
            "Disable in any environment exposed to the internet.",
        )

    if os.getenv("LOCAL_RAG_ENABLED", "false").lower() in ("1", "true", "yes"):
        rag_dir = (os.getenv("LOCAL_RAG_DIR") or "").strip()
        if rag_dir:
            p = Path(rag_dir)
            if not p.is_dir():
                logger.warning(
                    "[startup] LOCAL_RAG_ENABLED but LOCAL_RAG_DIR is not a directory: %s — "
                    "Cogni local TF-IDF RAG will be empty. Fix the path or disable LOCAL_RAG_ENABLED.",
                    rag_dir,
                )

    chroma_on = os.getenv("BTEC_CHROMA_RAG_ENABLED", "true").lower() in ("1", "true", "yes")
    if chroma_on:
        try:
            from app.services.vector_store import get_btec_vector_store

            store = get_btec_vector_store()
            n = int(store.count())
            if n == 0:
                logger.warning(
                    "[startup] BTEC Chroma collection is empty (0 chunks). "
                    "Run: cd backend && set PYTHONPATH=. && python scripts/btec_ingest.py "
                    "(requires OPENAI_API_KEY). Docker: docker compose --profile ingest run --rm btec-ingest",
                )
        except Exception as exc:
            logger.debug("[startup] BTEC Chroma probe skipped: %s", exc)
