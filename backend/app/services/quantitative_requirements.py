# -*- coding: utf-8 -*-
"""
Advanced Quantitative Requirements Extractor (BTEC) — v3.1 (Arabic + English)
-----------------------------------------------------------------------------
- يدعم العربية/الإنجليزية والأرقام (غربية/هندية).
- يلتقط: على الأقل/حد أدنى/بالضبط/حد أقصى، مقارنة بين، تثنية عربية (شركتان/شركتين/مثالان/مثالين...=2).
- يجمع قيودًا per-target ويُنتج general لاستخدام قاعدة العدّ.
"""

from __future__ import annotations
import re
import unicodedata
from typing import Dict, Any, List, Tuple, Optional

__all__ = [
    "extract_quantitative_requirements_advanced",
    "extract_quantitative_requirements",
    "_TARGET_SYNONYMS",
]

# ---- أرقام كلمات عربية/إنجليزية ----
_AR_NUM_WORDS = {
    "صفر":0, "واحد":1, "واحدة":1, "احد":1,
    "اثنان":2, "اثنين":2, "اثنتين":2, "إثنان":2, "إثنين":2, "إثنتين":2,
    "زوج":2, "ثنائي":2, "مزدوج":2,
    "ثلاث":3, "ثلاثة":3, "أربع":4, "أربعة":4, "خمس":5, "خمسة":5,
    "ست":6, "ستة":6, "سبع":7, "سبعة":7,
    "ثمان":8, "ثماني":8, "ثمانية":8, "تسع":9, "تسعة":9,
    "عشر":10, "عشرة":10, "أحد عشر":11, "احد عشر":11, "إحدى عشر":11,
    "اثنا عشر":12, "إثنا عشر":12, "اثني عشر":12, "إثني عشر":12,
    "ثلاثة عشر":13, "أربعة عشر":14, "خمسة عشر":15,
    "ستة عشر":16, "سبعة عشر":17, "ثمانية عشر":18, "تسعة عشر":19,
    "عشرون":20, "عشرين":20,
    "ثلاثون":30, "ثلاثين":30, "أربعون":40, "أربعين":40,
    "خمسون":50, "خمسين":50, "ستون":60, "ستين":60,
    "سبعون":70, "سبعين":70, "ثمانون":80, "ثمانين":80,
    "تسعون":90, "تسعين":90,
}

_EN_NUM_WORDS = {
    "zero":0, "one":1, "a":1, "an":1, "two":2, "pair":2, "couple":2,
    "three":3, "four":4, "five":5, "six":6, "seven":7, "eight":8, "nine":9,
    "ten":10, "eleven":11, "twelve":12, "thirteen":13, "fourteen":14, "fifteen":15,
    "sixteen":16, "seventeen":17, "eighteen":18, "nineteen":19,
    "twenty":20, "thirty":30, "forty":40, "fifty":50, "sixty":60,
    "seventy":70, "eighty":80, "ninety":90,
}
_EN_SCALES = {"hundred": 100, "thousand": 1000}  # احتياط

# ---- أهداف العدّ: مرادفات عربية/إنجليزية ----
_TARGET_SYNONYMS: Dict[str, List[str]] = {
    "businesses":  [r"شرك(?:ة|تان|تين|ات)", r"منشآت", r"أعمال", r"شركات",
                    r"business(?:es)?", r"compan(?:y|ies)", r"firm(?:s)?",
                    r"organis(?:ation|ations)", r"organization(?:s)?"],
    "examples":    [r"مثال(?:ان|ين|ات)?", r"أمثلة",
                    r"examples?", r"case studies?", r"scenarios?"],
    "methods":     [r"طريق(?:ة|تان|تين|ات)", r"طرق", r"أساليب", r"منهجي(?:ة|ات)",
                    r"methods?", r"approaches?", r"ways?"],
    "factors":     [r"عامل(?:ان|ين|ات)?", r"عوامل", r"factors?"],
    "advantages":  [r"مزايا", r"فوائد", r"إيجابيات", r"advantages?", r"benefits?"],
    "disadvantages":[r"عيوب", r"سلبيات", r"مساوئ", r"disadvantages?", r"drawbacks?|cons?"],
    "features":    [r"سمات", r"خصائص", r"ميزات", r"features?"],
    "impacts":     [r"آثار", r"تأثير(?:|ات)", r"impacts?", r"effects?"],
}

# ---- مؤشرات كمية عربية/إنجليزية ----
_AT_LEAST  = [r"على الأقل", r"لا يقل عن", r"حد أدنى", r"اقل شي", r"at least", r"no less than", r"minimum(?: of)?"]
_AT_MOST   = [r"على الأكثر", r"لا يزيد عن", r"حد أقصى", r"at most", r"no more than", r"maximum(?: of)?"]
_EXACTLY   = [r"بالضبط", r"تماما", r"تمامًا", r"exact(?:ly)?", r"precisely"]

# ---- إشارات مقارنة عربية/إنجليزية ----
_COMPARE_VERBS = [r"قارن(?:\s*بين)?", r"مقارنة\s*بين", r"compare", r"contrast", r"بين\s+.+?\s+و"]

# ---- أفعال تحليل/تعداد (تفيد صيغة الجمع ≥2 إن لم يوجد رقم) ----
_DEF_ANALYTIC_VERBS = [r"list", r"identify", r"outline", r"discuss", r"analy(?:s|z)e",
                       r"اذكر", r"حدد", r"استعرض", r"ناقش", r"حلل", r"بين", r"وضّح", r"وضح"]

# ================= Helpers =================
def _normalize_text(text: str) -> str:
    """تطبيع عربي/لاتيني: أرقام هندية→لاتينية، إزالة التشكيل/التمطيط، توحيد الألف/الياء المقصورة."""
    if not text:
        return ""
    trans = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
    t = text.translate(trans)
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    t = t.replace("ـ", "")
    t = (t.replace("أ","ا").replace("إ","ا").replace("آ","ا")
           .replace("ى","ي").replace("ة","ه"))
    t = re.sub(r"\s+", " ", t)
    return t.strip()

def _english_words_to_int(tokens: List[str], i: int) -> Tuple[Optional[int], int]:
    """تحويل ألفاظ الأعداد الإنجليزية إلى رقم داخل نافذة قصيرة (يدعم تركيب العشرات)."""
    val = 0
    consumed = 0
    w = tokens[i].lower()
    if w in _EN_NUM_WORDS:
        val = _EN_NUM_WORDS[w]; consumed = 1
    if consumed == 1 and i+1 < len(tokens):
        w2 = tokens[i+1].lower()
        if w2 in _EN_NUM_WORDS and _EN_NUM_WORDS[w] >= 20:
            val = _EN_NUM_WORDS[w] + _EN_NUM_WORDS[w2]
            consumed = 2
    if consumed >= 1 and i+consumed < len(tokens):
        w3 = tokens[i+consumed].lower()
        if w3 in _EN_SCALES:
            val = val * _EN_SCALES[w3]
            consumed += 1
    return (val if consumed else None, consumed)

def _arabic_words_to_int(text: str) -> Optional[int]:
    """مطابقة مفردات عربية شائعة للأعداد (أحد عشر/اثنا عشر/..)."""
    for k, v in sorted(_AR_NUM_WORDS.items(), key=lambda x: -len(x[0])):
        pattern = r"(?<!\w)" + re.escape(k) + r"(?!\w)"
        if re.search(pattern, text, flags=re.IGNORECASE):
            return v
    return None

def _find_target(text: str) -> Optional[str]:
    """يعيد اسم الهدف (businesses/examples/...) إن وجد مرادف له في النص."""
    for tgt, pats in _TARGET_SYNONYMS.items():
        for p in pats:
            if re.search(rf"(?<!\w){p}(?!\w)", text, flags=re.IGNORECASE):
                return tgt
    return None

def _has_compare_signal(text: str) -> bool:
    return any(re.search(rf"{p}", text, flags=re.IGNORECASE) for p in _COMPARE_VERBS)

def _op_from_context(snippet: str) -> str:
    if any(re.search(rf"(?<!\w){p}(?!\w)", snippet, flags=re.IGNORECASE) for p in _EXACTLY):
        return "="
    if any(re.search(rf"(?<!\w){p}(?!\w)", snippet, flags=re.IGNORECASE) for p in _AT_LEAST):
        return ">="
    if any(re.search(rf"(?<!\w){p}(?!\w)", snippet, flags=re.IGNORECASE) for p in _AT_MOST):
        return "<="
    return ">="  # افتراضي عند وجود جمع بلا رقم

def _confidence_heuristic(op: str, value: int, has_explicit_number: bool, compare_signal: bool) -> float:
    base = 0.6
    if has_explicit_number: base += 0.25
    if compare_signal and value >= 2: base += 0.1
    if op in ("=", ">="): base += 0.05
    return min(base, 0.98)

# ---- تثنية عربية صريحة: شركتان/شركتين، مثالان/مثالين، طريقتان/طريقتين، عاملان/عاملين ----
_DUAL_TAILS: List[Tuple[str, str]] = [
    (r"شركتان|شركتين", "businesses"),
    (r"مثالان|مثالين", "examples"),
    (r"طريقتان|طريقتين", "methods"),
    (r"عاملان|عاملين", "factors"),
]

def _inject_dual_form_constraints(text: str, constraints: List[Dict[str, Any]]) -> None:
    for patt, tgt in _DUAL_TAILS:
        for m in re.finditer(rf"(?<!\w){patt}(?!\w)", text, flags=re.IGNORECASE):
            constraints.append({
                "target": tgt, "op": "=", "value": 2,
                "source": text[m.start():m.end()], "start": m.start(), "end": m.end(),
                "confidence": 0.92,
            })

# ================= Main advanced extractor =================
def extract_quantitative_requirements_advanced(assignment: str) -> Dict[str, Any]:
    """
    يُرجع:
    {
      "constraints": [
        {"target":"businesses","op":">=","value":2,"source":"...","start":10,"end":38,"confidence":0.9},
        ...
      ],
      "by_target": {"businesses":2, "examples":3, ...},
      "general": 3
    }
    """
    text = _normalize_text(assignment)
    constraints: List[Dict[str, Any]] = []

    # (1) رقم صريح قبل الهدف: "3 شركات" / "3 examples"
    for m in re.finditer(r"(?P<num>\d+)\s+(?P<chunk>.{0,60}?)", text, flags=re.IGNORECASE):
        num = int(m.group("num"))
        chunk = m.group("chunk")
        tgt = _find_target(chunk)
        if tgt:
            op = _op_from_context(chunk)
            conf = _confidence_heuristic(op, num, True, _has_compare_signal(text[max(0, m.start()-30):m.end()+30]))
            constraints.append({
                "target": tgt, "op": op, "value": num,
                "source": text[m.start():m.end()], "start": m.start(), "end": m.end(),
                "confidence": conf,
            })

    # (2) ألفاظ العدد EN/AR قبل الهدف ضمن نافذة قصيرة
    tokens = re.findall(r"[A-Za-z]+|\d+|[^\sA-Za-z\d]+", text)
    for i, tok in enumerate(tokens):
        # EN
        val_en, used = _english_words_to_int(tokens, i)
        if val_en:
            window = " ".join(tokens[i:i+used+6])
            tgt = _find_target(window)
            if tgt:
                op = _op_from_context(window)
                conf = _confidence_heuristic(op, val_en, True, _has_compare_signal(window))
                constraints.append({
                    "target": tgt, "op": op, "value": val_en,
                    "source": window, "start": -1, "end": -1, "confidence": conf,
                })
        # AR
        if re.match(r"[^\w]", tok or ""):
            continue
        window_text = " ".join(tokens[max(0, i-2): i+8])
        val_ar = _arabic_words_to_int(window_text)
        if val_ar is not None:
            tgt = _find_target(window_text)
            if tgt:
                op = _op_from_context(window_text)
                conf = _confidence_heuristic(op, val_ar, True, _has_compare_signal(window_text))
                constraints.append({
                    "target": tgt, "op": op, "value": val_ar,
                    "source": window_text, "start": -1, "end": -1, "confidence": conf,
                })

    # (3) تثنية عربية صريحة
    _inject_dual_form_constraints(text, constraints)

    # (4) إشارات مقارنة ⇒ ≥ 2
    if _has_compare_signal(text):
        for tgt, pats in _TARGET_SYNONYMS.items():
            for p in pats:
                if re.search(p, text, flags=re.IGNORECASE):
                    constraints.append({
                        "target": tgt, "op": ">=", "value": 2,
                        "source": "compare/contrast signal near plural target",
                        "start": -1, "end": -1, "confidence": 0.85,
                    })
                    break

    # (5) pair/couple/زوج/ثنائي/مزدوج of <target> ⇒ = 2
    pair_patterns = [
        r"(pair|couple)\s+of\s+(?P<tail>.{0,50})",
        r"(زوج|ثنائي|مزدوج)\s+(?P<tail>.{0,50})",
    ]
    for pp in pair_patterns:
        for m in re.finditer(pp, text, flags=re.IGNORECASE):
            tail = m.group("tail")
            tgt = _find_target(tail)
            if tgt:
                constraints.append({
                    "target": tgt, "op": "=", "value": 2,
                    "source": text[m.start():m.end()], "start": m.start(), "end": m.end(),
                    "confidence": 0.9,
                })

    # (6) advantages & disadvantages ⇒ ≥ 1 لكل جانب
    has_adv = any(re.search(p, text, flags=re.IGNORECASE) for p in _TARGET_SYNONYMS["advantages"])
    has_dis = any(re.search(p, text, flags=re.IGNORECASE) for p in _TARGET_SYNONYMS["disadvantages"])
    if has_adv and has_dis:
        constraints += [
            {"target":"advantages","op":">=","value":1,"source":"advantages & disadvantages","start":-1,"end":-1,"confidence":0.8},
            {"target":"disadvantages","op":">=","value":1,"source":"advantages & disadvantages","start":-1,"end":-1,"confidence":0.8},
        ]

    # (7) جمع بلا رقم + فعل تحليلي ⇒ نفترض ≥ 2
    for tgt, pats in _TARGET_SYNONYMS.items():
        found_plural = any(re.search(p, text, flags=re.IGNORECASE) for p in pats)
        near_verb = any(re.search(v, text, flags=re.IGNORECASE) for v in _DEF_ANALYTIC_VERBS)
        if found_plural and near_verb:
            if not any(c["target"] == tgt and c["value"] >= 2 for c in constraints):
                constraints.append({
                    "target": tgt, "op": ">=", "value": 2,
                    "source": "implicit plural with analytic verb", "start": -1, "end": -1,
                    "confidence": 0.65,
                })

    # (8) تلخيص per-target + general
    by_target: Dict[str, int] = {}
    for c in constraints:
        val = int(c["value"])
        if c["op"] in ("=", ">="):
            agg = val
        elif c["op"] == "<=":
            agg = max(1, min(2, val))  # نادراً ما يطلب BTEC سقفاً أعلى، نحافظ على ملخص محافظ
        else:
            agg = val
        by_target[c["target"]] = max(by_target.get(c["target"], 0), agg)

    general = 0
    for k in ("businesses", "examples", "methods", "factors"):
        if k in by_target:
            general = max(general, by_target[k])

    return {
        "constraints": constraints,
        "by_target": by_target,
        "general": general if general > 0 else (2 if _has_compare_signal(text) else 0),
    }

# ============== واجهة Drop-in متوافقة مع محركك ==============
def extract_quantitative_requirements(assignment: str) -> Dict[str, int]:
    adv = extract_quantitative_requirements_advanced(assignment)
    out: Dict[str, int] = {}
    if adv.get("general"):
        out["general"] = int(adv["general"])
    for tgt, val in adv["by_target"].items():
        out[tgt] = int(val)
    return out