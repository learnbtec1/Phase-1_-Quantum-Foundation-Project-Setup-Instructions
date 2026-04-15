# -*- coding: utf-8 -*-
"""
Database configuration — engine, SessionLocal, Base, get_db
"""

from __future__ import annotations
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# USE_DB=true → PostgreSQL (يتطلب psycopg2-binary)
# USE_DB=false وبدون DATABASE_URL → sqlite محلي (استيراد app.main بدون Postgres)
_use_db = os.getenv("USE_DB", "false").lower() in ("true", "1", "yes")
_env_db = (os.getenv("DATABASE_URL") or "").strip()
if _use_db:
    if not _env_db:
        raise RuntimeError(
            "USE_DB=true requires DATABASE_URL to be set. "
            "Do not rely on embedded defaults; configure Postgres in the environment or docker-compose."
        )
    DATABASE_URL = _env_db
else:
    DATABASE_URL = _env_db or "sqlite:///./test.db"

_pool_size = int(os.getenv("DB_POOL_SIZE", "10"))
_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "20"))

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=_pool_size,
    max_overflow=_max_overflow,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency للحصول على جلسة قاعدة البيانات."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
