# -*- coding: utf-8 -*-
"""
Internal Verifier Agent — Self-Correction Loop v1.0
----------------------------------------------------
يراجع كل تقييم أولي ويكشف التعارض أو الهلوسة (Hallucination).
إذا كانت درجة الهلوسة ≥ 0.5، يُعيد تشغيل evaluate_one بتوجيهات تعديلية.
الحد الأقصى: إعادة واحدة فقط للتحكم في التكلفة.
"""
from __future__ import annotations

import re
import json
import asyncio
import logging
from typing import Dict, Any, Tuple

from app.services.forensic_engine import (
    evaluate_one,
    MODEL,
    anthropic_client,
    openai_client,
    REQUEST_TIMEOUT,
    semaphore,
    GRADER_DELAY_SEC,
)

logger = logging.getLogger("nexus.verifier")

# Hallucination threshold: re-evaluate if score >= this
HALLUCINATION_THRESHOLD = 0.50
# Max tokens for verifier (smaller — it's a binary check, not a full evaluation)
VERIFIER_MAX_TOKENS = 900


async def _build_verification_report(
    code: str,
    criterion_desc: str,
    student_text: str,
    primary_result: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Ask the AI to act as Internal Verifier:
    detect hallucination or logical contradictions in the primary assessment.
    """
    achieved   = primary_result.get("achieved", False)
    reasoning  = primary_result.get("reasoning", "")
    evidence_list = primary_result.get("evidence", [])

    evidence_str = "\n".join(
        f'  [{i+1}] "{ev.get("quote","")}" (ثقة: {ev.get("confidence",0)}%)'
        for i, ev in enumerate(evidence_list)
    ) if evidence_list else "  لا توجد اقتباسات مُستخرجة."

    verdict_ar = "محقق ✓" if achieved else "غير محقق ✗"

    prompt = f"""أنت ناقد داخلي (Internal Verifier) لنظام تقييم أكاديمي. مهمتك الوحيدة: اكتشاف التعارض أو الهلوسة في تقييم سابق.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
المعيار: {code}
الوصف: {criterion_desc}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## التقييم الأولي الذي تراجعه:

الحكم:     {verdict_ar}
التبرير:   {reasoning}
الاقتباسات:
{evidence_str}

## مقطع من نص الطالب للتحقق (لا تكمل — ابحث فقط):
{student_text[:7000]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## مهمتك — ثلاث نقاط فقط:
1. **تحقق من الاقتباسات**: هل كل اقتباس موجود نصياً في مقطع الطالب أعلاه؟
2. **تحقق من الاتساق**: هل الحكم (محقق/غير محقق) يتوافق منطقياً مع التبرير؟
3. **اكتشف التعارضات**: هل يُثبت التبرير العكس من الحكم؟ هل توجد ادعاءات غير مدعومة؟

أعد JSON فقط — بلا نص خارجه:
{{
  "hallucination_detected": true أو false,
  "hallucination_score": رقم 0.0–1.0,
  "issues": ["وصف موجز للمشكلة إن وجدت"],
  "corrective_guidance": "توجيه محدد للتقييم المُصحَّح، أو 'التقييم سليم'",
  "verdict_consistent": true أو false
}}"""

    active_client = anthropic_client or openai_client
    if not active_client:
        return {
            "hallucination_detected": False,
            "hallucination_score": 0.0,
            "issues": [],
            "corrective_guidance": "التحقق غير متاح — مفتاح API مفقود",
            "verdict_consistent": True,
        }

    async with semaphore:
        if GRADER_DELAY_SEC > 0:
            await asyncio.sleep(GRADER_DELAY_SEC * 0.4)  # shorter delay for verifier

        loop = asyncio.get_event_loop()
        try:
            if MODEL.startswith("claude-"):
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: active_client.messages.create(
                            model=MODEL,
                            max_tokens=VERIFIER_MAX_TOKENS,
                            messages=[{"role": "user", "content": prompt}],
                        ),
                    ),
                    timeout=REQUEST_TIMEOUT,
                )
                raw = (response.content[0].text or "").strip()
            else:
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: active_client.chat.completions.create(
                            model=MODEL,
                            max_tokens=VERIFIER_MAX_TOKENS,
                            messages=[{"role": "user", "content": prompt}],
                            response_format={"type": "json_object"},
                        ),
                    ),
                    timeout=REQUEST_TIMEOUT,
                )
                raw = (response.choices[0].message.content or "").strip()

            m = re.search(r'\{[\s\S]*\}', raw)
            if m:
                return json.loads(m.group())

        except Exception as e:
            logger.warning(f"[Verifier] Prompt failed for {code}: {e}")

    return {
        "hallucination_detected": False,
        "hallucination_score": 0.0,
        "issues": [],
        "corrective_guidance": "فشل التحقق التقني — يُحتفظ بالتقييم الأولي",
        "verdict_consistent": True,
    }


async def verify_and_correct(
    code: str,
    desc: str,
    assignment_text: str,
    student_text: str,
    adv_constraints: Dict,
    primary_result: Dict[str, Any],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Run the Internal Verifier on a primary criterion result.

    Returns:
        (final_result, verification_report)
        - final_result  : corrected if hallucination found, otherwise original
        - verification_report : full report from the verifier (for audit trail)
    """
    verification_report = await _build_verification_report(
        code, desc, student_text, primary_result
    )

    hallucination_score   = verification_report.get("hallucination_score", 0.0)
    verdict_consistent    = verification_report.get("verdict_consistent", True)
    needs_correction      = (hallucination_score >= HALLUCINATION_THRESHOLD or not verdict_consistent)

    if needs_correction:
        logger.info(
            "[Verifier] %s: hallucination=%.2f consistent=%s — re-evaluating",
            code, hallucination_score, verdict_consistent,
        )
        issues   = verification_report.get("issues", [])
        guidance = verification_report.get("corrective_guidance", "")

        # Inject corrective notes into the description so evaluate_one uses them
        patched_desc = (
            f"{desc}\n\n"
            f"⚠️ [ملاحظة الناقد الداخلي — للتقييم المُصحَّح]: {guidance}\n"
            f"مشاكل في التقييم السابق: {'; '.join(issues)}\n"
            f"يرجى تجنب هذه الأخطاء تماماً في تقييمك الجديد."
        )

        _, corrected = await evaluate_one(
            code, patched_desc, assignment_text, student_text, adv_constraints
        )
        corrected["_verified"]            = True
        corrected["_correction_applied"]  = True
        corrected["_verifier_score"]      = hallucination_score
        corrected["_verifier_issues"]     = issues
        return corrected, verification_report

    # No correction needed — stamp and pass through
    primary_result["_verified"]           = True
    primary_result["_correction_applied"] = False
    primary_result["_verifier_score"]     = hallucination_score
    return primary_result, verification_report


async def run_bulk_verification(
    codes: list[str],
    descriptions: Dict[str, str],
    assignment_text: str,
    student_text: str,
    adv_constraints: Dict,
    primary_results: Dict[str, Dict],
) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """
    Run verify_and_correct on all criteria concurrently.

    Returns:
        (corrected_results, verification_reports)
    """
    tasks = [
        verify_and_correct(
            code,
            descriptions.get(code, f"معيار {code}"),
            assignment_text,
            student_text,
            adv_constraints,
            dict(primary_results.get(code, {})),  # copy to avoid mutation
        )
        for code in codes
    ]

    pairs = await asyncio.gather(*tasks, return_exceptions=True)

    corrected_results: Dict[str, Dict]     = {}
    verification_reports: Dict[str, Dict]  = {}

    for code, pair in zip(codes, pairs):
        if isinstance(pair, Exception):
            logger.error("[Verifier] Exception for %s: %s", code, pair)
            corrected_results[code]    = primary_results.get(code, {})
            verification_reports[code] = {"error": str(pair)}
        else:
            result, report             = pair
            corrected_results[code]    = result
            verification_reports[code] = report

    return corrected_results, verification_reports
