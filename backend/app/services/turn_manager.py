# -*- coding: utf-8 -*-
"""
Per-WebSocket turn bookkeeping for cancellable LLM+TTS work.

Only turns started via ``begin_cancellable_turn`` (user reply tasks, welcome greet, …)
participate in interrupt/cancel semantics. Fire-and-forget or inline awaits may still
carry a ``turn_id`` for outbound timeline frames without being cancellable.
"""
from __future__ import annotations

import uuid
from typing import Optional


class AgentTurnSession:
    """Tracks the active interruptible turn id for one WebSocket session."""

    __slots__ = ("_cancellable_turn_id",)

    def __init__(self) -> None:
        self._cancellable_turn_id: Optional[str] = None

    @property
    def cancellable_turn_id(self) -> Optional[str]:
        return self._cancellable_turn_id

    def begin_cancellable_turn(self) -> str:
        tid = str(uuid.uuid4())
        self._cancellable_turn_id = tid
        return tid

    def end_cancellable_turn(self, turn_id: str) -> None:
        if self._cancellable_turn_id == turn_id:
            self._cancellable_turn_id = None

    def pop_cancellable_turn(self) -> Optional[str]:
        """Clear and return the active cancellable turn id (used on interrupt)."""
        tid = self._cancellable_turn_id
        self._cancellable_turn_id = None
        return tid
