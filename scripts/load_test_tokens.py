# -*- coding: utf-8 -*-
"""Shared helpers for TTS load tests (tokens + optional extra headers)."""
from __future__ import annotations

import os


def resolve_tokens(
    *,
    tokens_csv: str | None = None,
    single_token: str | None = None,
) -> list[str]:
    """
    Multi-user JWT pool for bypassing per-user TTS rate limits.

    Priority:
      1. tokens_csv (non-empty): comma-separated JWTs
      2. env LOAD_TEST_TOKENS
      3. single_token or env TTS_LOAD_TEST_TOKEN (one token)

    Empty list => no Authorization header (e.g. COGNI_DEV_BYPASS_AUTH).
    """
    raw = (tokens_csv or "").strip()
    if not raw:
        raw = (os.getenv("LOAD_TEST_TOKENS", "") or "").strip()
    if raw:
        return [t.strip() for t in raw.split(",") if t.strip()]
    one = (single_token or os.getenv("TTS_LOAD_TEST_TOKEN", "") or "").strip()
    return [one] if one else []


def parse_extra_headers(raw: str | None) -> dict[str, str]:
    """
    Comma-separated pairs: ``Name:Value,Name2:Value2`` (values may contain colons).
    Also reads env LOAD_TEST_HEADERS if raw is None/empty.
    """
    s = (raw or "").strip()
    if not s:
        s = (os.getenv("LOAD_TEST_HEADERS", "") or "").strip()
    if not s:
        return {}
    out: dict[str, str] = {}
    for part in s.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        name, value = part.split(":", 1)
        name, value = name.strip(), value.strip()
        if name:
            out[name] = value
    return out
