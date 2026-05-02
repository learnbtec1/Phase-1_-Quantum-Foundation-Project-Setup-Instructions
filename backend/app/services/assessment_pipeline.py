# -*- coding: utf-8 -*-
"""
Multi-step BTEC assessment: chunking → extract criteria → per-criterion evidence (per chunk, mini) →
evaluate criterion (mini) → aggregate band → optional consistency review (4o).
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from app.core.config import settings
from app.services.assessment_eval_cache import (
    build_criterion_result_cache_key,
    build_full_pipeline_cache_key,
    get_tiered_result_cache,
)
from app.services.assessment_service import (
    _word_count,
    compute_btec_final_band_from_results,
    validate_evidence_quotes,
)

logger = logging.getLogger(__name__)

# ~1000 words per chunk (typical 800–1200 word band)
CHUNK_TARGET_WORDS = 1000

# Evidence after merge / rank: cap cost for evaluation; context is local to quote in student_work.
MAX_EVIDENCE_PER_CRITERION = 5
MAX_EVIDENCE_CONTEXT_CHARS = 300

SYSTEM_EXTRACT = """You extract BTEC (or similar) assessment criteria from an assignment document.
Return JSON: {"criteria": [ {"code": "P1", "description": "exact meaning from the text" }, ... ]}
Rules:
- Only criteria explicitly present. Do not invent codes.
- Use codes like P1, P2, M1, D1 (letter + number).
- If no criteria are present, return {"criteria": []}."""


SYSTEM_EVIDENCE = """You find evidence in student text for ONE assessment criterion.
Return JSON: { "evidence": [ "verbatim quotes copied from the student text in this chunk" ] }
Rules:
- Copy only exact substrings from the student text (short phrases to full sentences are ok).
- If nothing relevant, return { "evidence": [] }.
- Do not paraphrase. Surrounding context will be added by the system from the same text."""


SYSTEM_EVALUATE = """You act as a trained external verifier (Pearson-style): fair, balanced, and audit-ready. You judge ONE criterion using the supplied "Evidence with context" blocks. The Quote is always a verbatim substring from the student; the Context is a short local window from the same submission (not the whole work). Judge by academic substance and demonstrable understanding — not keyword matching, not arbitrary harshness, and not lenient marking.

## 1 — Requirement understanding
From the criterion description, infer the dominant cognitive level (one primary type):
- describe — names, lists, states what something is, basic account
- explain — understanding: reasons, how/why something works or happens
- analyse — breaks down, compares, relationships, cause–effect, links between ideas
- evaluate — judgment: weighs options or evidence, supports a conclusion, considers limitations or implications

If several verbs appear, use the HIGHEST level implied: evaluate > analyse > explain > describe. State internally what the student MUST demonstrate for this criterion at that level.

## 2 — Evidence assessment (quote + context)
For each item, use BOTH Quote and Context. Determine:
- What the student DID demonstrate (be specific, tied to the text)
- What is MISSING relative to the requirement type (gaps)

If analysis is distributed across nearby sentences, treat it as one line of reasoning when Quote and Context together show that. If evaluation is implicit but clearly supported in that window, you may accept — only when the support is visible in the evidence, not assumed. If Context contradicts the Quote or undermines the claim, do not treat that item as proof of achievement.

## 3 — Balanced decision logic
Achieved if:
- The requirement is clearly demonstrated for the inferred type
- Evidence is relevant AND sufficient (minor imperfections are acceptable if understanding is clearly there)
- You are not passing on presence alone — substance must match the command verb

Not achieved if:
- The required depth or type of thinking is missing (e.g. description or analysis only when evaluation is required)
- Evidence is too general, off-topic, or generic padding
- Key parts of what the criterion asks for are absent

Borderline (partial attempt, incomplete depth):
- Lean towards NOT achieved for the criterion as a whole, but you MUST explain clearly what is missing and what was shown — never a silent or vague fail.

## 4 — Gap detection (required in your reasoning, reflected in justification)
Your justification must make the audit trail clear: what is present vs what is missing when the outcome is not achieved, or briefly what was met when achieved.

## 5 — Justification style (single string; audit-ready)
MUST reference actual evidence; name the requirement type (e.g. analysis, evaluation); say whether depth is sufficient; list missing elements if not achieved.

GOOD example (style only):
"The student describes the concept and provides some explanation. However, the criterion requires analysis, and there is no evidence of comparison or relationships between factors. Therefore, the criterion is not achieved."

BAD: vague labels like "Not enough detail" with no link to requirement type or evidence.

## 6 — Confidence calibration
Set "confidence" 0–1 to match how strong the evidence is for your verdict: high when the evidence clearly supports the decision; medium when some ambiguity remains; low when evidence is weak, minimal, or thin (usually pair low confidence with not achieved unless the pass is unmistakable).

## 7 — Mindset
You are reviewing fairness and standards — not hunting to fail, not rubber-stamping. Do not pass on presence alone. Do not fail without a defensible explanation. Do not ignore Context.

## 8 — Consistency, determinism, and calibration (MUST follow)
Apply the same standard every time. Do not add randomness, hedging decisions, or multiple incompatible readings of the same text.

**Fixed reasoning order (internal; then output once):**
1) Identify the requirement type (cognitive level).
2) Assess evidence against that requirement (quote + context).
3) List gaps: what is present vs what is missing.
4) Decide achieved / not achieved (one coherent decision only).
5) Write the justification so it directly supports that single decision.
Avoid subjective wavering; do not offer alternative interpretations unless the evidence literally supports them.

**Self-check before you output (internal):**
- Does the justification fully support the chosen "achieved" value? Fix any mismatch.
- Is there a contradiction between evidence and the conclusion? If yes, fix the decision or the justification.
- If achieved = true: is the required depth for the type fully met? If not, set achieved = false and say what is missing.
- If achieved = false: is the missing element (or type mismatch) named clearly? If not, add it.
If you find an inconsistency, correct "achieved", justification, and/or confidence so they align.

**Strict decision ↔ justification alignment:**
- NEVER set achieved to true if the justification (as a whole) says the work is only partial, thin, or below the required level. In particular, if you would need words like: partially, somewhat, basic only, or "limited" (in the sense of insufficient scope/depth) to describe the match to the requirement, the criterion is NOT achieved — use achieved: false and describe gaps instead.
- Do not hedge: pick one defensible outcome; the justification must not read like a pass and a fail at once.

**Stability across runs (same input):** Interpret the same evidence the same way. Prefer a conservative, evidence-bound reading. If still uncertain after using quote + context, lean not achieved, but always say why. Do not invent nuance that is not in the evidence.

**Confidence bands (must align with decision):**
- 0.8–1.0: Strong, clear match between evidence and the requirement; decision is unambiguous.
- 0.5–0.79: Decision is defensible; some nuance or breadth could be debatable, but the conclusion still follows.
- Below 0.5: Weak or thin evidence; "achieved" will usually be false — if you must pass, the evidence must be unmistakable, otherwise not achieved and low confidence.

**Final output discipline:** Re-read once: decision ↔ justification, justification ↔ evidence. Output JSON only when internally consistent.

Return JSON with exactly this shape and keys (no other top-level keys):
{
  "achieved": true or false,
  "justification": "string",
  "confidence": number from 0 to 1
}

If there is no evidence or the list is empty, "achieved" must be false; give a clear justification; confidence can be high if that is unambiguous.

Rules: No inventing content beyond the evidence. No guessing beyond what Quote and Context support."""


SYSTEM_AGGREGATE = """You write a short, neutral summary of a completed criterion table for a report.
Return JSON: { "summary": "2-4 sentences" } (no new facts)."""


SYSTEM_REVIEW = """You review a table of BTEC criterion results for internal consistency. Do not change which criteria were marked achieved: only clarify wording, flag contradictions in justifications, or add a "reviewer_notes" string.
Return JSON: { "reviewer_notes": "or empty", "rationale_tweak": "optional one paragraph to append to the teacher-facing rationale; may be empty" }
Do NOT state different achieved flags than the input."""

# Auto-invalidate caches when these prompts change (no manual version strings).
_CRITERION_PATH_FINGERPRINT = hashlib.sha256(
    (SYSTEM_EVIDENCE + "\n---\n" + SYSTEM_EVALUATE).encode("utf-8")
).hexdigest()
_FULL_PIPELINE_FINGERPRINT = hashlib.sha256(
    (
        SYSTEM_EXTRACT
        + "\n---\n"
        + SYSTEM_EVIDENCE
        + "\n---\n"
        + SYSTEM_EVALUATE
        + "\n---\n"
        + SYSTEM_AGGREGATE
        + "\n---\n"
        + SYSTEM_REVIEW
    ).encode("utf-8")
).hexdigest()


def chunk_text(text: str, target_words: int = CHUNK_TARGET_WORDS) -> List[str]:
    t = (text or "").replace("\0", " ").strip()
    if not t:
        return []
    words = t.split()
    if not words:
        return []
    if len(words) <= target_words:
        return [t]
    return [
        " ".join(words[i : i + target_words])
        for i in range(0, len(words), target_words)
        if words[i : i + target_words]
    ]


def _surrounding_context(quote: str, text: str, max_chars: int = MAX_EVIDENCE_CONTEXT_CHARS) -> str:
    """1–2 neighbouring sentences around the quote; cap length. Text is a chunk or full student work."""
    sw = (text or "").replace("\0", " ")
    q = (quote or "").strip()
    if not q or not sw:
        return ""
    lo, lq = sw.lower(), q.lower()
    idx = lo.find(lq)
    if idx < 0:
        return ""
    before, after = sw[:idx], sw[idx + len(q) :]
    b_parts = re.split(r"(?<=[.!?])\s+", before.strip()) if before.strip() else []
    a_parts = re.split(r"(?<=[.!?])\s+", after.strip()) if after.strip() else []
    b_prev = b_parts[-2:] if len(b_parts) > 1 else b_parts[-1:]
    a_next = a_parts[:2] if a_parts and a_parts[0] else []
    window = " ".join(b_prev).strip() + " " + q + " " + " ".join(a_next).strip()
    window = re.sub(r"\s+", " ", window).strip()
    if not window or len(window) <= max_chars:
        return window[:max_chars]
    # Trim centre on quote: keep start of window and end, preserve quote
    if len(q) + 20 >= max_chars:
        return (q + " " + " ".join(a_next))[:max_chars] if a_next else q[:max_chars]
    remain = max_chars - len(q) - 1
    left = min(len(" ".join(b_prev)), remain // 2) if b_prev else 0
    right = remain - left
    left_bits = " ".join(b_prev)[-left:] if left and b_prev else ""
    right_bits = " ".join(a_next)[:right] if a_next and right else ""
    out = (left_bits + " " + q + " " + right_bits).strip()
    if len(out) > max_chars:
        out = out[: max_chars - 1].rstrip() + "…"
    return out


def _cosine_vec(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _embed_rank_evidence(
    criterion: Dict[str, str], items: List[Dict[str, str]], top_k: int
) -> List[Dict[str, str]]:
    """Keep top_k items by embedding similarity to criterion (no extra chat.completions)."""
    if not items or top_k <= 0:
        return []
    if len(items) <= top_k:
        return list(items)
    try:
        client = _client()
        model = settings.resolved_openai_embedding_model()
        q_text = f"{criterion.get('code', '')}: {criterion.get('description', '')}".strip() or "criterion"
        docs = [f"{it.get('quote', '')}\n{it.get('context', '')}" for it in items]
        resp = client.embeddings.create(
            model=model,
            input=[q_text] + docs,
        )
        data_sorted = sorted(resp.data, key=lambda d: d.index)
        embs: List[List[float]] = [list(d.embedding) for d in data_sorted]
        qe, doc_embs = embs[0], embs[1:]
        scored: List[Tuple[float, int]] = [
            (_cosine_vec(qe, doc_embs[i]), i) for i in range(len(doc_embs))
        ]
        scored.sort(key=lambda t: t[0], reverse=True)
        return [items[i] for _, i in scored[:top_k]]
    except Exception as e:
        logger.warning("evidence rank embedding failed, using first %s items: %s", top_k, e)
        return items[:top_k]


def _collect_ranked_evidence(
    criterion: Dict[str, str], chunks: List[str], student_work: str
) -> List[Dict[str, str]]:
    """
    Per-chunk quotes → {quote, context} → validate quotes against full work →
    recompute context from full submission → dedupe → embed-rank to max 5.
    """
    sw = (student_work or "").replace("\0", " ").strip()
    merged: List[Dict[str, str]] = []
    for ch in chunks:
        merged.extend(extract_evidence_for_chunk(criterion, ch))
    seen: set[str] = set()
    by_quote: List[Dict[str, str]] = []
    for it in merged:
        rq = (it.get("quote") or "").strip()
        if not rq:
            continue
        k = rq.lower()[:2000]
        if k in seen:
            continue
        seen.add(k)
        by_quote.append(it)
    validated: List[Dict[str, str]] = []
    for it in by_quote:
        q = (it.get("quote") or "").strip()
        vq = validate_evidence_quotes([q], sw)
        if not vq:
            continue
        v = vq[0]
        ctx = _surrounding_context(v, sw, MAX_EVIDENCE_CONTEXT_CHARS)
        validated.append({"quote": v, "context": ctx})
    seen2: set[str] = set()
    unique: List[Dict[str, str]] = []
    for it in validated:
        k = (it.get("quote") or "").lower()[:2000]
        if k in seen2:
            continue
        seen2.add(k)
        unique.append(it)
    return _embed_rank_evidence(criterion, unique, MAX_EVIDENCE_PER_CRITERION)


def _client() -> OpenAI:
    settings.require_openai()
    return OpenAI(api_key=settings.OPENAI_API_KEY)


def _mini_model() -> str:
    return settings.resolved_openai_assessment_model()


def _review_model() -> str:
    return settings.resolved_openai_chat_model()


def _academic_context_fingerprint(ctx: Optional[Dict[str, Any]]) -> str:
    if not ctx:
        return ""
    from app.services.academic_rag_context import normalize_academic_context

    n = normalize_academic_context(ctx)
    if not any(n.values()):
        return ""
    return json.dumps(n, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _build_eval_cache_key(
    student_work: str,
    assignment_criteria: str,
    criterion: Dict[str, str],
    btec_unit: str = "",
    academic_context: Optional[Dict[str, Any]] = None,
) -> str:
    """SHA-256 key for per-criterion pipeline result replay (see assessment_eval_cache)."""
    s = settings
    max_c = max(1, int(getattr(s, "ASSESSMENT_PIPELINE_MAX_CHUNKS", 50) or 50))
    return build_criterion_result_cache_key(
        student_work=student_work,
        assignment_criteria=assignment_criteria or "",
        criterion=criterion,
        btec_unit=btec_unit or "",
        assessment_model=_mini_model(),
        max_pipeline_chunks=max_c,
        criterion_path_fingerprint=_CRITERION_PATH_FINGERPRINT,
        academic_context_json=_academic_context_fingerprint(academic_context),
    )


def _build_full_grading_cache_key(
    sw: str,
    ac: str,
    btec_unit: str,
    min_w: int,
    max_c: int,
    enable_final_review: bool,
    academic_context: Optional[Dict[str, Any]] = None,
) -> str:
    return build_full_pipeline_cache_key(
        student_work=sw,
        assignment_criteria=ac or "",
        btec_unit=btec_unit,
        assessment_model=_mini_model(),
        max_pipeline_chunks=max_c,
        min_words=min_w,
        enable_final_review=enable_final_review,
        pipeline_llm_fingerprint=_FULL_PIPELINE_FINGERPRINT,
        chat_model=_review_model(),
        embedding_model=settings.resolved_openai_embedding_model(),
        academic_context_json=_academic_context_fingerprint(academic_context),
    )


def extract_criteria(assignment_context: str) -> Tuple[List[Dict[str, str]], bool]:
    """LLM: criteria list; also criteria_undetected if empty and text had little structure."""
    ac = (assignment_context or "").strip()
    if not ac:
        return [], True
    client = _client()
    try:
        resp = client.chat.completions.create(
            model=_mini_model(),
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_EXTRACT},
                {"role": "user", "content": f"Assignment / criteria text:\n\n{ac[:24000]}\n\nRespond with JSON only."},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = json.loads(raw)
    except Exception as e:
        logger.exception("extract_criteria failed: %s", e)
        return [], True
    cr = out.get("criteria")
    if not isinstance(cr, list):
        return [], True
    result: List[Dict[str, str]] = []
    for x in cr:
        if not isinstance(x, dict):
            continue
        code = str(x.get("code") or "").strip()
        if not code:
            continue
        result.append(
            {
                "code": code,
                "description": str(x.get("description") or "").strip() or "—",
            }
        )
    # Dedupe by code
    seen = set()
    dedup: List[Dict[str, str]] = []
    for c in result:
        k = c["code"].upper()
        if k in seen:
            continue
        seen.add(k)
        dedup.append(c)
    undetected = len(dedup) == 0
    return dedup, undetected


def extract_evidence_for_chunk(
    criterion: Dict[str, str],
    chunk: str,
) -> List[Dict[str, str]]:
    """
    Return verbatim quotes with local context from the chunk. Quotes are validated later against full work.
    Shape: { "quote": "...", "context": "..." } — context is not paraphrased; built from the chunk.
    """
    client = _client()
    ch = (chunk or "").replace("\0", " ")
    spec = f"Criterion {criterion.get('code', '')}:\n{criterion.get('description', '')}\n"
    try:
        resp = client.chat.completions.create(
            model=_mini_model(),
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_EVIDENCE},
                {
                    "role": "user",
                    "content": f"{spec}\n--- student text (chunk) ---\n{ch}\n--- end ---\n\nJSON only.",
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = json.loads(raw)
    except Exception as e:
        logger.warning("evidence chunk failed: %s", e)
        return []
    ev = out.get("evidence")
    if not isinstance(ev, list):
        return []
    out_items: List[Dict[str, str]] = []
    for x in ev:
        if isinstance(x, dict):
            q = str(x.get("quote") or "").strip()
        else:
            q = str(x).strip()
        if not q:
            continue
        ctx = _surrounding_context(q, ch, MAX_EVIDENCE_CONTEXT_CHARS)
        out_items.append({"quote": q, "context": ctx})
    return out_items


def _align_achieved_with_justification(
    achieved: bool, justification: str, confidence: float
) -> Tuple[bool, str, float]:
    """
    Hard alignment: a pass must not be justified with language that signals insufficient depth.
    Reduces spurious pass/fail mismatch when the model hedges in text but sets achieved true.
    """
    j = (justification or "").strip()
    c = max(0.0, min(1.0, float(confidence) if isinstance(confidence, (int, float)) else 0.0))
    if not achieved:
        return False, j, c
    jl = f" {j.lower()} "
    weak = (
        " partially " in jl
        or " somewhat " in jl
        or "basic only" in j.lower()
    )
    if not weak and re.search(r"(?<![A-Za-z0-9-])limited(?![A-Za-z0-9-])", j, re.IGNORECASE):
        if "not limited" not in j.lower():
            weak = True
    if not weak:
        return True, j, c
    return False, j, min(c, 0.45)


def evaluate_criterion(
    criterion: Dict[str, str],
    evidence_with_context: List[Dict[str, str]],
) -> Dict[str, Any]:
    client = _client()
    spec = f"Code: {criterion.get('code', '')}\nDescription: {criterion.get('description', '')}\n"
    if evidence_with_context:
        parts: List[str] = []
        for n, it in enumerate(evidence_with_context, 1):
            q = (it.get("quote") or "").replace("\n", " ").strip()
            c = (it.get("context") or "").replace("\n", " ").strip()
            parts.append(
                f"Item {n} — Evidence with context:\n"
                f'Quote: "{q}"\n'
                f"Context: {c if c else '(no local context window)'}\n"
            )
        ev_block = "\n".join(parts)
    else:
        ev_block = "(no evidence items — empty list)"
    try:
        resp = client.chat.completions.create(
            model=_mini_model(),
            temperature=0,
            top_p=1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_EVALUATE},
                {
                    "role": "user",
                    "content": (
                        f"{spec}The quote is an exact student substring. The context is a short local window from the "
                        f"same submission (max ~{MAX_EVIDENCE_CONTEXT_CHARS} characters), not a full chunk of the work.\n\n"
                        f"{ev_block}\n"
                        "As an external verifier: follow the fixed reasoning order in the system instructions → run the "
                        "internal self-check → then output one JSON object: achieved, justification (fully aligned, "
                        "no contradiction), confidence (in the defined bands), as specified."
                    ),
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = json.loads(raw)
    except Exception as e:
        logger.exception("evaluate_criterion failed: %s", e)
        return {
            "achieved": False,
            "justification": "Evaluation could not be completed for this criterion.",
            "confidence": 0.0,
        }
    ach = bool(out.get("achieved"))
    just = str(out.get("justification") or "No justification.").strip()
    conf = float(out.get("confidence") or 0.0) if isinstance(out.get("confidence"), (int, float)) else 0.0
    ach, just, conf = _align_achieved_with_justification(ach, just, conf)
    return {
        "achieved": ach,
        "justification": just,
        "confidence": conf,
    }


def aggregate_criterion_results(
    criteria_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Deterministic final band from achieved flags; optional short LLM summary."""
    if not criteria_results:
        return {
            "grade_band": "Not yet achieved",
            "summary": "No criteria were evaluated.",
        }
    band = compute_btec_final_band_from_results(criteria_results)
    client = _client()
    try:
        resp = client.chat.completions.create(
            model=_mini_model(),
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_AGGREGATE},
                {
                    "role": "user",
                    "content": "Criterion outcomes:\n"
                    + json.dumps(criteria_results, ensure_ascii=False)[:12000]
                    + f"\nFinal band: {band}",
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = json.loads(raw)
        summary = str(out.get("summary") or "").strip() or f"Overall outcome: {band}."
    except Exception:
        summary = f"Overall outcome: {band}."
    return {"grade_band": band, "summary": summary}


def run_final_review(
    criteria_results: List[Dict[str, Any]],
    aggregate_summary: str,
) -> Dict[str, str]:
    client = _client()
    try:
        resp = client.chat.completions.create(
            model=_review_model(),
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_REVIEW},
                {
                    "role": "user",
                    "content": "Results:\n"
                    + json.dumps(criteria_results, ensure_ascii=False)[:16000]
                    + f"\nSummary: {aggregate_summary}\n",
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = json.loads(raw)
        return {
            "reviewer_notes": str(out.get("reviewer_notes") or "").strip(),
            "rationale_tweak": str(out.get("rationale_tweak") or "").strip(),
        }
    except Exception as e:
        logger.warning("final review failed: %s", e)
        return {"reviewer_notes": "", "rationale_tweak": ""}


def run_single_criterion_evaluation(
    student_work: str,
    criterion: Dict[str, str],
) -> Dict[str, Any]:
    """Run chunk → evidence (all chunks) → evaluate for one criterion (used by /evaluate-criterion)."""
    from app.core.config import settings as s

    code = str(criterion.get("code") or "—").strip()
    sw = (student_work or "").strip()
    if not sw or _word_count(sw) < 5:
        return {
            "code": code,
            "achieved": False,
            "justification": "No student text to assess.",
            "evidence": [],
            "confidence": 0.0,
            "chunk_count": 0,
        }
    try:
        max_chunks = max(1, int(getattr(s, "ASSESSMENT_PIPELINE_MAX_CHUNKS", 50) or 50))
    except (TypeError, ValueError):
        max_chunks = 50

    result_cache = get_tiered_result_cache()
    cache_key = _build_eval_cache_key(sw, "", criterion, "", None) if result_cache else None
    if result_cache and cache_key:
        cached = result_cache.get(cache_key)
        if cached is not None:
            return cached

    chunks = chunk_text(sw)[:max_chunks]
    ranked = _collect_ranked_evidence(criterion, chunks, sw)
    ev_res = evaluate_criterion(criterion, ranked)
    if ev_res.get("achieved") and not ranked:
        ev_res["achieved"] = False
        j = str(ev_res.get("justification") or "")
        ev_res["justification"] = j + " (Strict: no matching verbatim evidence in submission.)"
    out: Dict[str, Any] = {
        "code": code,
        "achieved": bool(ev_res.get("achieved")),
        "justification": str(ev_res.get("justification") or ""),
        "evidence": ranked,
        "confidence": float(ev_res.get("confidence", 0.0) or 0.0),
        "chunk_count": len(chunks),
    }
    if result_cache and cache_key:
        result_cache.set(cache_key, out)
    return out


def _short_pipeline_payload(min_words: int) -> Dict[str, Any]:
    return {
        "error": f"Submissions under {min_words} words are not run through the multi-step pipeline.",
        "grade_band": "Not yet achieved",
        "rationale": f"Response too short (minimum {min_words} words).",
        "criteria_extracted": [],
        "criteria_results": [],
        "criteria_undetected": True,
        "pipeline": {"chunk_count": 0, "stages": ["rejected_too_short"]},
    }


def run_full_grading_pipeline(
    *,
    btec_unit: str,
    student_work: str,
    assignment_criteria: str,
    enable_final_review: bool = False,
    academic_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    End-to-end: chunk → extract criteria → per-chunk evidence → evaluate per criterion → aggregate → optional review.
    """
    from app.core.config import settings as s
    from app.services.academic_rag_context import (
        academic_preamble_for_pipeline,
        normalize_academic_context,
    )

    min_w = int(getattr(s, "ASSESSMENT_MIN_WORDS", 150) or 150)
    sw = (student_work or "").strip()
    if _word_count(sw) < min_w:
        return {**_short_pipeline_payload(min_w), "btec_unit": btec_unit}

    try:
        max_chunks = max(1, int(getattr(s, "ASSESSMENT_PIPELINE_MAX_CHUNKS", 50) or 50))
    except (TypeError, ValueError):
        max_chunks = 50

    chunks = chunk_text(sw)[:max_chunks]
    if not chunks:
        return {**_short_pipeline_payload(min_w), "btec_unit": btec_unit}

    ac_raw = (assignment_criteria or "").strip()
    ac_for_extract = academic_preamble_for_pipeline(ac_raw, academic_context)
    ac_norm = normalize_academic_context(academic_context)

    result_cache = get_tiered_result_cache()
    full_key = (
        _build_full_grading_cache_key(
            sw, ac_raw, btec_unit, min_w, max_chunks, enable_final_review, academic_context
        )
        if result_cache
        else None
    )
    if result_cache and full_key:
        cached_out = result_cache.get(full_key)
        if cached_out is not None:
            out = copy.deepcopy(cached_out)
            p = out.setdefault("pipeline", {})
            p["full_pipeline_cache_hit"] = True
            cmeta = p.setdefault("criterion_result_cache", {})
            cmeta["skipped_due_to_full_cache"] = True
            cmeta["l2_redis"] = result_cache.redis_reachable
            cmeta["enabled"] = True
            return out

    crit, undetected = extract_criteria(ac_for_extract)
    if not crit:
        return {
            "btec_unit": btec_unit,
            "error": None,
            "grade_band": "Not yet achieved",
            "rationale": "No assessable criteria were extracted from the assignment text. Add explicit P/M/D (or similar) lines.",
            "criteria_extracted": [],
            "criteria_results": [],
            "criteria_undetected": True,
            "strengths": [],
            "improvements": ["Provide clear P/M/D style criteria in the brief."],
            "cited_sources": [],
            "assignment_context": {
                "scenario": "",
                "task": "",
                "expected_outcomes": "",
                "criteria_summary": ac_raw[:2000],
                "academic": ac_norm or None,
            },
            "retrieval": {"chunks_used": 0, "sources": []},
            "pipeline": {
                "chunk_count": len(chunks),
                "stages": ["chunking", "extract_criteria_empty"],
            },
        }

    criteria_results: List[Dict[str, Any]] = []
    cache_hits = 0
    cache_misses = 0
    for c in crit:
        ck = _build_eval_cache_key(sw, ac_raw, c, btec_unit, academic_context) if result_cache else None
        if result_cache and ck:
            cached_row = result_cache.get(ck)
            if cached_row is not None:
                criteria_results.append(cached_row)
                cache_hits += 1
                continue
            cache_misses += 1

        ranked = _collect_ranked_evidence(c, chunks, sw)
        ev_res = evaluate_criterion(c, ranked)
        if ev_res.get("achieved") and not ranked:
            ev_res["achieved"] = False
            j = str(ev_res.get("justification") or "")
            ev_res["justification"] = j + " (Strict mode: no verbatim evidence in student work.)"
        row = {
            "code": c["code"],
            "achieved": bool(ev_res.get("achieved")),
            "justification": ev_res.get("justification", ""),
            "evidence": ranked,
            "confidence": ev_res.get("confidence", 0.0),
        }
        if result_cache and ck:
            result_cache.set(ck, row)
        criteria_results.append(row)

    agg = aggregate_criterion_results(criteria_results)
    band = agg["grade_band"]
    summary = agg["summary"]
    review_notes = ""
    rationale_tweak = ""
    if enable_final_review:
        extra = run_final_review(criteria_results, summary)
        review_notes = extra.get("reviewer_notes", "")
        rationale_tweak = extra.get("rationale_tweak", "")

    rationale = summary
    if rationale_tweak:
        rationale = (rationale + "\n\n" + rationale_tweak).strip()

    out: Dict[str, Any] = {
        "btec_unit": btec_unit,
        "error": None,
        "grade_band": band,
        "rationale": rationale,
        "strengths": [],
        "improvements": [],
        "cited_sources": [],
        "assignment_context": {
            "scenario": "",
            "task": "",
            "expected_outcomes": "",
            "criteria_summary": ac_raw[:2000],
            "academic": ac_norm or None,
        },
        "criteria_extracted": crit,
        "criteria_results": criteria_results,
        "criteria_undetected": undetected,
        "retrieval": {
            "chunks_used": len(chunks) * len(crit),
            "sources": [f"pipeline:chunks={len(chunks)}"],
        },
        "pipeline": {
            "mode": "multi_step",
            "chunk_count": len(chunks),
            "criterion_count": len(crit),
            "evidence_calls": len(chunks) * len(crit),
            "full_pipeline_cache_hit": False,
            "prompt_fingerprint_criterion": _CRITERION_PATH_FINGERPRINT[:16],
            "prompt_fingerprint_full": _FULL_PIPELINE_FINGERPRINT[:16],
            "criterion_result_cache": {
                "enabled": result_cache is not None,
                "l2_redis": result_cache.redis_reachable if result_cache else False,
                "hits": cache_hits,
                "misses": cache_misses,
                "skipped_due_to_full_cache": False,
            },
            "academic_context": ac_norm or None,
            "stages": ["chunking", "extract_criteria", "evidence_per_chunk", "evaluate", "aggregate"]
            + (["final_review"] if enable_final_review else []),
        },
    }
    if review_notes:
        out["reviewer_notes"] = review_notes
    if result_cache and full_key:
        to_store = copy.deepcopy(out)
        to_store.setdefault("pipeline", {})["full_pipeline_cache_hit"] = False
        result_cache.set(full_key, to_store)
    return out
