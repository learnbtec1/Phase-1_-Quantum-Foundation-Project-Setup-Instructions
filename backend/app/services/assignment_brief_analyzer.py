# -*- coding: utf-8 -*-
"""Gemini: extract P/M/D ladder (simple Arabic) from a BTEC assignment brief PDF (text path)."""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, MutableMapping

from app.core.config import settings
from app.core.prompts import EDUVERSE_MENTOR_PERSONA
from app.services.submission_merge import MAX_BYTES_PER_FILE, extract_text_from_bytes

_MAX_EXTRACTED_CHARS = 100_000
_MIN_EXTRACTED_CHARS = 40

# Task-specific: JSON ladder from PDF text (Gemini), prefixed with global mentor persona.
_LADDER_CORE = """
(مهمة — محلل موجز PDF): حلل نص **موجز الواجب / معايير التقييم** المستخرج أدناه.
استخرج فقط **ما يلزم** لفهم تدرّج Pass / Merit / Distinction: ركّز على **الأفعال الأمرية (Command Verbs)** ووصف الـ P / M / D عند وضوحه في النص.
لغة الاستجابة: **عربية مبسّطة** للطالب في الأردن (شرح "ماذا تفعل" — بدون تقديم حل واجب جاهز ولا اقتباس طويل من النص).

**أجب بـ JSON فقط** (بدون Markdown) بالشكل الحرفي:
{"pass": ["…"], "merit": ["…"], "distinction": ["…"]}
كل مفتاح مصفوفة **من 2 إلى 5 جمل** قصيرات. إن غاب تقسيم صريح في الملف، اشتق من طبيعة BTEC (وصف/شرح/تحليل-تقييم) مع الإبقاء قريباً من الملف.
""".strip()

_LADDER_SYSTEM = f"{EDUVERSE_MENTOR_PERSONA}\n\n{_LADDER_CORE}"


def _as_str_list(x: Any) -> List[str]:
    if not isinstance(x, list):
        return []
    out: List[str] = []
    for it in x:
        if isinstance(it, str) and (s := it.strip()):
            if len(s) > 1_200:
                s = s[:1_200].rstrip() + "…"
            out.append(s)
    return out


def _coerce_ladder(d: MutableMapping[str, Any]) -> Dict[str, List[str]]:
    p = d.get("pass", d.get("Pass"))
    m = d.get("merit", d.get("Merit"))
    dist = d.get("distinction", d.get("Distinction"))
    out = {
        "pass": _as_str_list(p),
        "merit": _as_str_list(m),
        "distinction": _as_str_list(dist),
    }
    for k, v in out.items():
        if not v:
            raise ValueError(
                f"نموذج الاستخراج: المفتاح '{k}' يجب أن يحتوي جملة واحدة على الأقل."
            )
    return out


def _strip_code_fence(s: str) -> str:
    t = (s or "").strip()
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", t, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return t


def run_analyze_assignment_brief(pdf_name: str, data: bytes) -> Dict[str, List[str]]:
    if len(data) > MAX_BYTES_PER_FILE:
        raise ValueError("الملف أكبر من الحد المسموح.")
    n = (pdf_name or "brief.pdf").strip().lower()
    if not n.endswith(".pdf"):
        raise ValueError("يُقبل ملف PDF فقط (موجز الواجب).")

    if not (settings.GOOGLE_API_KEY or "").strip():
        raise RuntimeError("GOOGLE_API_KEY is not configured (Gemini).")

    import google.generativeai as genai
    from google.generativeai import types as genai_types

    raw_text = (extract_text_from_bytes(pdf_name, data) or "").strip()
    if len(raw_text) < _MIN_EXTRACTED_CHARS:
        raise ValueError(
            "لم يُستخرج نص كافٍ من الـ PDF (قد يكون ممسوحاً ضوئياً). جرّب ملفاً نصيّاً."
        )
    if len(raw_text) > _MAX_EXTRACTED_CHARS:
        raw_text = raw_text[:_MAX_EXTRACTED_CHARS]

    genai.configure(api_key=settings.GOOGLE_API_KEY.strip())
    model_id = (settings.GEMINI_ASSIGNMENT_BRIEF_MODEL or "gemini-2.0-flash").strip()
    model = genai.GenerativeModel(model_id)

    gen_cfg = genai_types.GenerationConfig(
        temperature=0.2,
        response_mime_type="application/json",
    )
    try:
        resp = model.generate_content(
            [f"{_LADDER_SYSTEM}\n\n--- بداية النص المستخرج ---\n{raw_text}\n--- نهاية النص ---"],
            generation_config=gen_cfg,
        )
    except Exception as e:
        raise RuntimeError(f"فشل اتصال Gemini: {e!s}") from e

    text = _strip_code_fence(str(resp.text) if resp.text else "")
    if not text:
        raise RuntimeError("استجابة Gemini فارغة.")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError("لم تُرجع النموذج JSON صالحاً.") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("تنسيق JSON غير صالح.")
    return _coerce_ladder(parsed)
