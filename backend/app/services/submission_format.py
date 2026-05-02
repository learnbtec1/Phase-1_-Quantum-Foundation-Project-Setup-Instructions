# -*- coding: utf-8 -*-
"""
Heuristic detection of how the student organized their work (not assignment genre from brief).
Drives fair evidence thresholds and rewrite/feedback (avoid essay-only bias vs bullets/slides).
"""
from __future__ import annotations

import re
from typing import Final, Literal

SubmissionFormat = Literal["bullet_points", "slides_style", "essay", "mixed"]

SUPPORTED: Final = frozenset({"bullet_points", "slides_style", "essay", "mixed"})


def detect_submission_format(text: str) -> str:
    """
    Infer layout style from the merged submission text.
    Order: many bullets → slide-like short lines → long prose → otherwise mixed.
    """
    t = (text or "").strip()
    if not t:
        return "mixed"
    lines = t.splitlines()
    if not lines:
        return "mixed"
    n = max(1, len(lines))
    bullet_count = 0
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith(("-", "•", "*", "·", "–")):
            bullet_count += 1
            continue
        if re.match(r"^\d{1,3}[\).]\s+\S", s):
            bullet_count += 1
    non_empty = [l for l in lines if l.strip()]
    if not non_empty:
        return "mixed"
    short_lines = sum(1 for l in non_empty if len(l.strip()) < 80)
    if bullet_count > 5:
        return "bullet_points"
    if n >= 3 and (short_lines / max(1, len(non_empty))) > 0.6:
        return "slides_style"
    if len(t) > 1500:
        return "essay"
    return "mixed"


def submission_format_label_ar(fmt: str) -> str:
    """UI label (Arabic) for teacher / transparency."""
    m = {
        "bullet_points": "نقاط وقوائم (Bullet points)",
        "slides_style": "عرض تقديمي / سطور قصيرة (Slides-style)",
        "essay": "نص مترابط / فقرات (Essay)",
        "mixed": "مختلط / غير مُحَدد بوضوح",
    }
    return m.get((fmt or "").strip(), m["mixed"])


def grader_block_for_submission_format(fmt: str) -> str:
    """User-message hint so the grader model does not treat all work as a single essay."""
    f = (fmt or "mixed").strip()
    if f not in SUPPORTED:
        f = "mixed"
    return f"""[DETECTED SUBMISSION FORMAT: {f}]
- If the work is **bullet_points** or **slides_style**: very short lines are **normal**; do not penalize lack of long paragraphs. Evidence "quotes" may be short; judge cognitive depth, not word count per line.
- If **slides_style** only: nudge your internal confidence down slightly for borderline cases (sparse wording is expected).
- If **essay**: coherent paragraphs and fuller quotes are natural expectations.
- If **mixed**: use judgement; do not assume a single block must read like a formal essay."""


def thin_evidence_multiplier(fmt: str) -> float:
    """Multiplier applied in thin-quote confidence pass (1.0 = no extra penalty from this pass)."""
    f = (fmt or "mixed").strip()
    if f == "bullet_points":
        return 1.0
    if f == "slides_style":
        return 0.95
    return 0.92  # essay / mixed — softer than legacy when minimum still met (pipeline can recover further)

def weak_validated_confidence_base(fmt: str) -> float:
    """When achieved=True but no quote survived validation, scale model confidence (was *0.7)."""
    f = (fmt or "mixed").strip()
    if f == "bullet_points":
        return 0.90
    if f == "slides_style":
        return 0.86
    return 0.80


def min_evidence_chars_for_weak_check(fmt: str) -> int:
    """Total quoted chars before we flag *thin* evidence."""
    f = (fmt or "mixed").strip()
    if f == "bullet_points":
        return 8
    if f == "slides_style":
        return 10
    return 20  # essay / mixed — matches previous MIN_EVIDENCE_CHARS_STRICT
