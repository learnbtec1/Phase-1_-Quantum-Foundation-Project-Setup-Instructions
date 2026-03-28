"""
NEXUS backend — alternate entry re-export.

Docker CMD uses: `uvicorn app.main:app`

This module exists so tooling/docs that reference `backend/main.py` resolve to the same FastAPI app.
"""
import os
import sys

_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from app.main import app  # noqa: F401

__all__ = ["app"]
