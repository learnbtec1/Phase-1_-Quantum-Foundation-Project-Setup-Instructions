# -*- coding: utf-8 -*-
"""
API v1 package.

**Routers are registered only in** ``app.main`` via ``app.include_router(...)``.
This module exposes an empty ``router`` for compatibility; it does **not**
duplicate mounts that would diverge from production (historically some code
tried to aggregate ``/evaluate`` + ``/tutor`` here — that pattern is retired).

Canonical HTTP entrypoints include:
  - ``POST /api/v1/chat`` — primary chat (intent, history shape)
  - ``POST /api/v1/tutor/chat`` — tutor ``ChatRequest`` / ``ChatResponse`` API
  - ``/api/v1/assessment/*`` — grading
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
