# -*- coding: utf-8 -*-
"""LLM-based mini-check evaluation for BTEC scaffolding (Pass-focused rubric)."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def _parse_json_obj(raw: str) -> Optional[dict]:
    t = (raw or "").strip()
    if not t:
        return None
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


async def evaluate_mini_check(
    student_answer: str,
    criterion_id: str,
    reference_context: str,
    *,
    previous_attempts: int = 0,
) -> Dict[str, Any]:
    """
    Returns { passed, feedback, confidence, next_hint }.
    """
    import os

    from app.services.llm_client import cogni_chat_completion

    out: Dict[str, Any] = {
        "passed": False,
        "feedback": "",
        "confidence": 0.0,
        "next_hint": "",
    }
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        out["feedback"] = "تعذر تشغيل التقييم الآلي حالياً؛ واصل شرح فهمك بجملة أخرى."
        return out

    band = "Pass"
    m = re.search(r"\.([PMD])\d+", criterion_id or "", re.I)
    if m:
        band = {"P": "Pass", "M": "Merit", "D": "Distinction"}.get(m.group(1).upper(), "Pass")

    sys = (
        "You are a strict BTEC examiner assistant. Decide if the student's short answer shows "
        f"adequate understanding for criterion {criterion_id!r} at **{band}** level.\n"
        "Use ONLY the reference context; do not invent case facts.\n"
        "Reply with a single JSON object: "
        '{"passed": true/false, "feedback": "1-3 short sentences in Arabic (Jordanian-friendly)", '
        '"confidence": 0.0-1.0, "next_hint": "optional Arabic hint if not passed and attempts are low"}\n'
        "passed=true only if the answer is substantially on-topic and shows understanding (not copy-paste of question).\n"
    )
    user = (
        f"Criterion: {criterion_id}\nBand: {band}\n"
        f"Previous attempts (hint tier): {int(previous_attempts)}\n\n"
        f"Reference:\n{(reference_context or '')[:10000]}\n\n"
        f"Student answer:\n{(student_answer or '')[:4000]}\n"
    )
    try:
        raw = await cogni_chat_completion(
            [{"role": "system", "content": sys}, {"role": "user", "content": user}],
            max_tokens=280,
            temperature=0.25,
        )
        parsed = _parse_json_obj(raw or "")
        if isinstance(parsed, dict):
            out["passed"] = bool(parsed.get("passed"))
            out["feedback"] = str(parsed.get("feedback") or "").strip()[:1200]
            try:
                out["confidence"] = float(parsed.get("confidence", 0))
            except (TypeError, ValueError):
                out["confidence"] = 0.5
            out["next_hint"] = str(parsed.get("next_hint") or "").strip()[:800]
        if not out["feedback"]:
            out["feedback"] = "راجع صياغتك وربطها بالمعيار والسيناريو في المنهج."
    except Exception as ex:
        logger.warning("[mini_check_evaluator] evaluate_mini_check failed: %s", ex)
        out["feedback"] = "حصل خطأ تقني أثناء التقييم؛ جرّب إجابة أقصر وأوضح."
    if not out["passed"] and int(previous_attempts) < 2 and not out["next_hint"]:
        out["next_hint"] = "ركّز على تعريف المفهوم بجملة واحدة مرتبطة بالسيناريو في الوثيقة."
    return out
