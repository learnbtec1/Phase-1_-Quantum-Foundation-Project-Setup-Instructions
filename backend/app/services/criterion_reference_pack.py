# -*- coding: utf-8 -*-
"""
Static criterion / case reference packs (JSON under backend/data/cogni_reference_packs/).

Injected into tutor system prompt when message + focus_subject match — so Cogni can
ground coaching on teacher-stored expectations without relying only on LLM priors.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_PACKS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cogni_reference_packs"
_LOADED: List[Dict[str, Any]] = []


def _load_packs() -> List[Dict[str, Any]]:
    global _LOADED
    if _LOADED:
        return _LOADED
    if not _PACKS_DIR.is_dir():
        logger.debug("[criterion_reference_pack] no directory %s", _PACKS_DIR)
        _LOADED = []
        return _LOADED
    out: List[Dict[str, Any]] = []
    for p in sorted(_PACKS_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("id"):
                out.append(data)
        except Exception as exc:
            logger.warning("[criterion_reference_pack] skip %s: %s", p.name, exc)
    _LOADED = out
    return _LOADED


def _text_matches_patterns(text: str, patterns: List[str]) -> bool:
    t = text or ""
    for pat in patterns:
        try:
            if re.search(pat, t, flags=re.I):
                return True
        except re.error:
            continue
    return False


def _focus_matches(focus: str, substrings: List[str]) -> bool:
    f = (focus or "").strip()
    if not f:
        return False
    for s in substrings:
        if s and str(s).strip() and str(s).strip() in f:
            return True
    return False


def match_pack(message: str, context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    context = context or {}
    focus = str(context.get("focus_subject") or "").strip()
    blob = "\n".join(
        x
        for x in (
            message or "",
            focus,
            str(context.get("deep_link") or ""),
        )
        if x
    )
    for pack in _load_packs():
        m = pack.get("match") or {}
        subs = list(m.get("focus_substrings_any") or [])
        pats = list(m.get("message_patterns_any") or [])
        sub_ok = _focus_matches(focus, subs) if subs else False
        pat_ok = _text_matches_patterns(blob, pats) if pats else False
        if subs and pats:
            if sub_ok or pat_ok:
                return pack
        elif subs and sub_ok:
            return pack
        elif pats and pat_ok:
            return pack
    return None


def _bullets(lines: List[str], prefix: str = "• ") -> str:
    return "\n".join(f"{prefix}{x}" for x in lines if str(x).strip())


def format_pack_for_system_prompt(pack: Dict[str, Any]) -> str:
    title = str(pack.get("title_ar") or pack.get("title") or "مرجع معايير")
    scen = pack.get("scenario_facts_ar") or []
    p1 = pack.get("p1_expected_structure_ar") or []
    p2 = pack.get("p2_expected_structure_ar") or []
    rules = pack.get("coach_rules_ar") or []

    parts = [
        f"### {title}",
        "",
        "**سيناريو مرجعي (حقائق مختصرة — للربط التعليمي):**",
        _bullets([str(x) for x in scen]) if scen else "—",
        "",
        "**شكل إجابة يُتوقع لمستوى Pass — P1 (لا تُسلّمها جاهزة للطالب):**",
        _bullets([str(x) for x in p1]) if p1 else "—",
        "",
        "**شكل إجابة يُتوقع لمستوى Pass — P2:**",
        _bullets([str(x) for x in p2]) if p2 else "—",
        "",
        "**قواعد التوجيه مع هذا المرجع:**",
        _bullets([str(x) for x in rules]) if rules else "—",
    ]
    return "\n".join(parts)


def build_injection_block(message: str, context: Optional[Dict[str, Any]] = None) -> str:
    pack = match_pack(message, context)
    if not pack:
        return ""
    body = format_pack_for_system_prompt(pack)
    return (
        "\n\n## مرجع معايير مخزّن في الخادم (مصدر حقيقة داخلي للمعلّم)\n"
        "القادم من ملفات JSON ثابتة في `data/cogni_reference_packs/`. "
        "استخدمه لتحديد **هيكل الإجابة المتوقع** و**نقاط التدقيق** على P1 وP2 في سياق الحالة. "
        "**ممنوع** إعادة إنتاج نموذج واجب كامل أو فقرات طويلة قابلة للنسخ؛ التزم بمحرك الإسقاط والفحص المصغّر.\n\n"
        + body.strip()
    )
