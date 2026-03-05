# -*- coding: utf-8 -*-
"""
Criteria Extractor v3.1 (Arabic + English + Robust P/M/D Detection)
-------------------------------------------------------------------
- يلتقط معايير BTEC (P/M/D) بصيغ مختلفة عربية/إنجليزية.
- يدعم الفواصل العربية: . : ، ؛ ـ — – ) » ] } … إلخ.
- يدعم الأقواس والفواصل المتنوعة قبل/بعد رقم المعيار.
- يلتقط الوصف الممتد للمعيار حتى بداية معيار جديد.
- يتجاهل الأنماط غير الصحيحة (أرقام خارج 1..35).
"""

from __future__ import annotations
import re
from typing import Dict

__all__ = ["extract_criteria_with_descriptions"]

# ============================
#  Regex نهائي شامل للمستويات:
# ============================
# يلتقط:
#   P1: النص…
#   M2 – النص…
#   (D3) النص…
#   P4 النص…
#   D5: النص
#   مدمج مع الفواصل العربية: . : ، ؛ — – ) » ] }
#
# ويوقف عند:
#   سطر يبدأ بمعيار جديد (P/M/D + رقم)
# ============================

_PATTERN = re.compile(
    r"""
    (?<!\w)                # لا يسبقه حرف كلمة
    \(?                    # احتمال وجود قوس قبل الكود
    \s*([PMDpm d])\s* # الحرف الأساسي (P/M/D) مع تسامح الفراغات
    ([0-9]{1,2})           # رقم المعيار (1..35 عادةً)
    \s* # قد يكون هناك فراغ
    [\-\–\—\.\:\،\؛\)\»\]\}]* # فواصل عربية وإنجليزية اختيارية
    \s* # مسافة
    (.+?)                  # الوصف الكامل للمعيار
    (?=                    # التوقف عند بداية معيار جديد
        (?:\r?\n\s*\(?\s*[PMDpm d]\s*[0-9]{1,2})  # سطر جديد به معيار آخر
        |$                 # أو نهاية النص
    )
""",
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)


def extract_criteria_with_descriptions(text: str) -> Dict[str, str]:
    """
    يرجع قاموسًا بالشكل:
    {
        "P1": "الوصف الكامل",
        "P2": "الوصف...",
        "M1": "....",
        "D1": "..."
    }
    مع ترتيب صحيح P → M → D وبحسب الرقم.
    """

    criteria: Dict[str, str] = {}

    if not text:
        return {}

    for match in _PATTERN.finditer(text):
        letter_raw = match.group(1).strip().upper()
        number_raw = match.group(2)
        desc = (match.group(3) or "").strip()

        # Normalize letter: p/m/d → P/M/D
        if letter_raw.startswith("P"):
            letter = "P"
        elif letter_raw.startswith("M"):
            letter = "M"
        elif letter_raw.startswith("D"):
            letter = "D"
        else:
            continue

        # Validate number
        try:
            num = int(number_raw)
        except ValueError:
            continue

        if not (1 <= num <= 35):
            continue

        code = f"{letter}{num}"

        if desc:
            criteria[code] = desc

    # ترتيب P ثم M ثم D ثم الرقم
    def sort_key(item):
        key = item[0]
        order = {"P": 0, "M": 1, "D": 2}.get(key[0], 3)
        try:
            number = int(re.sub(r"[^0-9]", "", key))
        except Exception:
            number = 999
        return (order, number)

    return dict(sorted(criteria.items(), key=sort_key))