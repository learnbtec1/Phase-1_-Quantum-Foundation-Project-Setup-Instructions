# -*- coding: utf-8 -*-
"""
Persistent PASS0 spec cache: same assignment text → same validated spec (determinism across restarts).
Uses SQLite (stdlib only); path under backend/data/.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "pass0_spec.sqlite"


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=30.0)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS pass0_spec (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated REAL NOT NULL)"
    )
    conn.commit()
    return conn


def disk_spec_get(key: str) -> Optional[Dict[str, Any]]:
    if not key:
        return None
    with _lock:
        try:
            conn = _connect()
            cur = conn.execute("SELECT v, updated FROM pass0_spec WHERE k = ?", (key,))
            row = cur.fetchone()
            conn.close()
            if not row or not row[0]:
                return None
            try:
                ttl = float(
                    int(getattr(settings, "ASSESSMENT_PASS0_DISK_TTL_SECONDS", 3600) or 3600)
                )
            except (TypeError, ValueError):
                ttl = 3600.0
            try:
                updated_at = float(row[1] or 0.0)
            except (TypeError, ValueError):
                updated_at = 0.0
            if updated_at and (time.time() - updated_at) > ttl:
                return None
            return json.loads(row[0])
        except Exception:
            logger.exception("pass0 disk get failed")
            return None


def disk_spec_set(key: str, spec: Dict[str, Any]) -> None:
    if not key or not isinstance(spec, dict):
        return
    with _lock:
        try:
            import time

            conn = _connect()
            payload = json.dumps(spec, ensure_ascii=False)
            conn.execute(
                "INSERT OR REPLACE INTO pass0_spec (k, v, updated) VALUES (?, ?, ?)",
                (key, payload, time.time()),
            )
            conn.commit()
            conn.close()
        except Exception:
            logger.exception("pass0 disk set failed")
