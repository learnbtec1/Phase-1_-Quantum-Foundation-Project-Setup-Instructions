# -*- coding: utf-8 -*-
"""
Student-facing feedback in Arabic: success path, improvement path, optional evidence tie-in.
Does not replace official criteria justifications — composes a separate, pedagogical layer.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# Strip automated system suffixes from assessor text before showing to students
_SYS_START = (
    " [Balance:",
    " [Gate:",
    " [Note:",
    " [PASS",
    " [EVIDENCE",
)


def _clip(s: str, max_len: int) -> str:
    t = re.sub(r"\s+", " ", (s or "").strip())
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def clean_justification_for_feedback(justification: str) -> str:
    """Remove system bracket notes; keep a readable one-line for optional student use."""
    t = (justification or "").strip()
    for marker in _SYS_START:
        i = t.find(marker)
        if i >= 0:
            t = t[:i].strip()
    return re.sub(r"\s+", " ", t).strip()


def _first_quote_from_row(row: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    items = row.get("evidence_items")
    if isinstance(items, list) and items:
        it0 = items[0]
        if isinstance(it0, dict):
            q = str(it0.get("quote") or it0.get("text") or "").strip()
            sf = str(it0.get("source_file") or it0.get("file") or "").strip() or None
            if q:
                return q, sf
    ev = row.get("evidence")
    if isinstance(ev, list) and ev:
        e0 = ev[0]
        if isinstance(e0, str) and e0.strip():
            return e0.strip(), None
        if isinstance(e0, dict):
            q = str(e0.get("quote") or e0.get("text") or "").strip()
            if q:
                return q, str(e0.get("source_file") or "") or None
    return None, None


def _tier_letter(code: str) -> str:
    c = (code or "").strip().upper()
    return c[0] if c else ""


def _confidence_num(row: Dict[str, Any]) -> float:
    c = row.get("confidence")
    if isinstance(c, (int, float)) and 0.0 <= float(c) <= 1.0:
        return float(c)
    return 1.0


def _block_achieved(code: str, level: str, clean_j: str) -> str:
    if level == "P":
        body = (
            "لقد وضّحت فكرة المطلوب بشكل مباشر، "
            "والمستوى يدل على فهمًا أساسيًا ينسجم مع توقعات معيار Pass."
        )
    elif level == "M":
        body = (
            "قدّمت تفكيرًا يربط الأفكار ببعضها (سبب/نتيجة أو علاقة بين العناصر) "
            "بما ينسجم مع توقعات معيار Merit."
        )
    elif level == "D":
        body = (
            "يظهر في إجابتك توجّهًا للتقييم: حكم أو موازنة مبرّرة، "
            "بما ينسجم مع توقعات معيار Distinction."
        )
    else:
        body = "أظهرت في هذا الجزء تقدمًا ينسجم مع وصف المعيار."

    extra = ""
    if len(clean_j) > 60:
        extra = f"\nومن توضيحات التقييم: {_clip(clean_j, 280)}"

    return f"✔ {code} – تم تحقيق المعيار\n{body}{extra}"


def _not_achieved_tip_and_generic(level: str) -> tuple[str, str]:
    if level == "P":
        tip = (
            "حاول التركيز على شرح المفهوم المطلوب بشكل مباشر: ماذا يعني؟ ولماذا يُذكر؟ "
            "يمكنك دعم شرحك بمثال بسيط من سياق المشكلة دون نسخ حلٍ جاهز."
        )
        generic = (
            "يحتاج المعيار إلى بيان أوضح للمفهوم/المطلوب ضمن سياق المهمة، "
            "حتى يتبيّن أنك فهمت المطلوب بالتحديد وليس بشكل عام."
        )
    elif level == "M":
        tip = (
            "💡 حاول أن تربط العوامل ببعض: كيف يؤثّر أحدهم في الآخر؟ "
            "تجنّب الاكتفاء بالترقيع؛ صِغ جملة واحدة تشرح **العلاقة**."
        )
        generic = (
            "ما زال الرد يلمس الفكرة دون عرض **تحليل** واضح للروابط أو التأثيرات بين العناصر، "
            "كما يتوقّف معيار Merit عادة."
        )
    elif level == "D":
        tip = (
            "💡 اصنع موقفًا مُعلَّلاً: خيار أو توصية، ولماذا؟ وما تكاليف/فوائد بسيطة؟ "
            "لا يلزمك «الحل النهائي»، بل **اتجاه تفكير** مبرر من النصوص."
        )
        generic = (
            "لم يتبيّن بعد **تقييم** مدعوم بمقارنة أو تبرير كافٍ (حسب توقعات Distinction)، "
            "حتى وإن وصفت الظاهرة بشكل جيد."
        )
    else:
        tip = "راجع صياغة المعيار واقترح تعديلاً واحدًا واضحًا على فقرة واحدة في إجابتك."
        generic = "ما زال هناك فجوة بين ما طُلِب في المعيار وما ظهر في إجابتك بوضوح."

    return tip, generic


def _block_not_achieved(code: str, level: str, clean_j: str) -> str:
    tip, generic = _not_achieved_tip_and_generic(level)
    obs = f"\nباختصار: {_clip(clean_j, 360)}" if clean_j else ""
    if not clean_j:
        obs = f"\n{generic}"
    return f"❌ {code} – لم يتم تحقيق المعيار{obs}\n💡 {tip}"


def format_one_criterion_feedback(row: Dict[str, Any]) -> str:
    """Build one student-facing block (multi-line string) for a single criterion row."""
    code = str(row.get("code") or "?").strip()
    achieved = bool(row.get("achieved"))
    raw_j = str(row.get("justification") or "")
    clean_j = clean_justification_for_feedback(raw_j)
    level = _tier_letter(code)
    conf = _confidence_num(row)

    if achieved:
        block = _block_achieved(code, level, clean_j)
    else:
        why_not = str(row.get("why_not_achieved") or "").strip()
        impr = str(row.get("improvement_hint") or "").strip()
        if why_not or impr:
            t_gen, g_gen = _not_achieved_tip_and_generic(level)
            reason_block = why_not or (f"باختصار: {_clip(clean_j, 360)}" if clean_j else g_gen)
            tip_block = impr or t_gen
            block = "\n\n".join(
                [
                    f"❌ {code} – لم يتم تحقيق المعيار بعد",
                    f"🔍 السبب:\n{reason_block}",
                    f"💡 لتحسين الإجابة:\n{tip_block}",
                    "🚀 الخلاصة: راجع صياغة المعيار في الواجب وعزز ما طُلب صراحةً في نصك.",
                ]
            )
        else:
            block = _block_not_achieved(code, level, clean_j)

    quote, src = _first_quote_from_row(row)
    if quote:
        qd = _clip(quote, 120)
        src_lbl = f" ({src})" if src else ""
        block += f'\n📌 مثال من إجابتك{src_lbl}: «{qd}»'

    if conf < 0.8:
        if bool(row.get("achieved")) and row.get("meets_assignment_minimum") is True:
            block += (
                "\n(ملاحظة: **استيفاء الحد الأدنى** واضح في هذا السطر، والأدلة **قابلة للتقوية** "
                "للمستويات الأعلى — عزز الاقتباسات أو الروابط في التقييمات القادمة.)"
            )
        else:
            block += (
                "\n(ملاحظة: قوة دعم الإجابة في هذا السطر **متوسطة**؛ "
                "زد التوضيح والأمثلة من نصك لترفع الثقة لدى المقيّم.)"
            )

    return block


def _format_aware_lead(submission_format: Optional[str]) -> List[str]:
    """Short lines so students are not told their answer is 'too short' when bullets/slides are appropriate."""
    f = (submission_format or "mixed").strip()
    if f == "slides_style":
        return [
            "تنسيق الإجابة: يبدو عملك قريبًا من عرض تقديمي أو سطور قصيرة — الاختصار هنا طبيعي.",
            "جرّب إضافة سطر توضيحي بسيط بجانب كل نقطة رئيسية لتعزيز الفهم دون تحويل الإجابة إلى مقال طويل.",
        ]
    if f == "bullet_points":
        return [
            "تنسيق الإجابة: استخدمت النقاط — وهذا مقبول كبنية.",
            "لرفع المستوى: أضف سببًا أو مثالًا خفيفًا بعد النقطة التي تحتاج برهانًا؛ لا تكتفِ بالذكر فقط.",
        ]
    if f == "essay":
        return []
    return [
        "تنسيق الإجابة: مختلط؛ ركّز على وضوح الفكرة في كل جزء سواء كان فقرة أو نقطة.",
    ]


def generate_student_feedback(
    criteria_results: Any,
    *,
    submission_format: Optional[str] = None,
    format_mismatch_message: Optional[str] = None,
) -> List[str]:
    """
    Build a list of Arabic feedback strings (one per criterion), teacher-style, non-prescriptive
    (hints / directions, not model answers).
    """
    out: List[str] = []
    fm = (format_mismatch_message or "").strip()
    if fm:
        out.append(f"تنسيق التسليم: {fm}")
    if not isinstance(criteria_results, list) or not criteria_results:
        return out
    out.extend(_format_aware_lead(submission_format))
    for row in criteria_results:
        if not isinstance(row, dict):
            continue
        if not str(row.get("code") or "").strip():
            continue
        try:
            out.append(format_one_criterion_feedback(row))
        except Exception:
            continue
    return out
