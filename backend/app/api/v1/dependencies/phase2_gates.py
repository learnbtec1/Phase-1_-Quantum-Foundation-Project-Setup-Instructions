# -*- coding: utf-8 -*-
"""
TTS gate for ref-stack endpoints — authenticated user via ``deps.gate_tts_user``.
"""

from __future__ import annotations

from app.api.deps import gate_tts_user

__all__ = ["gate_tts_user"]
