# app/services/plagiarism_guard.py
"""
فحص الانتحال / البصمة الرقمية — مؤشرات أسلوبية وبلاغية.
لتحسين دقة كشف الانتحال لاحقاً: دمج embeddings (مثلاً sentence-transformers)
ومقارنة مع قاعدة نصوص معروفة أو استخدام خدمة خارجية.
"""
from __future__ import annotations

import os
import re
import math
from typing import Any, Dict, List, Optional

# إعدادات من config إن وُجدت، وإلا fallback
try:
    from app.core.config import settings  # type: ignore
    _CFG_OK = True
except Exception:
    _CFG_OK = False

    class _SettingsFallback:
        PLAGIARISM_MIN_LEN: int = int(os.getenv("PLAGIARISM_MIN_LEN", "80"))
        PLAGIARISM_STRICT: bool = os.getenv("PLAGIARISM_STRICT", "false").lower() == "true"

    settings = _SettingsFallback()

_AR_EN_STOPWORDS = {
    # عربية
    "في", "على", "من", "إلى", "عن", "أن", "إن", "لا", "ما", "مع", "هذا", "هذه", "ذلك", "تلك",
    "هو", "هي", "هم", "هن", "كما", "لقد", "قد", "كان", "كانت", "الله", "تم", "بين", "أيضًا",
    "هناك", "هنا", "أو", "و", "ثم", "لكن", "لان", "لأن", "حتى", "إذا", "مثلاً", "مثل",
    # إنجليزية
    "the", "a", "an", "and", "or", "but", "if", "in", "on", "at", "for", "to", "of", "by",
    "is", "are", "was", "were", "it", "this", "that", "these", "those", "with", "as",
}

def _tokenize(text: str) -> List[str]:
    return re.findall(r"\w+", text.lower(), flags=re.UNICODE)

def _shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    from collections import Counter
    c = Counter(s)
    n = len(s)
    return -sum((cnt / n) * math.log2(cnt / n) for cnt in c.values())

class PlagiarismGuard:
    """
    فاحص أولي سريع يعتمد على مؤشرات أسلوبية/بلاغية (ليس كشف مصادر خارجي).
    يعيد:
      - score: 0..1 (كلما ارتفع زاد الاشتباه)
      - detail: وصف مختصر
      - findings: مؤشرات مساعدة
    """
    def __init__(self, min_len: Optional[int] = None, strict: Optional[bool] = None):
        self.min_len = int(min_len) if min_len is not None else getattr(settings, "PLAGIARISM_MIN_LEN", 80)
        self.strict = bool(strict) if strict is not None else getattr(settings, "PLAGIARISM_STRICT", False)

    async def evaluate(self, text: str) -> Dict[str, Any]:
        t = (text or "").strip()

        # 1) حد أدنى للطول
        if len(t) < self.min_len:
            return {
                "score": 0.0,
                "detail": f"النص أقصر من الحد الأدنى ({self.min_len}). تحليل شكلي فقط.",
                "findings": {"length": len(t), "note": "too_short"},
            }

        # 2) مؤشرات عامة
        urls = re.findall(r"https?://\S+|www\.\S+", t, flags=re.IGNORECASE)
        tokens = _tokenize(t)
        uniq = set(tokens)
        unique_ratio = len(uniq) / max(1, len(tokens))
        stop_ratio = sum(1 for tok in tokens if tok in _AR_EN_STOPWORDS) / max(1, len(tokens))
        repeats = len(re.findall(r"(\b\w+\b)(?:\s+\1){2,}", t.lower()))  # كلمة تتكرر 3 مرات متتالية+
        entropy = _shannon_entropy(t)

        # 3) مؤشرات ذكاء اصطناعي
        ai_markers = []
        for m in ["chatgpt", "gpt", "as an ai", "openai", "bard", "claude", "gemini", "copilot"]:
            if m in t.lower():
                ai_markers.append(m)

        # 4) تقدير درجة الاشتباه
        score = 0.0
        if unique_ratio < 0.45:
            score += 0.25
        if len(urls) >= 3:
            score += 0.15
        if repeats >= 2:
            score += 0.2
        if ai_markers:
            score += 0.25
        if stop_ratio > 0.65:
            score += 0.1
        if self.strict:
            score = min(1.0, score + 0.1)
        score = float(max(0.0, min(1.0, round(score, 3))))

        findings: Dict[str, Any] = {
            "length": len(t),
            "tokens": len(tokens),
            "unique_ratio": round(unique_ratio, 3),
            "stopwords_ratio": round(stop_ratio, 3),
            "urls_count": len(urls),
            "repeat_phrases": repeats,
            "entropy": round(entropy, 3),
            "suspected_ai_markers": ai_markers,
        }

        detail = (
            "تحليل نصي أولي (مؤشرات أسلوبية/بلاغية). ليس حكمًا نهائيًا على الانتحال. "
            "يُفضّل الدمج مع فاحص مصادر خارجي عند توفره."
        )
        return {"score": score, "detail": detail, "findings": findings}