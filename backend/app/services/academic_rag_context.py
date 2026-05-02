# -*- coding: utf-8 -*-
"""
Context-aware RAG routing: grade / term / subject → pgvector metadata filters + grader scoping.
Works with existing embedding_chunks: uses `category` (folder) from scripts/ingest_data.py and optional `academic` object.
"""
from __future__ import annotations

import json
import logging
import re
from copy import copy
from dataclasses import replace
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Subject heuristics: keywords (Arabic/English) → stable key matching ingest folder names or metadata.
_SUBJECT_PATTERNS: List[Tuple[str, List[str]]] = [
    ("business", ["إدارة", "أعمال", "شركة", "تسويق", "business", "management", "marketing"]),
    ("finance", ["تمويل", "مال", "مالي", "finance", "financial"]),
    ("hr", ["موارد بشرية", "human resource", "hr "]),
    ("btec_specs", ["btec", "pearson", "spec"]),
]

# Grade heuristics → RAG tier (ingest can tag the same in metadata).
_GRADE_PATTERNS: List[Tuple[str, List[str]]] = [
    ("L2_G10", ["العاشر", "الصف العاشر", "عاشر", "grade 10", "g10", " 10 "]),
    ("L3_G11", ["أول ثانوي", "الحادية عشر", "11", "grade 11", "g11"]),
    ("L3_G12", ["توجيهي", "12", "grade 12", "g12", "ثاني ثانوي"]),
]


def normalize_term(term: str) -> Optional[str]:
    """
    Map UI / path labels to canonical terms for RAG + SQL (T1, T2, T3 only).
    Rules: الفصل / الأوّل / الثاني / الثالث, plus T1/t1/term 1, etc. Unknown → None.
    """
    t = (term or "").strip()
    if not t:
        return None
    up = t.upper()
    if re.fullmatch(r"T[123]", up):
        return up
    m = re.match(r"^t\s*([123])$", t, re.I)
    if m:
        return f"T{m.group(1)}"
    m2 = re.search(r"term\s*([123])\b", t, re.I)
    if m2:
        return f"T{m2.group(1)}"
    if "الثالث" in t:
        return "T3"
    if "الثاني" in t:
        return "T2"
    if "الأول" in t or "الاول" in t:
        return "T1"
    if "٣" in t and ("فصل" in t or "الفص" in t):
        return "T3"
    if "٢" in t and ("فصل" in t or "الفص" in t):
        return "T2"
    if "١" in t and ("فصل" in t or "الفص" in t):
        return "T1"
    return None


def normalize_academic_context(ctx: Optional[Dict[str, Any]]) -> Dict[str, str]:
    if not ctx:
        return {}
    raw_term = str(ctx.get("term") or ctx.get("section") or "").strip()
    n_term = normalize_term(raw_term) if raw_term else None
    if raw_term:
        logger.info("[RAG] Normalized term: %s -> %s", raw_term, n_term if n_term is not None else "None")
    return {
        "grade": str(ctx.get("grade") or ctx.get("class") or "").strip(),
        "term": n_term or "",
        "term_raw": raw_term,
        "subject": str(ctx.get("subject") or "").strip(),
    }


def infer_grade_tier(grade: str) -> str:
    g = (grade or "").strip()
    if not g:
        return "GENERAL"
    gl = g.lower()
    for tier, pats in _GRADE_PATTERNS:
        for p in pats:
            if p.lower() in gl or p in g:
                return tier
    if re.search(r"\b1[012]\b", g):
        m = re.search(r"\b(10|11|12)\b", g)
        if m:
            return {10: "L2_G10", 11: "L3_G11", 12: "L3_G12"}.get(int(m.group(1)), "GENERAL")
    return "GENERAL"


def infer_subject_key(subject: str) -> str:
    s = (subject or "").strip()
    if not s:
        return "general"
    sl = s.lower()
    for key, pats in _SUBJECT_PATTERNS:
        for p in pats:
            if p.lower() in sl or p in s:
                return key
    return "general"


def _academic_obj(norm: Dict[str, str], tier: str, subj: str) -> Dict[str, Any]:
    return {
        "grade_tier": tier,
        "subject_key": subj,
        "term": (norm.get("term_raw") or norm.get("term") or "") or "",
        "term_key": (norm.get("term") or "").strip() or None,
        "grade_label": norm.get("grade") or "",
        "subject_label": norm.get("subject") or "",
    }


def build_metadata_filter_chain_for_norm(
    n: Dict[str, str],
) -> Tuple[List[Optional[Dict[str, Any]]], Dict[str, Any]]:
    """
    Like build_metadata_filter_chain but uses an already-normalized context dict
    (avoids double normalize + duplicate term logs in one request).
    """
    if not any(n.values()):
        return [None], {}
    tier = infer_grade_tier(n["grade"])
    sk = infer_subject_key(n["subject"])
    academic_for_grader: Dict[str, Any] = _academic_obj(n, tier, sk)
    chain: List[Optional[Dict[str, Any]]] = []

    # 1) Strong: academic + term (T1–T3 only; no Arabic in JSONB)
    term_key = (n.get("term") or "").strip()
    if term_key in ("T1", "T2", "T3"):
        chain.append(
            {"academic": {"grade_tier": tier, "subject_key": sk, "term": term_key}}
        )
    # 2) academic grade + subject
    chain.append({"academic": {"grade_tier": tier, "subject_key": sk}})
    # 3) grade tier only
    chain.append({"academic": {"grade_tier": tier}})
    # 4) Legacy folder name from scripts/ingest_data (parent dir as category)
    if sk not in ("general", "btec_specs"):
        chain.append({"category": sk})
    # 5) Global BTEC specs pack (typical folder name in /data)
    chain.append({"category": "btec_specs"})

    # Deduplicate while preserving order
    seen: set = set()
    out: List[Optional[Dict[str, Any]]] = []
    for f in chain:
        j = json.dumps(f, sort_keys=True) if f is not None else "null"
        if j in seen:
            continue
        seen.add(j)
        out.append(f)
    out.append(None)
    return out, academic_for_grader


def build_metadata_filter_chain(
    ctx: Optional[Dict[str, Any]],
) -> Tuple[List[Optional[Dict[str, Any]]], Dict[str, Any]]:
    """
    Ordered filters: try strict first, then relax. None = no filter (global vector search).
    """
    n = normalize_academic_context(ctx)
    return build_metadata_filter_chain_for_norm(n)


def merge_jsonb_metadata_filters(
    a: Optional[Dict[str, Any]], b: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not a:
        return copy(b) if b else None
    if not b:
        return copy(a)
    out = dict(a)
    for k, v in b.items():
        if k == "academic" and k in out and isinstance(out[k], dict) and isinstance(v, dict):
            merged = {**out[k], **v}
            out["academic"] = merged
        else:
            out[k] = v
    return out


def format_academic_scoping_for_grader(norm: Dict[str, str], academic_obj: Dict[str, Any]) -> str:
    if not any((norm or {}).values()) and not academic_obj:
        return ""
    g = norm.get("grade") or "—"
    t = (norm.get("term_raw") or norm.get("term") or "").strip() or "—"
    s = norm.get("subject") or "—"
    return (
        "IMPORTANT: Evaluate ONLY in this academic context (ignore unrelated levels/subjects unless the student "
        "clearly mixes them in the work itself):\n"
        f"- Grade / class: {g}\n"
        f"- Term: {t}\n"
        f"- Subject: {s}\n"
        f"- RAG tier: {academic_obj.get('grade_tier', '—')} | subject track: {academic_obj.get('subject_key', '—')}\n"
    )


def academic_preamble_for_pipeline(assignment_criteria: str, ctx: Optional[Dict[str, Any]]) -> str:
    """Prefix assignment criteria in the multi-step pipeline so extraction respects scope."""
    n = normalize_academic_context(ctx)
    if not any(n.values()):
        return (assignment_criteria or "").strip()
    tier = infer_grade_tier(n["grade"])
    sk = infer_subject_key(n["subject"])
    a = _academic_obj(n, tier, sk)
    scope = format_academic_scoping_for_grader(n, a)
    body = (assignment_criteria or "").strip()
    if not scope:
        return body
    if not body:
        return f"[Context]\n{scope}"
    return f"{scope}\n\n---\n\n{body}"


def apply_subject_boost(
    hits: list,
    subject_key: str,
    amount: float = 0.2,
) -> list:
    if not hits or not subject_key or subject_key in ("general", "btec_specs"):
        return hits
    sk_l = subject_key.lower()
    out = []
    for h in hits:
        sim = float(h.similarity)
        m = h.metadata or {}
        cat = str(m.get("category") or "").lower()
        ac = m.get("academic")
        s_meta = (ac or {}).get("subject_key", "") if isinstance(ac, dict) else ""
        src = str(m.get("source_file") or "")
        if s_meta == subject_key or sk_l in cat or sk_l in src.lower():
            sim = min(1.0, sim + amount)
        out.append(replace(h, similarity=sim))
    return sorted(out, key=lambda x: -x.similarity)
