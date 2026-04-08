# -*- coding: utf-8 -*-
"""
Shim module for tooling that references `tutorial_mode` (V44).

Canonical implementations:
- `tutorial_progress_store` — PostgreSQL `tutorial_progress` rows
- `tutorial_session_bridge` — tutor ↔ mini-check ↔ metadata
- `mini_check_evaluator` — structured LLM rubric for mini-checks
- `training_mode.py` — optional Chroma-backed practice questions (separate flow)
"""
from __future__ import annotations

from app.archive import mini_check_evaluator
from app.services import tutorial_progress_store
from app.services import tutorial_session_bridge

__all__ = [
    "mini_check_evaluator",
    "tutorial_progress_store",
    "tutorial_session_bridge",
]
