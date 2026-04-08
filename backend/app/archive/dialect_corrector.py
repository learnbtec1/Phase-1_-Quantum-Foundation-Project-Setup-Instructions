# -*- coding: utf-8 -*-
"""
Egyptian → Jordanian text normalization for Cogni TTS and tutor pipeline.

Runs as a regex layer after tutor._jordanize (extra catches) and before Azure/edge TTS
so any remaining Egyptian tokens are reduced before synthesis.
"""
from __future__ import annotations

import logging
import re
from typing import List, Optional, Tuple

logger = logging.getLogger("cogni.dialect_corrector")

# Compiled rules: longest / most specific patterns first where order matters.
_RULES: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bخلاص كده\b", re.UNICODE), "تمام هيك"),
    (re.compile(r"\bإيه اللي\b", re.UNICODE), "شو اللي"),
    (re.compile(r"\bايه اللي\b", re.UNICODE), "شو اللي"),
    (re.compile(r"\bمش هقدر\b", re.UNICODE), "ما بقدر"),
    (re.compile(r"\bمش عارف\b", re.UNICODE), "مو عارف"),
    (re.compile(r"\bمش فاهم\b", re.UNICODE), "مو فاهم"),
    (re.compile(r"\bمش هينفع\b", re.UNICODE), "مو بينفع"),
    (re.compile(r"\bمش كده\b", re.UNICODE), "مو هيك"),
    (re.compile(r"\bمش كدا\b", re.UNICODE), "مو هيك"),
    (re.compile(r"\bليه كده\b", re.UNICODE), "ليش هيك"),
    (re.compile(r"\bعامل إيه\b", re.UNICODE), "شو أخبارك"),
    (re.compile(r"\bعامل ايه\b", re.UNICODE), "شو أخبارك"),
    (re.compile(r"\bبتعمل إيه\b", re.UNICODE), "شو بتعمل"),
    (re.compile(r"\bبتعمل ايه\b", re.UNICODE), "شو بتعمل"),
    (re.compile(r"\bإزيك\b", re.UNICODE), "كيفك"),
    (re.compile(r"\bازيك\b", re.UNICODE), "كيفك"),
    (re.compile(r"\bإنتا\b", re.UNICODE), "إنت"),
    (re.compile(r"\bانتا\b", re.UNICODE), "انت"),
    (re.compile(r"\bإيه\b", re.UNICODE), "شو"),
    (re.compile(r"\bايه\b", re.UNICODE), "شو"),
    (re.compile(r"\bكده\b", re.UNICODE), "هيك"),
    (re.compile(r"\bكدا\b", re.UNICODE), "هيك"),
    (re.compile(r"\bكدة\b", re.UNICODE), "هيك"),
    (re.compile(r"\bدلوقتي\b", re.UNICODE), "هسا"),
    (re.compile(r"\bدلوقت\b", re.UNICODE), "هسا"),
    (re.compile(r"\bفين\b", re.UNICODE), "وين"),
    (re.compile(r"\bإزاي\b", re.UNICODE), "شلون"),
    (re.compile(r"\bازاي\b", re.UNICODE), "شلون"),
    (re.compile(r"\bليه\b", re.UNICODE), "ليش"),
    (re.compile(r"\bعشان\b", re.UNICODE), "مشان"),
    (re.compile(r"\bعلشان\b", re.UNICODE), "عشان"),
    (re.compile(r"\bعايزة?\b", re.UNICODE), "بدي"),
    (re.compile(r"\bعاوز\b", re.UNICODE), "بدي"),
    (re.compile(r"\bعاوزة\b", re.UNICODE), "بدي"),
    (re.compile(r"\bعايز\b", re.UNICODE), "بدي"),
    (re.compile(r"\bده\b", re.UNICODE), "هاد"),
    (re.compile(r"\bدي\b", re.UNICODE), "هاي"),
    (re.compile(r"\bدول\b", re.UNICODE), "هدول"),
    (re.compile(r"\bمنين\b", re.UNICODE), "من وين"),
    (re.compile(r"\bامتى\b", re.UNICODE), "متى"),
    (re.compile(r"\bكويس\b", re.UNICODE), "منيح"),
    (re.compile(r"\bكويسة\b", re.UNICODE), "منيحة"),
    (re.compile(r"\bجامد\b", re.UNICODE), "رائع"),
    (re.compile(r"\bزي ما\b", re.UNICODE), "مثل ما"),
    (re.compile(r"\bزي\b", re.UNICODE), "مثل"),
    (re.compile(r"\bأيوة\b", re.UNICODE), "نعم"),
    (re.compile(r"\bايوة\b", re.UNICODE), "نعم"),
    (re.compile(r"\bأيوه\b", re.UNICODE), "نعم"),
    (re.compile(r"\bطب\b", re.UNICODE), "طيب"),
    (re.compile(r"\bمش\b", re.UNICODE), "مو"),
]

EGYPTIAN_MARKERS = frozenset(
    {
        "إزيك",
        "ازيك",
        "إيه",
        "ايه",
        "كده",
        "كدا",
        "عايز",
        "عاوز",
        "ده",
        "ليه",
        "فين",
        "منين",
        "ازاي",
        "إزاي",
        "مش",
        "دلوقتي",
        "علشان",
    }
)

_corrector_instance: Optional["DialectCorrector"] = None


class DialectCorrector:
    """Regex-based Egyptian → Jordanian pass for TTS-bound Arabic."""

    def __init__(self, enabled: bool = True, log_corrections: bool = True) -> None:
        self.enabled = enabled
        self.log_corrections = log_corrections
        self._correction_count = 0

    def correct_text(self, text: str, context: Optional[str] = None) -> Tuple[str, bool]:
        if not self.enabled or not (text or "").strip():
            return text, False
        original = text
        t = text
        for pat, repl in _RULES:
            t = pat.sub(repl, t)
        was_corrected = t != original
        if was_corrected:
            self._correction_count += 1
            if self.log_corrections:
                logger.info(
                    "[DialectCorrector] corrected (%s) | in=%r | out=%r",
                    context or "unknown",
                    original[:120],
                    t[:120],
                )
        return t, was_corrected

    def detect_egyptian_markers(self, text: str) -> bool:
        if not text:
            return False
        tokens = re.split(r"\s+", text)
        return any(tok.strip(".,!?;:،؛؟").strip() in EGYPTIAN_MARKERS for tok in tokens if tok)

    def get_statistics(self) -> dict:
        return {"total_corrections": self._correction_count, "rules": len(_RULES)}


def get_dialect_corrector() -> DialectCorrector:
    global _corrector_instance
    if _corrector_instance is None:
        try:
            from app.core.config import settings as _s

            _corrector_instance = DialectCorrector(
                enabled=bool(getattr(_s, "TTS_REJECT_EGYPTIAN_VOCABULARY", True)),
                log_corrections=bool(getattr(_s, "TTS_LOG_DIALECT_CORRECTIONS", True)),
            )
        except Exception:
            _corrector_instance = DialectCorrector(enabled=True, log_corrections=True)
    return _corrector_instance


def reset_dialect_corrector_for_tests() -> None:
    """Clear singleton (pytest)."""
    global _corrector_instance
    _corrector_instance = None


def maybe_correct_egyptian_for_tts(text: str, context: str = "tts") -> str:
    """If settings allow, run dialect pass; never raises."""
    if not (text or "").strip():
        return text
    try:
        from app.core.config import settings as _s

        if not bool(getattr(_s, "TTS_REJECT_EGYPTIAN_VOCABULARY", True)):
            return text
        out, _ = get_dialect_corrector().correct_text(text, context)
        return out
    except Exception as exc:
        logger.debug("[DialectCorrector] skip correction: %s", exc)
        return text
