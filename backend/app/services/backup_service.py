# -*- coding: utf-8 -*-
"""Postgres logical backup/restore via pg_dump / psql (no ORM, no schema changes)."""
from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from app.core.config import settings

logger = logging.getLogger(__name__)

# Same family as auto dumps: backup_YYYY-MM-DD.sql; manual adds time to avoid clobber
_SAFE_BACKUP_NAME = re.compile(r"^backup_[A-Za-z0-9_.-]+\.sql$")


@dataclass
class BackupFileInfo:
    name: str
    size_bytes: int
    modified_utc: datetime


def _backup_base() -> Path:
    return Path(settings.BACKUP_DIR).resolve()


def _ensure_backup_dir() -> Path:
    base = _backup_base()
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not base.is_dir():
        raise RuntimeError(f"BACKUP_DIR is not a directory: {base}")
    if not os.access(base, os.W_OK | os.R_OK | os.X_OK):
        raise RuntimeError(f"BACKUP_DIR not accessible: {base}")
    return base


def _resolve_safe_path(filename: str) -> Path:
    if not _SAFE_BACKUP_NAME.match(filename):
        raise ValueError("Invalid backup filename")
    base = _ensure_backup_dir()
    path = (base / filename).resolve()
    if not str(path).startswith(str(base)):
        raise ValueError("Path traversal rejected")
    return path


def safe_backup_path(filename: str) -> Path:
    """Public: validate and resolve a backup file under BACKUP_DIR (no path traversal)."""
    return _resolve_safe_path(filename)


def list_backups() -> List[BackupFileInfo]:
    base = _ensure_backup_dir()
    out: List[BackupFileInfo] = []
    for p in base.iterdir():
        if p.is_file() and p.suffix == ".sql" and _SAFE_BACKUP_NAME.match(p.name):
            st = p.stat()
            out.append(
                BackupFileInfo(
                    name=p.name,
                    size_bytes=st.st_size,
                    modified_utc=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                )
            )
    out.sort(key=lambda x: x.modified_utc, reverse=True)
    return out


def _run_pg_cmd(args: list[str]) -> None:
    env = os.environ.copy()
    # pg_dump / psql read libpq connection string from first arg
    try:
        proc = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=7200,
            env=env,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("PostgreSQL client timed out") from e
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        raise RuntimeError(err)


def _retention_cleanup() -> None:
    base = _ensure_backup_dir()
    retain = int(settings.BACKUP_RETAIN_COUNT)
    files: List[Path] = [
        p
        for p in base.iterdir()
        if p.is_file() and p.suffix == ".sql" and _SAFE_BACKUP_NAME.match(p.name)
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[retain:]:
        try:
            old.unlink()
            logger.info("backup retention removed: %s", old.name)
        except OSError as e:
            logger.warning("retention could not remove %s: %s", old, e)


def run_manual_backup() -> str:
    """Create a new plain SQL dump; return filename."""
    _ensure_backup_dir()
    dsn = (settings.DATABASE_URL or "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    name = f"backup_manual_{ts}.sql"
    out_path = _resolve_safe_path(name)
    # File must not exist
    if out_path.exists():
        raise RuntimeError("Backup file already exists")

    _run_pg_cmd(
        [
            "pg_dump",
            dsn,
            "--no-owner",
            "--no-acl",
            "-F",
            "p",
            "-f",
            str(out_path),
        ]
    )
    _retention_cleanup()
    logger.info("manual backup created: %s (%s bytes)", name, out_path.stat().st_size)
    return name


def run_restore(filename: str) -> None:
    path = _resolve_safe_path(filename)
    if not path.is_file():
        raise ValueError("Backup file not found")
    dsn = (settings.DATABASE_URL or "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")

    _run_pg_cmd(
        [
            "psql",
            dsn,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(path),
        ]
    )
    logger.info("database restore completed from file=%s", filename)
