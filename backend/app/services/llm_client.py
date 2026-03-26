# -*- coding: utf-8 -*-
"""
LLM client for Cogni — single place for OpenAI chat parameters (penalties, tokens).

FIX: frequency_penalty + presence_penalty reduce repetitive phrasing within a session.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, List, Dict, Optional

from app.core.config import settings as _settings

logger = logging.getLogger(__name__)


def _tokenize_for_overlap(text: str) -> set[str]:
    """Very light Arabic/Latin token set for similarity (no external deps)."""
    if not text:
        return set()
    import re

    raw = re.sub(r"\[EMOTION:\s*\w+\]", " ", text, flags=re.I)
    raw = re.sub(r"\*[^*]*\*", " ", raw)
    parts = re.findall(r"[\w\u0600-\u06FF]+", raw.lower())
    return {p for p in parts if len(p) > 1}


def jaccard_token_similarity(a: str, b: str) -> float:
    sa, sb = _tokenize_for_overlap(a), _tokenize_for_overlap(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def should_rephrase_for_repetition(
    new_text: str,
    prior_assistant: str,
    *,
    threshold: float | None = None,
) -> bool:
    """True if the new reply is too close to the previous assistant turn (stems duplicate loops)."""
    t = threshold if threshold is not None else _DEFAULT_SIMILARITY
    prior = (prior_assistant or "").strip()
    if len(prior) < 24 or len((new_text or "").strip()) < 24:
        return False
    return jaccard_token_similarity(new_text, prior) >= t

# Defaults (tunable via env). OpenAI has no "repetition_penalty"; frequency + presence reduce repeats.
_DEFAULT_FREQ = float(os.getenv("COGNI_FREQUENCY_PENALTY", "0.65"))
_DEFAULT_PRES = float(os.getenv("COGNI_PRESENCE_PENALTY", "0.72"))
_DEFAULT_SIMILARITY = float(os.getenv("COGNI_REPEAT_SIMILARITY_THRESHOLD", "0.82"))


async def cogni_chat_completion(
    messages: List[Dict[str, Any]],
    *,
    model: Optional[str] = None,
    max_tokens: int = 500,
    temperature: float = 0.7,
    frequency_penalty: Optional[float] = None,
    presence_penalty: Optional[float] = None,
    user_id: Optional[uuid.UUID] = None,
) -> str:
    """
    Run OpenAI chat.completions with Cogni defaults including repetition penalties.
    """
    from openai import AsyncOpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    client = AsyncOpenAI(api_key=api_key)
    m = model or _settings.TUTOR_MODEL
    fp = _DEFAULT_FREQ if frequency_penalty is None else frequency_penalty
    pp = _DEFAULT_PRES if presence_penalty is None else presence_penalty

    if user_id:
        from app.core.rate_limit import OPENAI_TOKEN_LIMIT_PER_MINUTE, minute_token_count, check_minute_tokens

        ident = str(user_id)
        cur = minute_token_count(ident)
        if cur + max_tokens > OPENAI_TOKEN_LIMIT_PER_MINUTE:
            raise RuntimeError("OPENAI_TOKEN_RATE_LIMIT")

    resp = await client.chat.completions.create(
        model=m,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        frequency_penalty=fp,
        presence_penalty=pp,
    )
    out = (resp.choices[0].message.content or "").strip()
    try:
        usage = getattr(resp, "usage", None)
        if usage and user_id:
            from app.core.rate_limit import check_minute_tokens
            from app.services.usage_service import log_openai_usage

            total_tokens = int(getattr(usage, "total_tokens", None) or 0)
            check_minute_tokens(str(user_id), total_tokens)
            log_openai_usage(
                user_id,
                total_tokens=total_tokens,
                model=m,
            )
    except Exception:
        pass
    return out
