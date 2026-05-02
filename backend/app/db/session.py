# -*- coding: utf-8 -*-
"""Psycopg (v3) connection helpers. Use for transactional app code; vector I/O is in `vector_service`."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg import Connection

from app.core.config import settings
from app.db import base

logger = logging.getLogger(__name__)


def _require_postgres() -> None:
    u = (settings.DATABASE_URL or "").strip()
    if not u.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection string for EDUVERS-CORE.")


@contextmanager
def get_db_connection() -> Iterator[Connection]:
    """Synchronous connection for user/document CRUD and DDL."""
    _require_postgres()
    with psycopg.connect(settings.DATABASE_URL) as conn:
        yield conn


def ensure_user_document_schema(conn: Connection) -> None:
    for stmt in base.USERS_AND_DOCUMENTS_DDL:
        conn.execute(stmt)
    conn.commit()
