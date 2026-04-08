# -*- coding: utf-8 -*-
"""
Shim for legacy imports.

Strict JSON schema and parsing live in :mod:`app.services.cogni_output_schema`.
The previous version of this file mistakenly duplicated ``agent_ws`` and imported
from itself; that copy has been removed.
"""
from __future__ import annotations

from app.services.cogni_output_schema import (
    COGNI_SYSTEM_PROMPT,
    CogniGesture,
    CogniOutput,
    cogni_output_to_dict,
    cogni_strict_json_enabled,
    parse_llm_reply_strict_json,
    validate_cogni_output,
)

__all__ = [
    "COGNI_SYSTEM_PROMPT",
    "CogniGesture",
    "CogniOutput",
    "cogni_output_to_dict",
    "cogni_strict_json_enabled",
    "parse_llm_reply_strict_json",
    "validate_cogni_output",
]
