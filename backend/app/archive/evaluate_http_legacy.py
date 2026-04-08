# -*- coding: utf-8 -*-
"""
Legacy standalone evaluation HTTP router (was ``app/api/evaluate.py``).

**Not mounted** in ``app.main`` — never was. Use ``/api/v1/assessment/*`` and
EDUVERSE routes instead. Kept for reference / archaeology only.

To revive: mount with ``app.include_router(...)``, add ``Depends(get_current_user)``
and LLM rate limits, and align with current grading stack.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
import logging
import os, json, asyncio, re
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)
router = APIRouter()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

class Submission(BaseModel):
    assignment_text: str
    student_text:    str
    student_id:      Optional[str] = "anonymous"  # temporary until auth is wired
    title:           Optional[str] = "BTEC Submission"

class CriterionResult(BaseModel):
    band:     str
    achieved: bool
    feedback: str


class EvaluationResponse(BaseModel):
    final_grade:    str
    summary:        str
    criteria:       Dict[str, CriterionResult]
    evaluation_id:  str         # always present — ephemeral or DB-persisted
    ephemeral:      bool = True  # true when USE_DB=false

def is_likely_brief(text: str) -> bool:
    return len(re.findall(r'\b(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+\b', text, flags=re.I)) >= 2

def band_from_code(code: str) -> str:
    m = re.search(r'([PMD])\d+', (code or '').upper())
    if not m: return 'PASS'
    return 'PASS' if m.group(1) == 'P' else ('MERIT' if m.group(1) == 'M' else 'DISTINCTION')

def staircase(results: Dict[str, CriterionResult]) -> str:
    codes = list(results.keys())
    get_band = lambda c: results[c].band or band_from_code(c)
    pass_ = [c for c in codes if get_band(c) == 'PASS']
    merit = [c for c in codes if get_band(c) == 'MERIT']
    dist  = [c for c in codes if get_band(c) == 'DISTINCTION']
    allPass  = len(pass_)>0 and all(results[c].achieved for c in pass_)
    allMerit = len(merit)>0 and all(results[c].achieved for c in merit)
    allDist  = len(dist)>0 and all(results[c].achieved for c in dist)
    if len(pass_)>0 and not allPass:
        for c in merit + dist:
            if results[c].achieved:
                results[c].achieved = False
                results[c].feedback += " (تم الحجب لعدم اكتمال معايير Pass)."
        return "REFER (FAIL)"
    if allPass and not allMerit:
        for c in dist:
            if results[c].achieved:
                results[c].achieved = False
                results[c].feedback += " (تم الحجب لعدم اكتمال معايير Merit)."
        return "PASS"
    if allPass and allMerit and not allDist:
        return "MERIT"
    if allPass and allMerit and allDist:
        return "DISTINCTION"
    if len(pass_)==0 and len(codes)>0:
        return "COMPLETED"
    return "UNCLASSIFIED"

def system_prompt() -> str:
    return """
أنت مُدقِّق BTEC صارم.
أخرج بالعربية فقط وبصيغة JSON.
1) استخرج "criteria_in_brief".
2) قيّم فقط هذه الأكواد.
3) لكل معيار:
  - band: (P=PASS, M=MERIT, D=DISTINCTION)
  - achieved: true/false
  - feedback: سبب محدد بالعربية
Structure:
{
  "criteria_in_brief": ["A.P1","A.P2","A.M1","B.P3","B.P4","B.M2","AB.D1"],
  "criteria_results": {
    "CODE": {"band":"PASS|MERIT|DISTINCTION","achieved":bool,"feedback":"..."}
  },
  "general_comment":"..."
}
""".strip()

@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_submission(submission: Submission):
    if not OPENAI_API_KEY:
        raise HTTPException(500, "مفتاح الخادم مفقود")
    if not submission.assignment_text or not submission.student_text:
        raise HTTPException(400, "Both assignment_text and student_text are required.")
    if not is_likely_brief(submission.assignment_text):
        raise HTTPException(400, "الملف المرفوع كـ Brief لا يحتوي معايير كافية.")

    client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    sys = system_prompt()
    user = f"=== ASSIGNMENT BRIEF ===\n{submission.assignment_text[:15000]}\n\n=== STUDENT WORK ===\n{submission.student_text[:25000]}"

    parsed = {}
    for _ in range(3):
        try:
            comp = await client.chat.completions.create(
                model="gpt-4o",
                temperature=0,
                max_tokens=1600,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user},
                ],
            )
            raw = comp.choices[0].message.content or "{}"
            parsed = json.loads(raw.replace("```json","").replace("```","").strip())
            break
        except Exception:
            await asyncio.sleep(0.5)
    if not parsed:
        raise HTTPException(500, "تعذر الحصول على استجابة من النموذج")

    in_brief = [str(x) for x in (parsed.get("criteria_in_brief") or []) if str(x).strip()]
    incoming = parsed.get("criteria_results") or {}

    results: Dict[str, CriterionResult] = {}
    for code, it in incoming.items():
        if in_brief and code not in in_brief:
            continue
        results[code] = CriterionResult(
            band = (it.get("band") or band_from_code(code)).upper(),
            achieved = bool(it.get("achieved", False)),   # بدون اقتباس
            feedback = it.get("feedback") or "—"
        )

    final_grade = staircase(results)
    summary = (parsed.get("general_comment") or "تم التقييم وفق ورقة الواجب فقط دون اشتراط اقتباس.").strip()
    if not re.search(r'[\u0600-\u06FF]', summary):
        summary = "تم التقييم وفق ورقة الواجب فقط."

    # ── Persist via repository (InMemory or Postgres depending on USE_DB) ─────
    evaluation_id = "ephemeral"
    is_ephemeral  = True
    try:
        import sys, os
        _root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        if _root not in sys.path:
            sys.path.insert(0, _root)
        from repository.evaluations import get_evaluation_repo  # type: ignore[import]
        repo = get_evaluation_repo()
        criteria_dict = {
            code: {"band": r.band, "achieved": r.achieved, "feedback": r.feedback}
            for code, r in results.items()
        }
        evaluation_id = repo.create(
            student_id=submission.student_id or "anonymous",
            title=submission.title or "BTEC Submission",
            original_text=submission.student_text[:4000],  # store preview
            status="evaluated",
            criteria=criteria_dict,
            final_grade=final_grade,
            feedback=summary,
        )
        stored = repo.get_by_id(evaluation_id)
        is_ephemeral = bool(stored and stored.get("ephemeral", True))
        logger.info(
            "[Evaluate] Persisted evaluation_id=%s grade=%s ephemeral=%s",
            evaluation_id, final_grade, is_ephemeral,
        )
    except Exception as exc:
        logger.warning("[Evaluate] Repository save skipped: %s", exc)
        evaluation_id = "ephemeral"
        is_ephemeral  = True

    return EvaluationResponse(
        final_grade=final_grade,
        summary=summary,
        criteria=results,
        evaluation_id=evaluation_id,
        ephemeral=is_ephemeral,
    )
