# -*- coding: utf-8 -*-
"""
conversation_repository.py — Dual-implementation conversation storage.

Two concrete implementations (Protocol pattern matching evaluations.py):
  • InMemoryConversationRepository  — ephemeral dict; USE_DB=false.
  • PostgresConversationRepository  — SQLAlchemy ORM; USE_DB=true.

DB Schema (managed via Alembic migration 0002_add_conversations_table):

  CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL,
    started_at  TIMESTAMP DEFAULT NOW(),
    ended_at    TIMESTAMP,
    summary     TEXT,
    exchanges   JSONB NOT NULL DEFAULT '[]'
  );

Usage:
  from repository.conversation_repository import get_conversation_repo
  repo = get_conversation_repo()
  conv_id = repo.save(session_id="...", user_id=None, exchanges=[...], summary="...")
  convs   = repo.get_by_user(user_id="...", limit=10)
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Protocol
# ─────────────────────────────────────────────────────────────────────────────

@runtime_checkable
class ConversationRepository(Protocol):
    """Minimal conversation storage interface."""

    def save(
        self,
        *,
        session_id: str,
        user_id:    Optional[str],
        exchanges:  list[dict[str, Any]],
        summary:    Optional[str],
    ) -> str:
        """Persist (or upsert) a conversation; returns the conversation id."""
        ...

    def get_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        """Return the conversation dict for the given session, or None."""
        ...

    def get_by_user(self, user_id: str, limit: int = 10) -> list[dict[str, Any]]:
        """Return up to `limit` conversations for a user, newest first."""
        ...


# ─────────────────────────────────────────────────────────────────────────────
# InMemory (USE_DB=false)
# ─────────────────────────────────────────────────────────────────────────────

class InMemoryConversationRepository:
    """Thread-safe for single-process dev; ephemeral (data lost on restart)."""

    def __init__(self) -> None:
        # keyed by session_id for O(1) upsert
        self._by_session: dict[str, dict[str, Any]] = {}
        # ordered insertion list for get_by_user
        self._by_user: dict[str, list[str]] = {}  # user_id → [session_ids]

    def save(
        self,
        *,
        session_id: str,
        user_id:    Optional[str],
        exchanges:  list[dict[str, Any]],
        summary:    Optional[str],
    ) -> str:
        now = datetime.now(timezone.utc).isoformat()
        existing = self._by_session.get(session_id)
        conv_id  = existing["id"] if existing else str(uuid.uuid4())

        record: dict[str, Any] = {
            "id":         conv_id,
            "session_id": session_id,
            "user_id":    user_id,
            "started_at": existing["started_at"] if existing else now,
            "ended_at":   now,
            "summary":    summary or "",
            "exchanges":  exchanges,
        }
        self._by_session[session_id] = record

        if user_id:
            sessions = self._by_user.setdefault(user_id, [])
            if session_id not in sessions:
                sessions.append(session_id)

        logger.debug("[ConvRepo:InMemory] saved session=%s conv=%s", session_id, conv_id)
        return conv_id

    def get_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        return self._by_session.get(session_id)

    def get_by_user(self, user_id: str, limit: int = 10) -> list[dict[str, Any]]:
        session_ids = self._by_user.get(user_id, [])
        # newest first (last appended = most recent)
        results = [
            self._by_session[sid]
            for sid in reversed(session_ids)
            if sid in self._by_session
        ]
        return results[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Postgres (USE_DB=true)
# ─────────────────────────────────────────────────────────────────────────────

class PostgresConversationRepository:
    """SQLAlchemy-based Postgres implementation.

    Lazy-imports SQLAlchemy so the module is importable even when the ORM is
    not installed (InMemory path still works).
    """

    def __init__(self, db_url: str) -> None:
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(db_url, pool_pre_ping=True)
        self._Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        self._text = text  # keep a reference to avoid re-import in methods

    def save(
        self,
        *,
        session_id: str,
        user_id:    Optional[str],
        exchanges:  list[dict[str, Any]],
        summary:    Optional[str],
    ) -> str:
        sql_upsert = self._text("""
            INSERT INTO conversations (session_id, user_id, exchanges, summary)
            VALUES (:session_id, :user_id, :exchanges::jsonb, :summary)
            ON CONFLICT (session_id) DO UPDATE
              SET exchanges  = EXCLUDED.exchanges,
                  summary    = EXCLUDED.summary,
                  ended_at   = NOW()
            RETURNING id
        """)
        with self._Session() as db:
            row = db.execute(sql_upsert, {
                "session_id": session_id,
                "user_id":    user_id,
                "exchanges":  json.dumps(exchanges, ensure_ascii=False),
                "summary":    summary or "",
            }).fetchone()
            db.commit()
        conv_id = str(row[0]) if row else str(uuid.uuid4())
        logger.debug("[ConvRepo:Postgres] saved session=%s conv=%s", session_id, conv_id)
        return conv_id

    def get_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        sql = self._text(
            "SELECT id, session_id, user_id, started_at, ended_at, summary, exchanges "
            "FROM conversations WHERE session_id = :s LIMIT 1"
        )
        with self._Session() as db:
            row = db.execute(sql, {"s": session_id}).mappings().fetchone()
        if row is None:
            return None
        return dict(row)

    def get_by_user(self, user_id: str, limit: int = 10) -> list[dict[str, Any]]:
        sql = self._text(
            "SELECT id, session_id, user_id, started_at, ended_at, summary, exchanges "
            "FROM conversations WHERE user_id = :uid "
            "ORDER BY started_at DESC LIMIT :lim"
        )
        with self._Session() as db:
            rows = db.execute(sql, {"uid": user_id, "lim": limit}).mappings().fetchall()
        return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

_REPO_INSTANCE: Optional[ConversationRepository] = None


def get_conversation_repo() -> ConversationRepository:
    """Return the singleton ConversationRepository (InMemory or Postgres)."""
    global _REPO_INSTANCE
    if _REPO_INSTANCE is not None:
        return _REPO_INSTANCE

    use_db = os.environ.get("USE_DB", "false").lower() in {"1", "true", "yes"}
    if use_db:
        db_url = os.environ.get("DATABASE_URL", "")
        if not db_url:
            logger.error("[ConvRepo] USE_DB=true but DATABASE_URL is not set → InMemory fallback")
        else:
            try:
                _REPO_INSTANCE = PostgresConversationRepository(db_url)
                logger.info("[ConvRepo] PostgresConversationRepository ready")
                return _REPO_INSTANCE
            except Exception as exc:
                logger.error("[ConvRepo] Postgres init failed: %s → InMemory fallback", exc)

    _REPO_INSTANCE = InMemoryConversationRepository()
    logger.info("[ConvRepo] InMemoryConversationRepository ready")
    return _REPO_INSTANCE
