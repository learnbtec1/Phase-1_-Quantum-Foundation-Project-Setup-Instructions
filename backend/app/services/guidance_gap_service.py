# -*- coding: utf-8 -*-
"""
Guidance ↔ assessment bridge: gap analysis + improvement *direction* only.
Non-destructive: does not modify grading. Does not output copy-paste model answers.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

from openai import OpenAI

from app.core.config import settings

_MAX_SUBMISSION = 80_000
_MAX_FIELD_CHARS = 700
_MAX_WORDS_PER_FIELD = 80
_LLM_BUDGET_WORDS = 120  # total for strengths + gaps + improvement per criterion
_VERY_SHORT_WORDS = 40
_WEAK_CONFIDENCE = 0.45


def _word_count(s: str) -> int:
    return len((s or "").split())


def _clip_field(s: str) -> str:
    t = (s or "").strip()
    t = t.replace("\n\n", "\n")
    w = t.split()
    if len(w) > _MAX_WORDS_PER_FIELD:
        t = " ".join(w[:_MAX_WORDS_PER_FIELD]) + "…"
    if len(t) > _MAX_FIELD_CHARS:
        return t[: _MAX_FIELD_CHARS - 1] + "…"
    return t


def _norm_coverage(v: str) -> str:
    t = (v or "").strip().lower()
    if t in ("complete", "partial", "missing"):
        return t
    if t in ("none", "incomplete", "absent"):
        return "missing"
    return "partial"


def _level_from_code(code: str) -> str:
    ch = (code or "P1").strip().upper()[:1]
    return {"P": "pass", "M": "merit", "D": "distinction"}.get(ch, "pass")


def _safe_improvement(text: str, submission: str) -> str:
    t = (text or "").strip()
    sub = (submission or "").strip()
    if _word_count(t) > 180:
        t = " ".join(t.split()[:_MAX_WORDS_PER_FIELD]) + "…"
    if sub and len(t) > 150 and t[: min(100, len(t))] in sub:
        return (
            "خطّط خطوة بخطوة: ما الفكرة، ما الربط بالواجب، ما الدليل التالي؟ "
            "تجنّب تكرار نصك كاملاً دون تطوير."
        )
    return _clip_field(t)


def _row_too_short(code: str) -> Dict[str, str]:
    return {
        "criterion": code,
        "coverage": "missing",
        "strengths": _clip_field("نص الاستجابة قصير جداً ليُظهر أدلّة واضحة على المعيار."),
        "gaps": _clip_field("يُلزم مزيد من التفصيل: صِل الفكرة بالسيناريو ووضح الاستدلال."),
        "improvement_direction": _clip_field(
            "أولاً: أطِل بما يكفي. ثانياً: لكل فقرة تسأل: كيف يرتبط هذا السطر بمتطلب " + code + "؟"
        ),
    }


def _row_weak_achieved(code: str) -> Dict[str, str]:
    return {
        "criterion": code,
        "coverage": "partial",
        "strengths": _clip_field("يبدو بلوغ حد عادل، لكن اليقين/الدليل ما يزال هشّاً (ثقة منخفضة)."),
        "gaps": _clip_field("أضف اقتباسات أو صِل الاستنتاج مباشرة بعناصر السيناريو دون تردّد."),
        "improvement_direction": _clip_field(
            "أنشئ تخطيطاً: ما الدليل التالي؟ أين الربط الصريح؟ ما الادّعاء غير المبرر بعد؟"
        ),
    }


def _row_fallback(
    code: str,
    *,
    achieved: bool,
) -> Dict[str, str]:
    if achieved:
        return {
            "criterion": code,
            "coverage": "partial",
            "strengths": _clip_field("ثمة تقدّم باتجاه المطلوب؛ راجع الربط مع السيناريو في التوجيه."),
            "gaps": _clip_field("قد يُوضّح التبرير ويُعزّز الدليل دون الاكتفاء بعبارات مطلقة."),
            "improvement_direction": _clip_field(
                "ركّز على: (1) ماذا يريد المعيار (2) أين يرتبط بالواجب (3) ماذا تضيف تالياً؟"
            ),
        }
    return {
        "criterion": code,
        "coverage": "partial",
        "strengths": _clip_field("محدود ما يدعم الاستيفاء بثقة لحدّه الآن."),
        "gaps": _clip_field("أضف استدلالاً يرتبط بمتطلبات " + code + " وليس وصفاً عاماً."),
        "improvement_direction": _clip_field(
            "ابدأ بمخطط قصير، ثم املأه بدليل من نصك أو مبرّر واضح لكل بند."
        ),
    }


def _parse_criteria_list(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        return []
    out: List[Dict[str, Any]] = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        code = str(c.get("criterion") or c.get("code") or "P1").strip() or "P1"
        level = (c.get("level") or "").strip().lower()
        if level not in ("pass", "merit", "distinction"):
            level = _level_from_code(code)
        g = c.get("guidance")
        g = g if isinstance(g, dict) else {}
        out.append(
            {
                "criterion": code[:64],
                "level": level,
                "achieved": bool(c.get("achieved")),
                "confidence": c.get("confidence"),
                "guidance": {
                    "what": (g.get("what") or "")[:4_000],
                    "how": (g.get("how") or "")[:4_000],
                    "link_to_scenario": (g.get("link_to_scenario") or g.get("linkToScenario") or "")[:4_000],
                },
            }
        )
    return out


def _confidence_float(v: Any) -> float:
    if v is None:
        return 0.55
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.55


def run_guidance_gap_analysis(body: Dict[str, Any]) -> Dict[str, Any]:
    submission = (body.get("submission") or "")[:_MAX_SUBMISSION].strip()
    packed = _parse_criteria_list(body.get("criteria"))
    if not packed:
        return {"criterion_analysis": []}

    sub_wc = _word_count(submission)
    very_short = sub_wc < _VERY_SHORT_WORDS

    if very_short:
        return {"criterion_analysis": [_row_too_short(p["criterion"]) for p in packed]}

    if not (settings.OPENAI_API_KEY or "").strip():
        return {
            "criterion_analysis": [
                _row_fallback(p["criterion"], achieved=p["achieved"]) for p in packed
            ]
        }

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    system = (
        "You are a fair BTEC-style teacher. Explain gaps and how to *think* next — never a full model answer, "
        "never a rewrite of the student's text. No fabricated quotes. "
        f"For each criterion, strengths+gaps+improvement_direction together should stay under ~{_LLM_BUDGET_WORDS} words. "
        "Output one JSON object only, no markdown."
    )
    payload = {
        "student_submission": submission,
        "criteria": packed,
    }
    user = (
        "Return exactly this JSON shape:\n"
        '{"criterion_analysis":[{"criterion":"P1","coverage":"complete|partial|missing",'
        '"strengths":"...","gaps":"...","improvement_direction":"..."}]}\n\n'
        f"Data:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    try:
        resp = client.chat.completions.create(
            model=settings.OPENAI_ASSESSMENT_MODEL,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        data = json.loads((resp.choices[0].message.content or "").strip())
    except Exception:  # noqa: BLE001
        return {
            "criterion_analysis": [
                _row_too_short(p["criterion"]) if very_short else _row_fallback(p["criterion"], achieved=p["achieved"])
                for p in packed
            ]
        }

    raw_rows = data.get("criterion_analysis")
    if not isinstance(raw_rows, list) or len(raw_rows) != len(packed):
        return {
            "criterion_analysis": [
                _row_too_short(p["criterion"]) if very_short else _row_fallback(p["criterion"], achieved=p["achieved"])
                for p in packed
            ]
        }

    by_code: Dict[str, Dict[str, Any]] = {}
    for r in raw_rows:
        if isinstance(r, dict) and r.get("criterion"):
            by_code[str(r["criterion"]).strip()] = r

    out: List[Dict[str, str]] = []
    for p in packed:
        code = p["criterion"]
        conf = _confidence_float(p.get("confidence"))
        achieved = p["achieved"]
        if very_short:
            out.append(_row_too_short(code))
            continue
        if achieved and conf < _WEAK_CONFIDENCE:
            r_llm = by_code.get(code) or by_code.get(code.upper()) or {}
            base = {
                "criterion": code,
                "coverage": "partial",
                "strengths": _clip_field(str(r_llm.get("strengths") or "")) or _row_weak_achieved(code)["strengths"],
                "gaps": _clip_field(str(r_llm.get("gaps") or "")) or _row_weak_achieved(code)["gaps"],
                "improvement_direction": _safe_improvement(
                    str(r_llm.get("improvement_direction") or r_llm.get("improvement") or ""),
                    submission,
                )
                or _row_weak_achieved(code)["improvement_direction"],
            }
            if _norm_coverage(str(r_llm.get("coverage") or "")) == "complete":
                base["coverage"] = "partial"
            out.append(base)
            continue

        r_llm = by_code.get(code) or by_code.get(code.upper()) or {}
        st = _clip_field(str(r_llm.get("strengths") or ""))
        gaps = _clip_field(str(r_llm.get("gaps") or ""))
        imp = _safe_improvement(
            str(r_llm.get("improvement_direction") or r_llm.get("improvement") or ""),
            submission,
        )
        cv = _norm_coverage(str(r_llm.get("coverage") or "partial"))
        if not st or not gaps or not imp:
            fb = _row_fallback(code, achieved=achieved)
            st = st or fb["strengths"]
            gaps = gaps or fb["gaps"]
            imp = imp or fb["improvement_direction"]
            if not cv or cv == "partial":
                cv = fb["coverage"]
        out.append(
            {
                "criterion": code,
                "coverage": cv,
                "strengths": st,
                "gaps": gaps,
                "improvement_direction": imp,
            }
        )
    return {"criterion_analysis": out}
