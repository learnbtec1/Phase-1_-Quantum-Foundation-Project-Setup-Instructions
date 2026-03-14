# -*- coding: utf-8 -*-
"""
Conversational Reasoning Agent v1.0
-------------------------------------
يستقبل اعتراضات الطالب على التقييم ويُعيد الفحص بذكاء.

مثال:
  الطالب:  "أنا كتبت عن التسويق في الشريحة 4 والصفحة الثانية من الملف DOCX"
  الوكيل:  يحدّد موقع المقطع → يُعيد تقييم المعيار بالتركيز عليه
           → يرد: "وجدتُ المقطع — تحديث الحكم إلى محقق ✓"

يحتفظ بـ _appeal_store (في الذاكرة) ليربط job_id بنتائج التقييم
الكاملة، بما يكفي لإعادة تقييم معيار واحد بدون إعادة الرفع.
"""
from __future__ import annotations

import re
import json
import asyncio
import logging
from typing import Dict, Any, Optional, List

from app.services.forensic_engine import (
    evaluate_one,
    MODEL,
)

logger = logging.getLogger("nexus.appeal")

# ─── In-memory job store ──────────────────────────────────────────────────────
# Maps job_id → { assignment_text, student_text, adv_constraints, criteria_results }
# In production: replace with Redis (TTL = 24 h) or a lightweight DB.
_appeal_store: Dict[str, Dict[str, Any]] = {}
_MAX_STORE = 300  # LRU-lite: evict oldest when full


def store_for_appeal(
    job_id:           str,
    assignment_text:  str,
    student_text:     str,
    criteria_results: Dict[str, Dict],
    adv_constraints:  Dict,
    descriptions:     Dict[str, str],
) -> None:
    """Register a completed grading job so it can receive student appeals."""
    if len(_appeal_store) >= _MAX_STORE:
        oldest = next(iter(_appeal_store))
        del _appeal_store[oldest]
    _appeal_store[job_id] = {
        "assignment_text":  assignment_text,
        "student_text":     student_text,
        "criteria_results": criteria_results,
        "adv_constraints":  adv_constraints,
        "descriptions":     descriptions,
    }


def get_stored_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve a stored job. Returns None if expired/not found."""
    return _appeal_store.get(job_id)


# ─── Page / section hint extraction ─────────────────────────────────────────

_PAGE_PATTERNS = [
    r'(?:صفحة|page|p\.?)\s*(\d+)',
    r'(?:شريحة|slide)\s*(\d+)',
    r'(?:جزء|section|part)\s+(\w+)',
    r'(?:الفقرة|paragraph)\s+(\w+)',
    r'FILE START:\s*([^\-\n]+)',   # our own file-boundary markers
]


def _extract_location_hint(message: str) -> Optional[str]:
    """Try to extract a page/slide/section reference from the student message."""
    for pattern in _PAGE_PATTERNS:
        m = re.search(pattern, message, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _locate_section(student_text: str, hint: str, window: int = 2500) -> str:
    """
    Find a text window around the student's referenced location.
    Our PPTX parser injects '--- [Slide N] ---' markers.
    Our multi-file handler injects '--- FILE START: name ---' markers.
    Falls back to the middle section if nothing matches.
    """
    search_patterns = [
        rf'\[Slide\s*{re.escape(hint)}\]',
        rf'---\s*\[Slide\s*{re.escape(hint)}\]',
        rf'page\s*{re.escape(hint)}',
        rf'FILE START[^-]*{re.escape(hint)}',
    ]
    for pat in search_patterns:
        m = re.search(pat, student_text, re.IGNORECASE)
        if m:
            start = max(0, m.start() - 150)
            end   = min(len(student_text), m.end() + window)
            return student_text[start:end]

    # No marker found — return a generous chunk around the midpoint
    mid = len(student_text) // 2
    return student_text[max(0, mid - window // 2): mid + window // 2]


# ─── Appeal processing ───────────────────────────────────────────────────────

async def process_appeal(
    job_id:          str,
    student_message: str,
    criterion_code:  str,
) -> Dict[str, Any]:
    """
    Process a student's appeal for one criterion in a completed grading job.

    Steps:
      1. Load the original job from store
      2. Extract page/section reference from student message
      3. Locate the relevant text window
      4. Re-run evaluate_one with the student's pointer as additional context
      5. Compare verdicts and build a natural Arabic response

    Returns a structured dict with updated verdict + agent_message.
    """
    stored = get_stored_job(job_id)
    if not stored:
        return {
            "error": "job_not_found",
            "message": f"لم يتم العثور على نتائج الجلسة '{job_id}'. "
                       "قد تكون انتهت صلاحيتها — يرجى إعادة التقييم.",
        }

    original_results = stored["criteria_results"]
    assignment_text  = stored["assignment_text"]
    student_text     = stored["student_text"]
    adv_constraints  = stored["adv_constraints"]
    descriptions     = stored["descriptions"]

    criterion_upper = criterion_code.upper().strip()
    if criterion_upper not in original_results:
        return {
            "error": "criterion_not_found",
            "message": f"المعيار '{criterion_code}' غير موجود في نتائج هذه الجلسة.",
        }

    original = original_results[criterion_upper]
    original_achieved  = original.get("achieved", False)
    original_reasoning = original.get("reasoning", "")
    criterion_desc     = descriptions.get(criterion_upper, f"معيار {criterion_upper}")

    # ── Locate the referenced content ────────────────────────────────────────
    hint = _extract_location_hint(student_message)
    if hint:
        focused_section = _locate_section(student_text, hint)
        location_note   = f"الصفحة/الجزء المشار إليه: {hint}"
    else:
        focused_section = student_text
        location_note   = "لم يُحدَّد موقع مُعيَّن — مراجعة النص كاملاً"

    # ── Build appeal-augmented description ───────────────────────────────────
    appeal_context = (
        f"\n\n━━━━━━━━━━━━━━━━━━━━\n"
        f"📣 [اعتراض الطالب]: {student_message}\n"
        f"📍 {location_note}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"التقييم الأولي: {'محقق ✓' if original_achieved else 'غير محقق ✗'}\n"
        f"سبب التقييم الأولي (مقتطف): {original_reasoning[:400]}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"⚠️ الطالب يطعن في الحكم ويُشير إلى محتوى محدد.\n"
        f"اقرأ المقطع المُحدَّد أدناه **بعناية فائقة** ثم أعد الحكم بموضوعية تامة.\n"
    )

    enriched_desc = criterion_desc + appeal_context

    # If a location was found, put that section first to ensure LLM reads it
    if hint and focused_section != student_text:
        appeal_student_text = (
            f"[⚠️ المقطع المُشار إليه بواسطة الطالب — اقرأه أولاً]:\n"
            f"{focused_section}\n\n"
            f"[النص الكامل للمرجع]:\n{student_text}"
        )
    else:
        appeal_student_text = student_text

    # ── Re-evaluate ───────────────────────────────────────────────────────────
    try:
        _, updated = await evaluate_one(
            criterion_upper,
            enriched_desc,
            assignment_text,
            appeal_student_text,
            adv_constraints,
        )
    except Exception as e:
        logger.error("[Appeal] evaluate_one failed for %s: %s", criterion_upper, e)
        return {
            "error":   "evaluation_failed",
            "message": f"فشل التقييم التقني: {e}",
        }

    new_achieved   = updated.get("achieved", False)
    verdict_changed = (new_achieved != original_achieved)

    # Update the in-memory store so further appeals reflect the latest verdict
    _appeal_store[job_id]["criteria_results"][criterion_upper] = updated

    return {
        "criterion_code":   criterion_upper,
        "appeal_processed": True,
        "hint_detected":    hint,
        "verdict_changed":  verdict_changed,
        "original_verdict": "Achieved" if original_achieved else "Not Achieved",
        "new_verdict":      "Achieved" if new_achieved      else "Not Achieved",
        "updated_result":   updated,
        "agent_message":    _compose_response(
            student_message, verdict_changed,
            original_achieved, new_achieved,
            updated.get("reasoning", ""),
            criterion_upper,
        ),
    }


def _compose_response(
    student_message: str,
    verdict_changed: bool,
    was_achieved:    bool,
    now_achieved:    bool,
    new_reasoning:   str,
    code:            str,
) -> str:
    """Compose a natural, personalised Arabic response to the student's appeal."""
    reasoning_snippet = new_reasoning[:350].rstrip()

    if verdict_changed and now_achieved:
        return (
            f"بعد مراجعة اعتراضك وإعادة فحص المقطع الذي أشرتَ إليه، "
            f"تبيّن أن إجابتك تُحقق المعيار {code} فعلاً. "
            f"تم تحديث الحكم إلى **محقق ✓**.\n\n"
            f"التفصيل: {reasoning_snippet}"
        )

    if verdict_changed and not now_achieved:
        return (
            f"راجعتُ اعتراضك بعناية للمعيار {code}، "
            f"وأعدتُ التقييم مع التركيز على المقطع المشار إليه. "
            f"للأسف، التقييم المُحدَّث يؤكد أن المعيار لا يزال **غير محقق ✗**.\n\n"
            f"السبب: {reasoning_snippet}"
        )

    verdict_ar = "محقق ✓" if now_achieved else "غير محقق ✗"
    return (
        f"فحصتُ بعناية المقطع الذي أشرتَ إليه في اعتراضك على المعيار {code}. "
        f"الحكم يبقى '{verdict_ar}' بعد المراجعة المستقلة.\n\n"
        f"السبب: {reasoning_snippet}"
    )
