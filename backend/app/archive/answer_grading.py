# -*- coding: utf-8 -*-
"""Grade curriculum questions: MCQ, short answer, essay (LLM-assisted)."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, Optional

from app.models.db_models import Question
from app.archive.forensic_engine import normalize_text

logger = logging.getLogger(__name__)


def _grade_mcq(question: Question, student_text: str) -> Dict[str, Any]:
    raw = (student_text or "").strip()
    correct = (question.correct_answer or "").strip()
    opts = question.options
    if isinstance(opts, list):
        letters = "أبتثجحخدذرزسشصضطظعغفقكلمنهوي"
        for i, lab in enumerate(opts):
            if normalize_text(raw) == normalize_text(str(lab)):
                is_ok = False
                if correct:
                    is_ok = normalize_text(str(lab)) == normalize_text(correct) or str(i) == correct.strip()
                else:
                    is_ok = i == 0
                score = 1.0 if is_ok else 0.0
                return {
                    "score": score,
                    "feedback": "إجابة صحيحة." if score >= 1.0 else "ليس الخيار الأنسب — راجع الخيارات.",
                }
    # match correct text directly
    if correct and normalize_text(raw) == normalize_text(correct):
        return {"score": 1.0, "feedback": "إجابة صحيحة."}
    # single letter / رقم
    if correct and raw and normalize_text(raw)[:1] == normalize_text(correct)[:1]:
        return {"score": 1.0, "feedback": "إجابة صحيحة."}
    return {"score": 0.0, "feedback": "الإجابة غير مطابقة للمفتاح الصحيح."}


async def _grade_short_llm(question: Question, student_text: str) -> Dict[str, Any]:
    key = (question.correct_answer or "").strip()
    st = (student_text or "").strip()
    if key and normalize_text(st) == normalize_text(key):
        return {"score": 1.0, "feedback": "مطابقة للإجابة النموذجية."}
    if key:
        # token overlap ratio
        a, b = set(normalize_text(st).split()), set(normalize_text(key).split())
        if a and b:
            overlap = len(a & b) / max(len(b), 1)
            if overlap >= 0.85:
                return {"score": 1.0, "feedback": "إجابة قريبة جداً من النموذج."}
            if overlap >= 0.5:
                return {"score": 0.7, "feedback": "جزء من الفكرة صحيح — راجع الصياغة."}
    try:
        from app.services.llm_client import cogni_chat_completion

        prompt = (
            f"سؤال قصير:\n{question.text}\n\n"
            f"إجابة نموذجية مختصرة: {key or '—'}\n\n"
            f"إجابة الطالب:\n{st}\n\n"
            'أخرج JSON فقط بدون markdown: {"score": <0..1 float>, "feedback": "<عربي قصير>"}'
        )
        raw = await cogni_chat_completion(
            [{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.2,
        )
        m = re.search(r"\{[\s\S]*\}", raw or "")
        if m:
            data = json.loads(m.group(0))
            sc = float(data.get("score", 0))
            sc = max(0.0, min(1.0, sc))
            return {"score": sc, "feedback": str(data.get("feedback", ""))[:800]}
    except Exception as e:
        logger.warning("short LLM grade failed: %s", e)
    return {"score": 0.5, "feedback": "تم تسجيل إجابتك للمراجعة."}


async def _grade_essay_llm(question: Question, student_text: str) -> Dict[str, Any]:
    rubric = (question.rubric or question.correct_answer or "وضوح الفكرة، الاكتمال، والأمثلة.").strip()
    try:
        from app.services.llm_client import cogni_chat_completion

        prompt = (
            f"أنت مقيّم أكاديمي. قيّم إجابة الطالب من 0 إلى 1 (رقم عشري).\n"
            f"السؤال:\n{question.text}\n\n"
            f"المعايير:\n{rubric}\n\n"
            f"إجابة الطالب:\n{(student_text or '').strip()}\n\n"
            'أخرج JSON فقط: {"score": <0..1>, "feedback": "<ملاحظات بالعربية>"}'
        )
        raw = await cogni_chat_completion(
            [{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.35,
        )
        m = re.search(r"\{[\s\S]*\}", raw or "")
        if m:
            data = json.loads(m.group(0))
            sc = float(data.get("score", 0))
            sc = max(0.0, min(1.0, sc))
            return {"score": sc, "feedback": str(data.get("feedback", ""))[:1200]}
    except Exception as e:
        logger.warning("essay LLM grade failed: %s", e)
    return {"score": 0.5, "feedback": "تم استلام الإجابة؛ تعذر إكمال التقييم الآن."}


async def grade_curriculum_answer(question: Question, student_text: str) -> Dict[str, Any]:
    """Return {score: 0..1, feedback: str}."""
    t = (question.type or "short_answer").lower()
    if t == "mcq":
        return _grade_mcq(question, student_text)
    if t == "short_answer":
        return await _grade_short_llm(question, student_text)
    if t == "essay":
        return await _grade_essay_llm(question, student_text)
    return await _grade_short_llm(question, student_text)


def attach_grade_timestamp(result: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(result)
    result["graded_at"] = datetime.utcnow().isoformat()
    return result
