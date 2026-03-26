# -*- coding: utf-8 -*-
"""
Emotional / episodic memory facade for Cogni (backend).

- Client-side trajectory lives in the frontend BrainStore (user mood vs avatar emotion).
- This module re-exports **server-side episodic** helpers from `episodic_memory.py`
  (`add_episode` stores both avatar reply `emotion` and optional `user_mood`).

Import `retrieve_for_prompt` / `add_episode` from here for stable API names.
"""
from __future__ import annotations

from app.services.episodic_memory import add_episode, retrieve_for_prompt

__all__ = ["add_episode", "retrieve_for_prompt"]
