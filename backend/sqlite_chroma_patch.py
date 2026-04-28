"""
ChromaDB requires SQLite >= 3.35. Many Linux images ship older libsqlite.

The app uses an inline patch in ``app.main``, ``tutor`` endpoint, and ``btec_ingest``.
Call ``apply_sqlite_chroma_patch()`` from standalone scripts if you prefer one import.
Requires ``pysqlite3-binary`` (see requirements.txt).
"""
from __future__ import annotations

import sys


def apply_sqlite_chroma_patch() -> None:
    try:
        __import__("pysqlite3")
    except ImportError:
        return
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
