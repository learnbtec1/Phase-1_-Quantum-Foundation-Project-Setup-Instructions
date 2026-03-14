# -*- coding: utf-8 -*-
"""
Alembic environment — يستخدم DATABASE_URL من .env
"""
from logging.config import fileConfig
import os
from dotenv import load_dotenv

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context

load_dotenv()

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# استيراد Base والنماذج لتسجيلها
from app.database import Base
from app.models.db_models import User, Assignment, Evaluation  # noqa: F401 — register with Base

target_metadata = Base.metadata

# استخدام DATABASE_URL من البيئة
database_url = os.getenv(
    "DATABASE_URL",
    "postgresql://nexus:nexus_secret@localhost:5432/nexus_db"
)
config.set_main_option("sqlalchemy.url", database_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
