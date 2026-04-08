# -*- coding: utf-8 -*-
"""Inbound WebSocket JSON hardening — block known prompt-injection / tool-override keys."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Top-level keys the browser client must never send (jailbreak / alternate system channel).
FORBIDDEN_WS_TOP_LEVEL_KEYS = frozenset(
    {
        "override_prompt",
        "custom_instructions",
        "llm_config",
        "system_message",
        "developer_message",
        "raw_system",
        "tool_choice",
        "tools_override",
    }
)


def validate_ws_client_message(msg: Any) -> None:
    """
    Raises ValueError if the payload contains forbidden top-level keys.
    Note: Legitimate frames may still carry keys like ``prompt`` (session_feedback) —
    those are not blocked here.
    """
    if not isinstance(msg, dict):
        raise ValueError("invalid_json_object")
    for key in FORBIDDEN_WS_TOP_LEVEL_KEYS:
        if key in msg:
            logger.warning("[WS] rejected inbound frame: forbidden key %r", key)
            raise ValueError(f"forbidden_field:{key}")
    # OpenAI-style chat array injected at root — not part of our protocol
    if "messages" in msg and isinstance(msg.get("messages"), list):
        logger.warning("[WS] rejected inbound frame: forbidden messages[]")
        raise ValueError("forbidden_field:messages")
