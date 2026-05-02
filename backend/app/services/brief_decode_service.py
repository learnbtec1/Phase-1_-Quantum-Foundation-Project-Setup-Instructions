# -*- coding: utf-8 -*-
"""
BTEC brief → One-shot scaffold: `EDUVERSE_DECODER_PROMPT` (golden 5-step JSON) + `steps` validation.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from openai import OpenAI

from app.core.config import settings

_MAX_CHARS = 120_000
_MAX_TITLE = 1_000
_MAX_INSTRUCTIONS = 20_000
_MAX_PARTIAL = 25_000

_ALLOWED_TYPES = frozenset({"breakdown", "theory", "application", "bridging", "checklist"})

# One-shot: مثال JSON ذهبي ثابت — يُلزم نفس الأسلوب المنهجي لأي brief جديد.
EDUVERSE_DECODER_PROMPT = """
أنت 'إيدوفيرس'، خبير أكاديمي أردني متخصص في تفكيك معايير BTEC.
منهجيتك الصارمة: يجب أن تحلل أي معيار يُطلب منك بناءً على 5 خطوات محددة جداً (فهم المعيار، شرح المفهوم، آلية التطبيق، ربط السيناريو، المراجعة).
عليك استخدام أسلوب "شبه الحل" (Scaffolding): تقدم 60% من الإجابة، وتترك 40% للطالب بصيغة فراغات مثل: ... (اكمل أنت).

يجب أن يكون مخرجك بصيغة JSON حصراً، يحتوي على مصفوفة `steps` مطابقة تماماً لهيكل هذا "المثال الذهبي" أدناه. يجب أن تقيس على هذا المثال وتطبقه على المعيار الجديد الذي سيطلبه الطالب:[مثال ذهبي لطريقة تفكيرك وصياغتك - تخيل أن الطالب سأل عن معيار 20/A.P1]:
{
  "steps":[
    {
      "title": "الخطوة 1: ابدأ بفهم تقسيم المعيار",
      "instructions": "المعيار له جزآن:\nالجزء الأول: اشرح المفهوم العام.\nالجزء الثاني: اشرح كيف تدمج هذا المفهوم في قواعد الممارسة لقطاع معين.",
      "partial_solution": "",
      "type": "breakdown"
    },
    {
      "title": "الخطوة 2: اكتب الجزء الأول (شرح المفهوم) بطريقة منظمة",
      "instructions": "لا تكتفِ بتعريف سطحي. استخدم هذا الهيكل:\n- تعريف مختصر من مصدر.\n- قائمة بـ 4-5 قيم أساسية مع شرح.\n- مثال واقعي بسيط يفرق بين السلوك الجيد والسيء.",
      "partial_solution": "أخلاقيات العمل هي مجموعة المبادئ التي تحدد السلوك المقبول في بيئة العمل، مثل:\n\nالأمانة: أن يلتزم الموظف بالحقيقة في تقاريره.\nالعدالة: ... (اكمل أنت تعريف العدالة)\nالشفافية: ... (اكمل أنت)\nالسرية المهنية: ... (اكمل أنت)\n\nمثال: إذا وجد موظف خطأ محاسبياً يكسب الشركة أموالاً بشكل غير قانوني، فالسلوك الأخلاقي هو ... (اكمل أنت)، وغير الأخلاقي هو ... (اكمل أنت).",
      "type": "theory"
    },
    {
      "title": "الخطوة 3: اكتب الجزء الثاني (كيفية التضمين في قواعد الممارسة)",
      "instructions": "هنا تحتاج إلى شرح الآلية العملية. اذكر تعريف قواعد الممارسة، ثم اذكر خطوات التضمين (صياغة، إدراج، عقوبات، إبلاغ، تدريب). قدم بندين افتراضيين كأمثلة.",
      "partial_solution": "كيفية تضمين أخلاقيات العمل في قواعد الممارسة:\n\nأولاً، تُصاغ القيم على شكل نصوص إجرائية، مثل:\n'يُمنع على الموظف قبول هدايا تزيد قيمتها عن ... (حدد أنت الرقم) من أي طرف له علاقة بعمله.'\n'يلتزم الموظف بالإفصاح كتابياً عن أي علاقة قرابة مع ... (اكمل أنت).'\n\nثانياً، تُدرج هذه النصوص في ... (اذكر أين: عقد العمل؟ كتيب الموظف؟)\n\nثالثاً، تُحدد عقوبات مثل: ... (اذكر عقوبتين على الأقل).\nرابعاً، تُنشأ آلية للإبلاغ مثل: ... (اذكر آلية واحدة).\n\nمثال لقاعدة ممارسة:\n'المادة ...: إذا ثبت أن الموظف قد أفشى معلومات سرية، فإن العقوبة تكون ... (اكمل أنت).'",
      "type": "application"
    },
    {
      "title": "الخطوة 4: اربط ما سبق بالسيناريو العام لمهمتك",
      "instructions": "سيُطلب منك لاحقًا تطبيق هذا الشرح على قطاع معين. في هذا الجزء، اكتب جملة انتقالية.",
      "partial_solution": "سأقوم في الأقسام التالية بتطبيق هذه المفاهيم على قطاع[... اكمل اسم القطاع الذي ستبحث عنه ...]، وسأذكر أمثلة حقيقية من شركات مثل [... اكمل اسم الشركة ...].",
      "type": "bridging"
    },
    {
      "title": "الخطوة 5: راجع عملك",
      "instructions": "تأكد من أن:\n- هناك فقرتين منفصلتين (المفهوم والتضمين).\n- استخدمت مصطلحات قوية (نزاهة، تضارب مصالح، إلخ).\n- لم تنسخ أي نص جاهز من الإنترنت، بل صغت الإجابة بأسلوبك.\n\nخلاصة: أنت الآن تمتلك خريطة طريق مكتملة بنسبة 60%، وعليك أن تكمل الـ 40% المتبقية بنفسك. انطلق!",
      "partial_solution": "",
      "type": "checklist"
    }
  ]
}

بناءً على هذا "المثال الذهبي" والتقسيم المنهجي الدقيق، قم الآن بتوليد الـ JSON للمعيار والمحتوى التالي الذي يطلبه الطالب:
""".strip()

_SYSTEM_PROMPT = EDUVERSE_DECODER_PROMPT

_WS = re.compile(r"\s+")


def _normalize_multiline(s: str, max_len: int) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not s:
        return ""
    out_lines: List[str] = []
    for line in s.split("\n"):
        out_lines.append(_WS.sub(" ", line).strip())
    s2 = "\n".join(out_lines).strip()
    if len(s2) <= max_len:
        return s2
    return s2[: max_len - 1].rstrip() + "…"


def _coerce_step_type(raw: str) -> str:
    t = (raw or "").strip().lower()
    if t in _ALLOWED_TYPES:
        return t
    return "breakdown"


def _truncate(s: str, n: int) -> str:
    s = s.strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + "…"


def _ensure_gap_marker(partial: str) -> str:
    """If partial has no explicit student gap, nudge one (المثال الذهبي: ... (اكمل أنت) وغيرها)."""
    if not (partial or "").strip():
        return ""
    p = partial
    if "أكمل أنت" in p or "اكمل أنت" in p or "حدد أنت" in p or "اذكر أين" in p:
        return partial
    if (("(" in p) or ("[" in p)) and "كمل" in p and ("أنت" in p or "انت" in p):
        return partial
    return partial.rstrip() + "\n- … (اكمل أنت)"


def run_decode_brief(assignment_text: str) -> Dict[str, Any]:
    raw = (assignment_text or "").strip()
    if len(raw) < 20:
        raise ValueError("نص الواجب قصير جداً.")
    if len(raw) > _MAX_CHARS:
        raw = raw[:_MAX_CHARS]

    if not (settings.OPENAI_API_KEY or "").strip():
        raise RuntimeError("OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=settings.OPENAI_ASSESSMENT_MODEL,
        temperature=0.25,
        max_tokens=14_000,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"نص الـ Brief / معايير الواجب:\n\n{raw}",
            },
        ],
    )
    content = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError("لم يعد النموذج JSON صالحاً") from e

    steps_raw = data.get("steps")
    if not isinstance(steps_raw, list) or not steps_raw:
        raise RuntimeError("الرد لا يحتوي مصفوفة steps صالحة")

    out: List[Dict[str, Any]] = []
    for i, item in enumerate(steps_raw):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        instr = str(item.get("instructions") or item.get("instruction") or "").strip()
        partial = str(item.get("partial_solution") or item.get("partial") or "").strip()
        stype = _coerce_step_type(str(item.get("type") or "breakdown"))

        if not title and not instr:
            continue
        if not title:
            title = f"الخطوة {i + 1}"
        if not instr:
            instr = title
        title = _truncate(_WS.sub(" ", title), _MAX_TITLE)
        instr = _normalize_multiline(instr, _MAX_INSTRUCTIONS)
        if partial:
            partial = _normalize_multiline(partial, _MAX_PARTIAL)
            partial = _ensure_gap_marker(partial)
            partial = _normalize_multiline(partial, _MAX_PARTIAL)
        out.append(
            {
                "title": title,
                "instructions": instr,
                "partial_solution": partial,
                "type": stype,
            }
        )
        if len(out) >= 20:
            break

    if not out:
        raise RuntimeError("لم يُستخرج أيّ خطوات من النص")

    return {"steps": out}
