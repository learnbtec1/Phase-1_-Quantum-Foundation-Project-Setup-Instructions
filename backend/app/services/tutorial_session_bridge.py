# -*- coding: utf-8 -*-
"""
Bridge tutorial DB state + mini-check evaluation into tutor system prompt and reply metadata.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, Optional, Tuple

from app.services import tutorial_progress_store as tps
from app.services.mini_check_evaluator import evaluate_mini_check

logger = logging.getLogger(__name__)


def criterion_to_pedagogical_stage(criterion_id: str) -> str:
    m = re.search(r"\.([PMD])\d+", criterion_id or "", re.I)
    if not m:
        return "pass"
    b = m.group(1).upper()
    if b == "M":
        return "merit"
    if b == "D":
        return "distinction"
    return "pass"


def _last_question_snippet(dialogue: str) -> str:
    d = (dialogue or "").strip()
    if not d:
        return ""
    parts = re.split(r"([؟?])", d)
    # rejoin pairs sentence + delimiter
    buf = []
    for i in range(0, len(parts) - 1, 2):
        seg = (parts[i] + (parts[i + 1] if i + 1 < len(parts) else "")).strip()
        if "?" in seg or "؟" in seg:
            buf.append(seg)
    return (buf[-1] if buf else d)[-500:]


async def apply_tutorial_turn(
    *,
    context: dict,
    user_message: str,
    user_uuid: Optional[uuid.UUID],
    combined_rag: str,
    rag_grounded: bool,
) -> Tuple[str, Dict[str, Any]]:
    """
    Returns (markdown to append to system prompt, partial _reply_meta).
    """
    meta: Dict[str, Any] = {}
    appendix = ""

    if not tps.tutorial_persistence_enabled() or not user_uuid or not rag_grounded:
        return appendix, meta

    unit = tps.extract_unit_id_from_text(user_message)
    if not unit and isinstance(context.get("btec_context"), dict):
        u = context["btec_context"].get("unit_id") or context["btec_context"].get("unitId")
        if u is not None:
            unit = str(u).strip().lower().replace("unit", "").strip() or str(u).strip()
            m = re.search(r"(\d{1,3})", unit)
            unit = m.group(1) if m else None

    if not unit:
        return appendix, meta

    row = tps.get_or_create_tutorial_row(user_uuid, unit, combined_rag)
    if row is None:
        return appendix, meta

    codes = tps.extract_criterion_codes_ordered(combined_rag)
    crit = str(row.current_criterion or "A.P1")
    meta["tutorial_unit_id"] = str(unit)
    meta["pedagogical_stage"] = criterion_to_pedagogical_stage(crit)

    stu = (user_message or "").strip()
    stu_clean = stu
    if "[SYSTEM_EVENT:" in stu:
        return appendix, meta

    if bool(getattr(row, "expects_mini_answer", False)) and len(stu_clean) >= 8:
        qref = (getattr(row, "last_mini_check_question", None) or "")[:1500]
        ref = f"{combined_rag}\n\n(last mini-check: {qref})"[:12000]
        attempts = int(getattr(row, "last_mini_check_attempts", 0) or 0)
        try:
            ev = await evaluate_mini_check(
                stu_clean,
                crit,
                ref,
                previous_attempts=attempts,
            )
        except Exception as ex:
            logger.warning("[tutorial_session_bridge] evaluate_mini_check: %s", ex)
            ev = {
                "passed": False,
                "feedback": "تعذر إكمال التقييم؛ أعد صياغة إجابتك باختصار.",
                "confidence": 0.0,
                "next_hint": "",
            }

        appendix += (
            "\n\n## نتيجة فحص مصغّر (من النظام — داخلي)\n"
            f"- المعيار الحالي: **{crit}**\n"
            f"- اجتياز الفحص: **{'نعم' if ev.get('passed') else 'لا'}** "
            f"(ثقة تقريبية: {float(ev.get('confidence') or 0):.2f})\n"
            f"- ملاحظات للطالب: {ev.get('feedback') or '—'}\n"
        )
        if not ev.get("passed") and ev.get("next_hint"):
            appendix += f"- تلميح إضافي: {ev['next_hint']}\n"
        appendix += (
            "إن كان الاجتياز **نعم**: شجّع الطالب بجملة قصيرة، ثم انتقل لمستوى أعلى (Merit/Distinction) "
            "أو للمعيار التالي في نفس الوحدة دون إعطاء حل جاهز.\n"
            "إن كان **لا**: ابقَ على مستوى Pass، قدّم تلميحاً قصيراً واسأل فحصاً مصغّراً أبسط.\n"
        )

        if ev.get("passed"):
            completed = list(getattr(row, "completed_criteria", None) or [])
            if crit not in completed:
                completed.append(crit)
            nxt = tps.next_criterion_after(crit, codes, completed)
            new_crit = nxt or crit
            tps.update_tutorial_row(
                user_uuid,
                unit,
                current_criterion=new_crit,
                completed_criteria=completed,
                last_mini_check_attempts=0,
                expects_mini_answer=False,
                last_mini_check_question=None,
            )
            meta["pedagogical_stage"] = criterion_to_pedagogical_stage(new_crit)
            row2 = tps.get_tutorial_row(user_uuid, unit)
            if row2 is not None:
                context["tutorial_progress_snapshot"] = tps.row_to_dict(row2)
        else:
            tps.update_tutorial_row(
                user_uuid,
                unit,
                last_mini_check_attempts=attempts + 1,
            )
            meta["pedagogical_stage"] = "mini_check"
            row2 = tps.get_tutorial_row(user_uuid, unit)
            if row2 is not None:
                context["tutorial_progress_snapshot"] = tps.row_to_dict(row2)
    else:
        appendix += (
            f"\n\n## تقدّم تعليمي محفوظ (وحدة {unit})\n"
            f"- المعيار الحالي: **{crit}**\n"
            f"- مكتمل سابقاً: {list(getattr(row, 'completed_criteria', None) or [])}\n"
            "اتبع محرك السقالات؛ أنهِ بفحص مصغّر واحد عندما يكون ذلك مناسباً.\n"
        )

    if "tutorial_progress_snapshot" not in context:
        context["tutorial_progress_snapshot"] = tps.row_to_dict(row)
    return appendix, meta


def mark_expects_mini_after_assistant_reply(
    user_uuid: Optional[uuid.UUID],
    unit_id: Optional[str],
    assistant_dialogue: str,
) -> None:
    if not tps.tutorial_persistence_enabled() or not user_uuid or not (unit_id or "").strip():
        return
    uid = str(unit_id).strip()[:64]
    d = (assistant_dialogue or "").strip()
    try:
        if "?" in d or "؟" in d:
            q = _last_question_snippet(d)
            tps.set_expects_mini_answer(user_uuid, uid, q)
        else:
            tps.clear_expects_mini_answer(user_uuid, uid)
    except Exception as ex:
        logger.warning("[tutorial_session_bridge] mark_expects_mini: %s", ex)
