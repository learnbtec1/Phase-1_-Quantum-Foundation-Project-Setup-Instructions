# -*- coding: utf-8 -*-
"""
Optional “guided improvement” pass: nudge text toward the next BTEC band while preserving student voice.
Includes Style Guard (sequence similarity) and light diff preview for UX.
"""
from __future__ import annotations

import difflib
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from app.core.config import settings
from app.services.teacher_memory_service import (
    format_memory_for_rewrite_with_meta,
    load_merged_memory_for_rewrite,
)

logger = logging.getLogger(__name__)

SYSTEM_REWRITE_CORE = """You are an academic writing assistant for students.

Your goal is to IMPROVE the student’s answer while preserving their personal writing style.

CRITICAL RULES:

1) PRESERVE STUDENT VOICE
- Keep sentence structure broadly similar
- Keep vocabulary level similar
- Keep the same tone (simple, student-like)
- Do NOT sound like an expert or teacher; do not sound like a different person

2) LIMIT CHANGES
- Do NOT change more than about 30% of the text (edit locally; do not rewrite from scratch)
- Do NOT answer the assignment “perfectly” — nudge, don’t replace

3) DO NOT
- Add advanced terminology
- Add new ideas not already implied (even weakly) by the student
- Add invented facts, figures, or names

4) IMPROVE BY
- Clarifying unclear parts
- Adding simple cause/effect where it helps
- Slightly expanding short explanations
- Tightening logical flow

5) LEVEL-BASED (Target Level is given in the user message)
- If target = Merit: add relationships (because, leads to, affects) only where the student’s ideas allow
- If target = Distinction: add a simple judgement + short reason in the student’s voice (e.g. I think / because) only if appropriate
"""


def _rewrite_output_section(submission_format: Optional[str]) -> str:
    f = (submission_format or "mixed").strip()
    if f == "bullet_points":
        return """
6) OUTPUT FORMAT (exactly these two blocks, in English labels)

[IMPROVED ANSWER]
(Keep bullet-style structure; do NOT convert the whole answer into one long essay. You may add short sub-bullets or a brief reason after a bullet.)

[WHAT WAS IMPROVED]
- 2 or 3 short bullet points in the same language as the student (Arabic or English)

The improved block MUST read as the SAME student, only clearer."""
    if f == "slides_style":
        return """
6) OUTPUT FORMAT (exactly these two blocks, in English labels)

[IMPROVED ANSWER]
(Keep short, concise lines suitable for slides; do not force long paragraphs.)

[WHAT WAS IMPROVED]
- 2 or 3 short bullet points in the same language as the student (Arabic or English)

The improved block MUST read as the SAME student, only clearer."""
    return """
6) OUTPUT FORMAT (exactly these two blocks, in English labels)

[IMPROVED ANSWER]
(the full improved text only — no bullets here)

[WHAT WAS IMPROVED]
- 2 or 3 short bullet points in the same language as the student (Arabic or English)

The improved block MUST read as the SAME student, only clearer."""


def _rewrite_format_lock_extra(submission_format: Optional[str]) -> str:
    f = (submission_format or "mixed").strip()
    if f == "bullet_points":
        return "\n\nFORMAT LOCK (detected: bullets): Keep bullet format. Do not convert to continuous paragraphs."
    if f == "slides_style":
        return "\n\nFORMAT LOCK (detected: slides-style): Keep short concise lines; one clear idea per line when possible."
    return ""


def text_similarity(a: str, b: str) -> float:
    """0–1; higher = more character overlap (style guard; not semantic)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return float(difflib.SequenceMatcher(None, a, b).ratio())


def _extract_blocks(raw: str) -> Tuple[str, List[str]]:
    """Parse [IMPROVED ANSWER] and [WHAT WAS IMPROVED] from model output."""
    t = (raw or "").strip()
    if not t:
        return "", []

    m_imp = re.search(r"\[IMPROVED ANSWER\]\s*", t, re.IGNORECASE | re.DOTALL)
    if not m_imp:
        return "", []
    start = m_imp.end()
    m_what = re.search(r"\[WHAT WAS IMPROVED\]", t[start:], re.IGNORECASE)
    if m_what:
        rel = m_what.start()
        body = t[start : start + rel].strip()
        rest = t[start + m_what.end() :].strip()
    else:
        body = t[start:].strip()
        rest = ""
    notes: List[str] = []
    for line in rest.splitlines():
        s2 = line.strip()
        if not s2:
            continue
        s2 = re.sub(r"^[-•*・]\s*", "", s2)
        if s2:
            notes.append(s2)
    return body, notes[:5]


def build_diff_preview(original: str, improved: str, max_lines: int = 20) -> str:
    """Compact unified diff (line-based) for UI; capped for API size."""
    a = (original or "").splitlines()
    b = (improved or "").splitlines()
    d = list(
        difflib.unified_diff(
            a,
            b,
            fromfile="قبل",
            tofile="بعد",
            lineterm="",
        )
    )[: max_lines + 4]
    return "\n".join(d)[:4000]


def generate_student_rewrite(
    original_text: str,
    target_level: str,
    *,
    client: Optional[OpenAI] = None,
    user_id: Optional[int] = None,
    memory_scope_key: Optional[str] = None,
    submission_format: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Returns a dict: improved, notes, style_guard_triggered, similarity, mode, target_level.
    On style guard or API failure, `improved` is the original text and notes explain why.
    """
    mode = "guidance_only"
    o = (original_text or "").strip()
    if not o:
        return {
            "improved": "",
            "notes": ["لا نص لمعالجته."],
            "style_guard_triggered": False,
            "similarity": 1.0,
            "mode": mode,
            "target_level": target_level,
            "teacher_memory_used": False,
            "memory_explanation": [],
            "error": "empty",
        }

    cap = max(2_000, min(int(settings.STUDENT_REWRITE_MAX_CHARS), 20_000))
    truncated = False
    if len(o) > cap:
        o = o[: cap - 1] + "…"
        truncated = True

    if client is None:
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
    model = settings.resolved_openai_rewrite_model()
    style_hint = ""
    memory_explanation: List[str] = []
    if getattr(settings, "TEACHER_MEMORY_ENABLED", True):
        try:
            # Global + optional subject/assignment bucket (all teachers; blended, capped, QC on writes)
            mem = load_merged_memory_for_rewrite(memory_scope_key)
            style_hint, memory_explanation, _ = format_memory_for_rewrite_with_meta(mem)
        except Exception as e:
            memory_explanation = []
            logger.debug("teacher memory load skipped: %s", e)
    system_content = (
        SYSTEM_REWRITE_CORE
        + _rewrite_output_section(submission_format)
        + (style_hint or "")
        + _rewrite_format_lock_extra(submission_format)
    )
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.35,
            max_tokens=4096,
            messages=[
                {"role": "system", "content": system_content},
                {
                    "role": "user",
                    "content": (
                        f"Target Level: {target_level}\n\n"
                        f"Student Answer:\n{o}\n\n"
                        "Follow all rules. Use the two output sections exactly as specified."
                    ),
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        logger.exception("student rewrite API failed: %s", e)
        return {
            "improved": o,
            "notes": [f"تعذّر توليد مثال التطوير تلقائياً: {e!s}"],
            "style_guard_triggered": True,
            "similarity": 1.0,
            "mode": mode,
            "target_level": target_level,
            "teacher_memory_used": bool(style_hint),
            "memory_explanation": list(memory_explanation),
            "error": str(e),
        }

    improved, notes = _extract_blocks(raw)
    if not improved.strip():
        return {
            "improved": o,
            "notes": ["لم يُستخرج نصٌّ محسّن من النموذج؛ حُفظ نصك كما هو."],
            "style_guard_triggered": True,
            "similarity": 0.0,
            "mode": mode,
            "target_level": target_level,
            "teacher_memory_used": bool(style_hint),
            "memory_explanation": list(memory_explanation),
        }

    sim = text_similarity(o, improved)
    floor = float(settings.STUDENT_REWRITE_SIMILARITY_FLOOR)
    if sim < floor:
        msg = f"نسبة التشابه مع أصلك ({sim:.0%}) دون الحد ({floor:.0%})؛ حُفظ نصك دون تعديل."
        return {
            "improved": o,
            "notes": [msg, "هذا لحماية أسلوبك من إعادة كتابة مفرطة."],
            "style_guard_triggered": True,
            "similarity": round(sim, 4),
            "mode": mode,
            "target_level": target_level,
            "teacher_memory_used": bool(style_hint),
            "memory_explanation": list(memory_explanation),
        }

    if truncated:
        notes = (notes or []) + ["مثال مبني على أول أجزاء المسلّم عند كونه طويلاً جداً."]

    out: Dict[str, Any] = {
        "improved": improved.strip(),
        "notes": notes or [f"تطوير إرشادي نحو مستوى {target_level}."],
        "style_guard_triggered": False,
        "similarity": round(sim, 4),
        "mode": mode,
        "target_level": target_level,
        "teacher_memory_used": bool(style_hint),
        "memory_explanation": list(memory_explanation),
    }
    try:
        out["diff_preview"] = build_diff_preview(original_text[:cap], improved)
    except Exception:
        out["diff_preview"] = ""
    return out


def maybe_attach_student_improvement(
    result: Dict[str, Any],
    student_work: str,
    *,
    user_id: Optional[int] = None,
    memory_scope_key: Optional[str] = None,
) -> None:
    """
    After grading: if band is Pass or Merit, suggest a rewrite toward the next level.
    Sets result['student_improvement'] to a dict or None.
    """
    if not settings.STUDENT_REWRITE_ENABLED or not settings.FEATURE_ALLOW_AI_REWRITE:
        result["student_improvement"] = None
        return
    if result.get("error"):
        result["student_improvement"] = None
        return
    band = (result.get("grade_band") or "").strip()
    if band not in ("Pass", "Merit"):
        result["student_improvement"] = None
        return
    try:
        settings.require_openai()
    except ValueError:
        result["student_improvement"] = None
        return

    target = "Merit" if band == "Pass" else "Distinction"
    try:
        data = generate_student_rewrite(
            student_work,
            target,
            user_id=user_id,
            memory_scope_key=memory_scope_key,
            submission_format=str(result.get("submission_format") or "mixed"),
        )
        data["source_grade_band"] = band
        result["student_improvement"] = data
    except Exception as e:
        logger.exception("maybe_attach_student_improvement: %s", e)
        result["student_improvement"] = {
            "improved": (student_work or "")[:12_000],
            "notes": [str(e)],
            "style_guard_triggered": True,
            "mode": "guidance_only",
            "target_level": target,
            "source_grade_band": band,
            "memory_explanation": [],
            "error": str(e),
        }
