"""
ChromaDB requires SQLite >= 3.35. Many Linux images ship older libsqlite.

Call apply_sqlite_chroma_patch() once at process start, before `import chromadb`,
so Python's stdlib `sqlite3` uses the bundled binary from `pysqlite3-binary` when installed.
"""
from __future__ import annotations

import sys


def apply_sqlite_chroma_patch() -> None:
    try:
        __import__("pysqlite3")
    except ImportError:
        return
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
