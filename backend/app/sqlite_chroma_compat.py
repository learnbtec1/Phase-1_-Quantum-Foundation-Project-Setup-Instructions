# -*- coding: utf-8 -*-
"""ChromaDB requires SQLite >= 3.35. Many Linux images (e.g. Debian bullseye) ship older libs.

Call ``ensure_modern_sqlite3_for_chroma()`` before ``import chromadb``. When ``pysqlite3-binary``
is installed, this aliases it as the stdlib ``sqlite3`` module so Chroma's version check passes.
"""
from __future__ import annotations

_applied = False


def ensure_modern_sqlite3_for_chroma() -> None:
    global _applied
    if _applied:
        return
    _applied = True
    try:
        __import__("pysqlite3")
    except ImportError:
        return
    import sys

    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
