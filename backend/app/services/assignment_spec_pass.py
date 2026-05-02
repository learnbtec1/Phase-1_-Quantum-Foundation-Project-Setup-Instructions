# -*- coding: utf-8 -*-
"""
PASS 0: Understand the *assignment brief* (not the student) before grading.
Extracts fair minimum acceptable evidence per criterion — foundation for the main grader.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from app.services.spec_disk_cache import disk_spec_get, disk_spec_set

logger = logging.getLogger(__name__)

ASSIGNMENT_CRITERIA_MAX_CHARS = 14_000
SPEC_INJECT_MAX_CHARS = 12_000
SPEC_CACHE_VERSION = "v2"
_SPEC_CACHE_TTL_SEC = 86_400.0
_SPEC_CACHE_MAX_ENTRIES = 200
_spec_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}
# Same HTTP request: avoid duplicate PASS 0 work (cleared at start of assess_btec_rag).
_request_spec_dedup: Dict[str, Dict[str, Any]] = {}

_MINIMUM_ACCEPTABLE_FLOOR_LEN = 20

_OVERGENERAL_WORDS = frozenset(
    ("in-depth", "in depth", "comprehensive", "extensive", "thoroughly", "at length")
)


def clear_spec_request_dedup() -> None:
    _request_spec_dedup.clear()


def default_minimum_for(code: str) -> str:
    """Fair default when PASS 0 returns a vague or too-short minimum (tier-aware)."""
    c = (code or "").strip().upper()
    if ".P" in c or re.search(r"(^|[^A-Z0-9])P\d", c) or re.match(r"^P\d", c):
        return "Basic correct explanation with one relevant example."
    if ".M" in c or re.search(r"(^|[^A-Z0-9])M\d", c) or re.match(r"^M\d", c):
        return "Clear cause-effect or comparison with brief explanation."
    if ".D" in c or re.search(r"(^|[^A-Z0-9])D\d", c) or re.match(r"^D\d", c):
        return "A simple judgement with a reason."
    return "Basic correct response relevant to the task."


def compute_spec_quality(spec: Dict[str, Any]) -> float:
    """
    0.0–1.0: fraction of criterion rows in PASS0 with a substantive `minimum_acceptable`
    (length > 30). When low, do not apply PASS0-based confidence penalties.
    """
    if not isinstance(spec, dict):
        return 0.0
    crit = spec.get("criteria")
    if not isinstance(crit, dict) or not crit:
        return 0.0
    score = 0
    n = 0
    for c in crit.values():
        if not isinstance(c, dict):
            continue
        n += 1
        if len(str(c.get("minimum_acceptable", "") or "").strip()) > 30:
            score += 1
    if n == 0:
        return 0.0
    return score / n


def soften_overgeneralized_minimums(spec: Dict[str, Any]) -> None:
    """Replace minimums that accidentally demand depth with tier-appropriate fair floors."""
    crit = spec.get("criteria")
    if not isinstance(crit, dict):
        return
    for code, c in list(crit.items()):
        if not isinstance(c, dict):
            continue
        ma = str(c.get("minimum_acceptable") or "")
        low = ma.lower()
        if any(w in low for w in _OVERGENERAL_WORDS):
            c["minimum_acceptable"] = default_minimum_for(str(code))[:3000]
        crit[code] = c
    spec["criteria"] = crit

_SYSTEM_ASSIGNMENT_SPEC = """You are a senior Pearson BTEC examiner.

Your task is NOT to grade yet.

Your task is to FULLY UNDERSTAND the assignment brief before any student is graded.

Read the assessor/assignment text carefully and output ONE JSON object (no markdown).

-------------------------------------

STEP 1 — UNDERSTAND THE ASSIGNMENT

Extract (use null if truly absent):

- "learning_aim": string (e.g. A, B, AB, or short phrase from the brief)
- "scenario": string — real-world or classroom context
- "task": string — what the learner must actually produce or do
- "assignment_type": string — e.g. individual report after group work, practical portfolio, etc.

-------------------------------------

STEP 2 — EVIDENCE & OUTPUT TYPE

- "evidence_required": string[] — concrete deliverables (e.g. team log, analytical report, real examples, photos/video evidence)
- "expected_format": one of: "report" | "bullet_points" | "presentation" | "mixed" | "log" | "practical_mixed"
- IMPORTANT: Do NOT assume long paragraph essays unless the brief explicitly requires them.

-------------------------------------

STEP 3 — CRITERIA (DEEP)

For each P/M/D criterion code that appears in the brief, add an entry under "criteria" keyed by that code EXACTLY as written
(e.g. "A.P1", "P1", "A.M1", "AB.D1"). If the brief only uses P1, M1, use those keys.

Each criterion value is an object with:

- "skill": one of: "describe" | "explain" | "analyse" | "evaluate" (best fit for that row)
- "requirement": string — in plain terms what the criterion asks
- "minimum_acceptable": string — the FAIR minimum a Level 2 student must show to achieve this row (not perfection; short answers and bullets OK if appropriate)
- "common_student_format": string — e.g. short paragraphs, bullet list, log entries, report sections

STRICT FAIRNESS RULES:

- Do NOT require perfection
- Do NOT require long word counts
- Accept simple but correct understanding
- Accept short but relevant examples
- Accept bullet points or logs when the brief fits that evidence type
- Focus on MEANING and required evidence, not writing style

-------------------------------------

TOP-LEVEL JSON SHAPE (all keys required; use null or [] or {} where needed):

{
  "learning_aim": null,
  "scenario": null,
  "task": null,
  "assignment_type": "",
  "expected_format": "mixed",
  "evidence_required": [],
  "criteria": { }
}

-------------------------------------

HALLUCINATION GUARD (mandatory):

- ONLY use information that appears explicitly in the assignment / assessor text above.
- Do NOT invent specific deliverables, word counts, or tools not mentioned in the brief.
- If something is unclear, set neutral wording and "mixed" for format rather than guessing.

-------------------------------------

Your job is to DEFINE FAIRNESS for later marking. Be realistic for Level 2."""


def _spec_cache_key(btec_unit: str, assignment_criteria: str) -> str:
    raw = f"{SPEC_CACHE_VERSION}\n{(btec_unit or '').strip()}\n{(assignment_criteria or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def _spec_content_key(assignment_criteria: str) -> str:
    """Same assignment brief → same key (determinism); independent of unit label."""
    raw = f"{SPEC_CACHE_VERSION}\n{(assignment_criteria or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def _spec_cache_get(key: str) -> Optional[Dict[str, Any]]:
    now = time.monotonic()
    t = _spec_cache.get(key)
    if not t:
        return None
    val, exp = t
    if exp < now:
        del _spec_cache[key]
        return None
    return copy.deepcopy(val)


def _spec_cache_set(key: str, spec: Dict[str, Any]) -> None:
    if len(_spec_cache) >= _SPEC_CACHE_MAX_ENTRIES and key not in _spec_cache:
        k0 = next(iter(_spec_cache))
        del _spec_cache[k0]
    _spec_cache[key] = (copy.deepcopy(spec), time.monotonic() + _SPEC_CACHE_TTL_SEC)


def validate_assignment_spec(spec: Dict[str, Any]) -> Dict[str, Any]:
    """
    Hard constraints: avoid vague or overly strict minimums from the LLM.
    Mutates and returns the same dict for convenience.
    """
    if not isinstance(spec, dict):
        return spec
    crit = spec.get("criteria")
    if not isinstance(crit, dict):
        return spec
    for code, c in list(crit.items()):
        if not isinstance(c, dict):
            continue
        ma = str(c.get("minimum_acceptable") or "").strip()
        if len(ma) < _MINIMUM_ACCEPTABLE_FLOOR_LEN:
            c["minimum_acceptable"] = default_minimum_for(str(code))
        else:
            if "detailed" in ma.lower():
                c["minimum_acceptable"] = re.sub(
                    r"\bdetailed\b", "basic", ma, flags=re.IGNORECASE
                ).strip()[:3000]
        crit[code] = c
    spec["criteria"] = crit
    soften_overgeneralized_minimums(spec)
    return spec


def enrich_spec_with_submission_format(spec: Dict[str, Any], submission_format: str) -> None:
    """Compare brief expected_format vs detected student layout; set format_mismatch + Arabic note."""
    spec["format_mismatch"] = False
    spec["format_mismatch_message"] = ""
    if not spec.get("assignment_spec_ok"):
        return
    exp = str(spec.get("expected_format") or "mixed").strip().lower()
    sub = (submission_format or "mixed").strip().lower()
    if not exp or exp == "mixed" or sub == "mixed":
        return
    wants_prose = exp in ("report", "log", "practical_mixed")
    student_compact = sub in ("bullet_points", "slides_style")
    if wants_prose and student_compact:
        spec["format_mismatch"] = True
        spec["format_mismatch_message"] = (
            "تنسيق إجابتك الحالي (نقاط/سطور قصيرة) قد لا يطابق صراحةً هيكل المطلوب في الواجب (مثلاً تقرير أو سجل). "
            "يُقيَّم محتواك وفهمك أولاً؛ راعِ شكل التسليم الرسمي عند المطلوب."
        )
        return
    wants_compact = exp in ("bullet_points", "presentation")
    if wants_compact and sub == "essay":
        spec["format_mismatch"] = True
        spec["format_mismatch_message"] = (
            "الواجب يشير إلى صيغة مختصرة أو عرض تقديمي، بينما إجابتك أقرب إلى نص مترابط طويل. "
            "يُقيَّم الفهم؛ راجع تنسيق التسليم إن وُصِف صراحةً."
        )


def _default_spec() -> Dict[str, Any]:
    return {
        "assignment_spec_ok": False,
        "learning_aim": None,
        "scenario": None,
        "task": None,
        "assignment_type": "unknown",
        "expected_format": "mixed",
        "evidence_required": [],
        "criteria": {},
    }


def _parse_spec_raw(raw: str) -> Dict[str, Any]:
    base = _default_spec()
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return base
    if not isinstance(obj, dict):
        return base
    base["assignment_spec_ok"] = True
    for k in ("learning_aim", "scenario", "task", "assignment_type"):
        v = obj.get(k)
        if v is not None and str(v).strip():
            if k in ("learning_aim", "scenario", "task"):
                base[k] = str(v).strip()[:2000]
            else:
                base["assignment_type"] = str(v).strip()[:500]
    ef = obj.get("expected_format")
    if isinstance(ef, str) and ef.strip():
        base["expected_format"] = ef.strip()[:64]
    ev = obj.get("evidence_required")
    if isinstance(ev, list):
        base["evidence_required"] = [str(x).strip()[:500] for x in ev if str(x).strip()][:20]
    crit = obj.get("criteria")
    out_c: Dict[str, Any] = {}
    if isinstance(crit, dict):
        for ck, cv in list(crit.items())[:50]:
            ks = str(ck or "").strip()
            if not ks or not isinstance(cv, dict):
                continue
            out_c[ks] = {
                "skill": str(cv.get("skill") or "describe")[:32],
                "requirement": str(cv.get("requirement") or "")[:3000],
                "minimum_acceptable": str(cv.get("minimum_acceptable") or "")[:3000],
                "common_student_format": str(cv.get("common_student_format") or "")[:500],
            }
    base["criteria"] = out_c
    return base


def run_assignment_spec_pass(
    client: OpenAI,
    model: str,
    *,
    btec_unit: str,
    assignment_criteria: str,
    code_hints: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ac = (assignment_criteria or "").strip()
    if len(ac) < 40:
        return _default_spec()

    content_key = _spec_content_key(ac)
    cache_key = _spec_cache_key(btec_unit, ac)

    if content_key in _request_spec_dedup:
        logger.info("ASSIGNMENT SPEC REQUEST DEDUP HIT content=%s…", content_key[:16])
        return copy.deepcopy(_request_spec_dedup[content_key])

    for k, label in (
        (content_key, "content"),
        (cache_key, "full"),
    ):
        cached = _spec_cache_get(k)
        if cached is not None:
            logger.info("ASSIGNMENT SPEC MEMORY HIT %s key=%s…", label, k[:16])
            out = validate_assignment_spec(copy.deepcopy(cached))
            _request_spec_dedup[content_key] = copy.deepcopy(out)
            return out

    disk = disk_spec_get(content_key)
    if disk is not None:
        logger.info("ASSIGNMENT SPEC DISK HIT key=%s…", content_key[:16])
        out = validate_assignment_spec(copy.deepcopy(disk))
        _spec_cache_set(content_key, out)
        _request_spec_dedup[content_key] = copy.deepcopy(out)
        return out

    logger.info("ASSIGNMENT SPEC CACHE MISS")

    body = ac if len(ac) <= ASSIGNMENT_CRITERIA_MAX_CHARS else (ac[: ASSIGNMENT_CRITERIA_MAX_CHARS - 1] + "…")
    hint_line = ""
    if code_hints:
        hint_line = (
            "Criterion codes detected in the text (use these as keys in \"criteria\" where they match): "
            + ", ".join(code_hints[:40])
        )

    user_parts = [
        f"BTEC unit / module: {btec_unit.strip()[:500]}",
        "",
        "=== ASSIGNMENT / ASSESSOR NOTES (read fully) ===",
        body,
    ]
    if hint_line:
        user_parts.extend(["", hint_line])
    user_parts.append("\nRespond with JSON only matching the system schema.")

    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.15,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_ASSIGNMENT_SPEC},
                {"role": "user", "content": "\n".join(user_parts)},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        out = _parse_spec_raw(raw)
        out = validate_assignment_spec(out)
        if out.get("assignment_spec_ok"):
            _spec_cache_set(content_key, out)
            _spec_cache_set(cache_key, out)
            disk_spec_set(content_key, out)
        _request_spec_dedup[content_key] = copy.deepcopy(out)
        return out
    except Exception:
        logger.exception("assignment spec pass (PASS 0) failed")
        return _default_spec()


def spec_blob_for_grader(spec: Dict[str, Any]) -> str:
    """Compact JSON for the main grader user message; capped."""
    try:
        s = json.dumps(spec, ensure_ascii=False)
    except (TypeError, ValueError):
        s = "{}"
    if len(s) > SPEC_INJECT_MAX_CHARS:
        s = s[: SPEC_INJECT_MAX_CHARS - 1] + "…"
    return s
