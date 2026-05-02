# -*- coding: utf-8 -*-
"""
Multi-signal integrity scoring (evidence-based, not a single "AI %").

- Semantic: cosine similarity (0–1).
- N-gram: balanced Jaccard-style overlap on word n-grams (symmetric, not query-only).
- Citation: heuristic on submission text, with **inflation dampening** when high cit + very high sim.
- Dynamic weights: n-gram-heavy when literal overlap is strong.
- AI: optional prior; can bump to *review* when high AI + low match to corpus.
- N-gram: optional length calibration to damp spikes on very short windows.

API consumers: read `INTEGRITY_VERSION` / `integrity_version` in responses.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

INTEGRITY_VERSION = "v1.1"

W_DEFAULT = (0.45, 0.25, 0.15, 0.10, 0.05)  # sem, ngram, ai, cit, beh
W_LITERAL = (0.35, 0.40, 0.15, 0.10, 0.0)  # ngram dominates

_TOKEN_RE = re.compile(r"[\u0600-\u06FFA-Za-z0-9'’._-]+", re.UNICODE)

# Stable reason codes for UI / audit (not end-user sentences)
R_STRONG_LITERAL_PAIR = "strong_literal_and_semantic"
R_VERY_STRONG_NGRAM = "very_strong_ngram_overlap"
R_HIGH_COMPOSITE_WEAK_CIT = "high_composite_weak_citation"
R_ELEVATED_PAIR = "elevated_semantic_ngram"
R_ELEVATED_COMPOSITE = "elevated_composite"
R_VERY_HIGH_SEMANTIC = "very_high_semantic_similarity"
R_AI_SUSPECT_DIVERGENT = "ai_suspect_divergent_corpus"
R_LOW = "low_concern"
# Decorative refs + very high sim — surfaced when damping applies
R_CITATION_INFLATION = "citation_inflation_detected"

# Lower = first in UI/audit (highest action priority).
REASON_PRIORITY: Dict[str, int] = {
    R_STRONG_LITERAL_PAIR: 1,
    R_VERY_STRONG_NGRAM: 2,
    "high_ngram_overlap": 2,  # alias
    "low_citation_signal": 3,  # alias
    R_HIGH_COMPOSITE_WEAK_CIT: 3,
    R_CITATION_INFLATION: 4,
    R_ELEVATED_PAIR: 5,
    R_ELEVATED_COMPOSITE: 6,
    R_VERY_HIGH_SEMANTIC: 7,
    R_AI_SUSPECT_DIVERGENT: 8,
    R_LOW: 90,
}

_CIT_PATTERNS: List[Tuple[str, float, int]] = [
    (r"\[[0-9]{1,3}\]", 0.18, 0),
    (r"\([12][0-9]{3}\)", 0.12, 0),
    (r"\bdoi\b|doi\.org|10\.\d{4,}/", 0.2, re.I),
    (r"https?://|www\.", 0.15, re.I),
    (r"\bet\s+al\b|وآخرون", 0.12, re.I),
    (r"المراجع|references|bibliograph", 0.12, re.I),
    (r"«[^»]+»|\"[^\"]{12,}\"", 0.1, 0),
]


def tokenize_words(text: str) -> List[str]:
    t = (text or "").strip()
    if not t:
        return []
    return [m.group(0).lower() for m in _TOKEN_RE.finditer(t)]


def _word_ngram_set(words: List[str], n: int) -> Set[Tuple[str, ...]]:
    if n < 2 or len(words) < n:
        return set()
    return {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}


def ngram_containment_score(query: str, candidate: str, n: int = 5) -> float:
    """
    Balanced n-gram overlap: max(inter/|A|, inter/|B|) for word n-gram sets.
    Does not over-penalize short text or inflate on very long A vs long B.
    """
    wq, wc = tokenize_words(query), tokenize_words(candidate)
    A = _word_ngram_set(wq, n)
    B = _word_ngram_set(wc, n)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    return min(1.0, max(inter / max(1, len(A)), inter / max(1, len(B))))


def calibrated_ngram_score(query: str, candidate: str, n: int = 5) -> float:
    """
    max containment, then scale by n-gram vocabulary size to reduce spikes on very short windows.
    """
    base = ngram_containment_score(query, candidate, n)
    wq, wc = tokenize_words(query), tokenize_words(candidate)
    a = _word_ngram_set(wq, n)
    b = _word_ngram_set(wc, n)
    if not a or not b:
        return 0.0
    scale = min(1.0, max(len(a), len(b)) / 50.0)
    return min(1.0, base * scale)


def _sort_risk_reasons(reasons: List[str]) -> List[str]:
    u: List[str] = []
    seen: Set[str] = set()
    first_pos: Dict[str, int] = {}
    for i, r in enumerate(reasons):
        if r and r not in seen:
            seen.add(r)
            u.append(r)
            first_pos[r] = i
    return sorted(u, key=lambda r: (REASON_PRIORITY.get(r, 50), first_pos.get(r, 0)))


def _adjust_citation_inflation(
    raw_citation: float,
    semantic_similarity: float,
) -> Tuple[float, bool]:
    """
    Dampen citation if it likely co-occurs with *decorative* references + near-copy semantics.
    """
    c = max(0.0, min(1.0, float(raw_citation)))
    sem = max(0.0, min(1.0, float(semantic_similarity)))
    if c > 0.7 and sem > 0.9:
        return c * 0.7, True
    return c, False


@dataclass
class CompositeComponents:
    semantic_similarity: float
    ngram_overlap: float
    ai_signal: Optional[float]
    citation_signal: float
    behavioral_signal: Optional[float]
    ai_effective: float
    behavioral_effective: float
    citation_inflation_damped: bool
    weight_profile: str  # "default" | "literal_focus" | "learned" | "custom"
    weights_used: Dict[str, float]  # echo for explainability


@dataclass
class CopiedEvidence:
    text: str
    length: int
    confidence: float
    source_id: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "length": self.length,
            "confidence": self.confidence,
            "source_id": self.source_id,
        }


@dataclass
class HitIntegrity:
    final_score: float
    risk_band: str
    components: CompositeComponents
    risk_reasons: List[str] = field(default_factory=list)
    copied_evidence: List[CopiedEvidence] = field(default_factory=list)


def _resolve_weights(ngram_overlap: float) -> Tuple[Tuple[float, float, float, float, float], str]:
    if ngram_overlap > 0.6:
        return W_LITERAL, "literal_focus"
    return W_DEFAULT, "default"


def compute_composite(
    semantic_similarity: float,
    ngram_overlap: float,
    *,
    citation_signal: float,
    ai_signal: Optional[float] = None,
    behavioral_signal: Optional[float] = None,
    weight_pack: Optional[Tuple[float, float, float, float, float]] = None,
    weight_profile: Optional[str] = None,
) -> Tuple[float, CompositeComponents]:
    a_eff = 0.5 if ai_signal is None else max(0.0, min(1.0, float(ai_signal)))
    b_eff = 0.5 if behavioral_signal is None else max(0.0, min(1.0, float(behavioral_signal)))
    sem = max(0.0, min(1.0, float(semantic_similarity)))
    ng = max(0.0, min(1.0, float(ngram_overlap)))
    cit, damped = _adjust_citation_inflation(citation_signal, sem)
    cit = max(0.0, min(1.0, cit))
    if weight_pack is not None:
        w_pack = weight_pack
        w_profile = weight_profile or "custom"
    else:
        w_pack, w_profile = _resolve_weights(ng)
    ws, wn, wa, wc, wb = w_pack
    weights_used: Dict[str, float] = {
        "semantic": float(ws),
        "ngram": float(wn),
        "ai": float(wa),
        "citation": float(wc),
        "behavioral": float(wb),
    }
    final = (
        ws * sem
        + wn * ng
        + wa * a_eff
        + wc * cit
        + wb * b_eff
    )
    comp = CompositeComponents(
        semantic_similarity=sem,
        ngram_overlap=ng,
        ai_signal=ai_signal,
        citation_signal=cit,
        behavioral_signal=behavioral_signal,
        ai_effective=a_eff,
        behavioral_effective=b_eff,
        citation_inflation_damped=damped,
        weight_profile=w_profile,
        weights_used=weights_used,
    )
    return min(1.0, final), comp


def _compute_risk_with_reasons(
    semantic: float,
    ngram: float,
    final: float,
    *,
    citation_signal: float,
) -> Tuple[str, List[str]]:
    """
    Return band + ordered reason codes. Heuristic triage, not a legal finding.
    """
    sem = max(0.0, min(1.0, semantic))
    ng = max(0.0, min(1.0, ngram))
    fin = max(0.0, min(1.0, final))
    weak_cit = citation_signal < 0.25

    is_high = (
        (sem >= 0.92 and ng >= 0.40)
        or (sem >= 0.88 and ng >= 0.55)
        or (fin >= 0.82 and weak_cit and sem >= 0.78)
    )
    if is_high:
        reasons: List[str] = []
        if sem >= 0.92 and ng >= 0.40:
            reasons.append(R_STRONG_LITERAL_PAIR)
        if sem >= 0.88 and ng >= 0.55:
            reasons.append(R_VERY_STRONG_NGRAM)
        if fin >= 0.82 and weak_cit and sem >= 0.78:
            reasons.append(R_HIGH_COMPOSITE_WEAK_CIT)
        u = list(dict.fromkeys([r for r in reasons if r])) or [R_STRONG_LITERAL_PAIR]
        return "high_risk", u[:6]

    if (sem >= 0.85 and ng >= 0.28) or fin >= 0.58 or (sem >= 0.90):
        r2: List[str] = []
        if sem >= 0.85 and ng >= 0.28:
            r2.append(R_ELEVATED_PAIR)
        if fin >= 0.58:
            r2.append(R_ELEVATED_COMPOSITE)
        if sem >= 0.90:
            r2.append(R_VERY_HIGH_SEMANTIC)
        if not r2:
            r2.append(R_ELEVATED_COMPOSITE)
        return "review", list(dict.fromkeys(r2))[:6]

    return "low", [R_LOW]


def _apply_ai_divergent_review(
    band: str,
    reasons: List[str],
    *,
    ngram: float,
    semantic: float,
    ai_signal: Optional[float],
    citation_raw: float,
) -> Tuple[str, List[str]]:
    """
    High AI + low corpus match + weak surface citations: suspected model text, not library copy.
    Skips when submission already shows strong citation-like patterns (reduces false positives).
    """
    if ai_signal is None or not (float(ai_signal) > 0.8):
        return band, reasons
    if not (ngram < 0.2 and semantic < 0.6):
        return band, reasons
    if citation_raw >= 0.5:
        return band, reasons
    if band == "high_risk":
        return band, reasons
    out = list(reasons)
    if R_AI_SUSPECT_DIVERGENT not in out:
        out = [R_AI_SUSPECT_DIVERGENT] + [x for x in out if x != R_LOW]
    if band == "low":
        return "review", (out or [R_AI_SUSPECT_DIVERGENT])[:6]
    return "review", list(dict.fromkeys(out))[:6]


def _evidence_for_phrase(
    phrase: str,
    *,
    ngram_overlap: float,
    semantic_similarity: float,
    source_id: str,
) -> CopiedEvidence:
    text = (phrase or "").strip()
    conf = min(
        0.99,
        0.72
        + 0.20 * ngram_overlap
        + 0.06 * min(1.0, len(text) / 120.0)
        + 0.02 * semantic_similarity,
    )
    return CopiedEvidence(
        text=text,
        length=len(text),
        confidence=round(conf, 2),
        source_id=source_id,
    )


def build_copied_evidence(
    query: str,
    candidate: str,
    *,
    n: int,
    ngram_overlap: float,
    semantic_similarity: float,
    chunk_id: int,
    source_id: Optional[str],
    max_items: int = 5,
) -> List[CopiedEvidence]:
    wq, wc = tokenize_words(query), tokenize_words(candidate)
    nq, nc = _word_ngram_set(wq, n), _word_ngram_set(wc, n)
    if not nq or not nc:
        return []
    key = f"chunk_{chunk_id}"
    if source_id:
        key = f"{key}:{str(source_id)[:80]}"
    found: List[Tuple[str, int]] = []
    for g in nq:
        if g in nc:
            joined = " ".join(g)
            found.append((joined, len(g)))
    found.sort(key=lambda x: -x[1])
    out: List[CopiedEvidence] = []
    seen: Set[str] = set()
    for phrase, _w in found:
        if phrase in seen:
            continue
        seen.add(phrase)
        ev = _evidence_for_phrase(
            phrase,
            ngram_overlap=ngram_overlap,
            semantic_similarity=semantic_similarity,
            source_id=key,
        )
        if ev.confidence < 0.6 or ev.length < 6:
            continue
        out.append(ev)
        if len(out) >= max_items:
            break
    return out


def build_hit_integrity(
    query: str,
    hit_content: str,
    semantic_similarity: float,
    *,
    ngram_n: int = 5,
    ai_signal: Optional[float] = None,
    behavioral_signal: Optional[float] = None,
    chunk_id: int = 0,
    source_row_id: Optional[str] = None,
) -> HitIntegrity:
    from app.services.integrity_learning import get_effective_composite_weights

    raw_cit = citation_alignment_heuristic(query)
    ng = calibrated_ngram_score(query, hit_content, n=ngram_n)
    w_pack, w_prof = get_effective_composite_weights(ng)
    # Composite: raw semantic + damped citation; weights from rules or optional learned config
    final, comp = compute_composite(
        semantic_similarity,
        ng,
        citation_signal=raw_cit,
        ai_signal=ai_signal,
        behavioral_signal=behavioral_signal,
        weight_pack=w_pack,
        weight_profile=w_prof,
    )
    # Slight nudge if high sim + anemic visible citations (before damp would already have bitten on fake refs)
    if comp.citation_signal < 0.2 and comp.semantic_similarity >= 0.8:
        final_adj = min(1.0, final + 0.03)
    else:
        final_adj = final
    # Risk uses the **damped** citation in components
    band, reasons = _compute_risk_with_reasons(
        comp.semantic_similarity,
        comp.ngram_overlap,
        final_adj,
        citation_signal=comp.citation_signal,
    )
    if comp.citation_inflation_damped:
        reasons.append(R_CITATION_INFLATION)
    band, reasons = _apply_ai_divergent_review(
        band,
        reasons,
        ngram=ng,
        semantic=semantic_similarity,
        ai_signal=ai_signal,
        citation_raw=raw_cit,
    )
    reasons = _sort_risk_reasons(reasons)
    ev = build_copied_evidence(
        query,
        hit_content,
        n=ngram_n,
        ngram_overlap=ng,
        semantic_similarity=semantic_similarity,
        chunk_id=chunk_id,
        source_id=source_row_id,
    )
    return HitIntegrity(
        final_score=final_adj,
        risk_band=band,
        components=comp,
        risk_reasons=reasons,
        copied_evidence=ev,
    )


def citation_alignment_heuristic(text: str) -> float:
    s = 0.0
    t = text or ""
    for pat, w, flags in _CIT_PATTERNS:
        if re.search(pat, t, flags):
            s += w
    return min(1.0, s)


def build_query_integrity_summary(hits: List[HitIntegrity]) -> Dict[str, Any]:
    if not hits:
        zc = {"low": 0, "review": 0, "high_risk": 0}
        zp = {"low": 0.0, "review": 0.0, "high_risk": 0.0}
        return {
            "max_final_score": 0.0,
            "max_risk_band": "low",
            "has_any_high_risk": False,
            "distribution": {"counts": zc, "percent": zp},
        }
    best = max(hits, key=lambda h: h.final_score)
    high = any(h.risk_band == "high_risk" for h in hits)
    dist: Dict[str, int] = {"low": 0, "review": 0, "high_risk": 0}
    for h in hits:
        b = h.risk_band
        if b in dist:
            dist[b] += 1
    total = max(1, len(hits))
    perc = {k: round(float(dist[k]) / float(total), 4) for k in dist}
    return {
        "max_final_score": round(best.final_score, 4),
        "max_risk_band": best.risk_band,
        "has_any_high_risk": high,
        "distribution": {"counts": dict(dist), "percent": perc},
    }
