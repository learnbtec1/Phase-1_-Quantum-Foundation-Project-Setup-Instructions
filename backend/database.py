# -*- coding: utf-8 -*-
"""
database.py — SQLAlchemy async-compatible engine and session factory.

Environment variables:
  DATABASE_URL  PostgreSQL DSN, e.g.
                postgresql://nexus:nexus_pass@localhost:5432/nexus_db
                Falls back to an in-process SQLite file for local development
                without Docker.
  USE_DB        Set to "true" to activate the Postgres path; default "false".

Usage (in FastAPI endpoints):
    from database import get_db
    def my_endpoint(db: Session = Depends(get_db)):
        ...
"""
from __future__ import annotations

import logging
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

logger = logging.getLogger(__name__)

# ── DSN resolution ───────────────────────────────────────────────────────────
_DEFAULT_SQLITE = "sqlite:///./nexus_dev.db"
DATABASE_URL: str = os.getenv("DATABASE_URL", _DEFAULT_SQLITE)

# Convert async DSN variants to sync (SQLAlchemy sync engine is used here).
# (e.g. postgresql+asyncpg → postgresql+psycopg2)
_sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")

# ── Engine ───────────────────────────────────────────────────────────────────
connect_args: dict = {}
if _sync_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False  # required for SQLite + FastAPI

engine = create_engine(
    _sync_url,
    connect_args=connect_args,
    pool_pre_ping=True,   # tests connection liveness before reuse
    echo=os.getenv("DB_ECHO", "false").lower() == "true",
)

# ── Session factory ───────────────────────────────────────────────────────────
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


# ── Declarative base (shared by all models) ───────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── FastAPI dependency ────────────────────────────────────────────────────────

def get_db() -> Session:
    """
    FastAPI dependency that yields a database session and guarantees cleanup.

    Usage:
        @router.get("/")
        def endpoint(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Connection health check (used by get_evaluation_repo factory) ─────────────

def check_connection() -> bool:
    """Return True if the database is reachable, False otherwise."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("[DB] Connection healthy: %s", _sync_url.split("@")[-1])
        return True
    except Exception as exc:
        logger.error("[DB] Connection failed: %s", exc)
        return False
