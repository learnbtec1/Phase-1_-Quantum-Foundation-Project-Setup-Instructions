# -*- coding: utf-8 -*-
"""Whitelisted server-side tools for Cogni OpenAI function calling."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_BTEC_CRITERION_CODE_RE = re.compile(r"^[PMD]\d+$", re.I)


def _tool_get_server_utc_time(_: Dict[str, Any]) -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def run_cogni_tool(
    name: str,
    arguments_json: str,
    *,
    timeout_sec: float = 8.0,
    context: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, str]:
    """
    Execute a single tool by name. Unknown names fail closed.
    Returns (ok, message_or_error).
    """
    try:
        args = json.loads(arguments_json or "{}")
    except Exception:
        args = {}

    async def _body() -> Tuple[bool, str]:
        if name == "get_server_utc_time":
            try:
                return True, _tool_get_server_utc_time(args)
            except Exception as e:
                return False, str(e)
        if name == "btec_update_criterion":
            return _tool_btec_update_criterion(args, context)
        logger.warning("[cogni_tools] disallowed tool requested: %s", name)
        return False, f"unknown_tool:{name}"

    try:
        return await asyncio.wait_for(_body(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        return False, "tool_timeout"


def _tool_btec_update_criterion(
    args: Dict[str, Any],
    context: Optional[Dict[str, Any]],
) -> Tuple[bool, str]:
    ctx = context or {}
    aid = str(ctx.get("assignment_id") or "").strip()
    if not aid:
        return False, "assignment_id missing in session context — client should send assignment_id on text frames or URL sync"
    code = str(args.get("criterion_code") or "").strip().upper()
    status = str(args.get("status") or "").strip().lower()
    evidence = str(args.get("evidence") or "").strip()
    if not _BTEC_CRITERION_CODE_RE.match(code):
        return False, f"invalid criterion_code: {code}"
    if status not in ("achieved", "in_progress", "not_started"):
        return False, f"invalid status: {status}"
    user_key = str(ctx.get("billing_user_id") or ctx.get("session_id") or "guest")[:128]

    from app.services.btec_session_progress import store_criterion_update

    ok = store_criterion_update(
        user_key=user_key,
        assignment_id=aid,
        criterion_code=code,
        status=status,
        evidence=evidence,
    )
    hud_status = "done" if status == "achieved" else "pending" if status == "in_progress" else "missing"
    frame = {
        "assignment_id": aid,
        "criterion_code": code,
        "status": status,
        "hud_status": hud_status,
        "evidence": evidence[:500],
    }
    ctx.setdefault("_cogni_btec_ws_frames", []).append(frame)
    if ok:
        return True, json.dumps({"ok": True, "criterion_code": code, "status": status}, ensure_ascii=False)
    return True, json.dumps(
        {"ok": True, "warning": "redis_unavailable", "criterion_code": code, "status": status},
        ensure_ascii=False,
    )


OPENAI_TOOLS_SPEC: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_server_utc_time",
            "description": (
                "Current UTC date and time on the server (ISO 8601). "
                "Use when the student asks for the time or for time-relative context."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "btec_update_criterion",
            "description": (
                "Update a BTEC criterion status for the current assignment (Pass/Merit/Distinction tracking). "
                "Call when the student demonstrates understanding of a named criterion (e.g. P1, M2, D1)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "criterion_code": {
                        "type": "string",
                        "description": "Criterion code e.g. P1, M2, D3",
                    },
                    "status": {
                        "type": "string",
                        "enum": ["achieved", "in_progress", "not_started"],
                        "description": "Progress state for this criterion",
                    },
                    "evidence": {
                        "type": "string",
                        "description": "Short snippet from the dialogue showing why this status applies",
                    },
                },
                "required": ["criterion_code", "status"],
                "additionalProperties": False,
            },
        },
    },
]
