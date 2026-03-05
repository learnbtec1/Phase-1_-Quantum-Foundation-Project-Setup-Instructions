from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
import os, json, asyncio, re
from openai import AsyncOpenAI

router = APIRouter()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise HTTPException(500, "OpenAI API key is missing. Please set the OPENAI_API_KEY environment variable.")

class Submission(BaseModel):
    assignment_text: str
    student_text: str

class CriterionResult(BaseModel):
    band: str
    achieved: bool
    feedback: str

class EvaluationResponse(BaseModel):
    final_grade: str
    summary: str
    criteria: Dict[str, CriterionResult]

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

    return EvaluationResponse(final_grade=final_grade, summary=summary, criteria=results)