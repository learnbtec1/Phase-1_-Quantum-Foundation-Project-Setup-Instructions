# -*- coding: utf-8 -*-
"""
Endpoint subpackage — individual routers are included from ``app.main``.

An empty aggregate ``router`` is kept so ``from app.api.v1.endpoints import router``
remains valid; do not add ``include_router`` here (single source of truth: ``main.py``).
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
