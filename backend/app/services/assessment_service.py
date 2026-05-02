# -*- coding: utf-8 -*-
"""
BTEC-style criterion-referenced grading with RAG, then structured JSON.
Evidence quotes are post-validated against student text (no fabricated quotes count).
Post-process applies **balanced** adjustments: empty quotes → confidence penalty (not auto-fail);
D1 uses a triad score; minor justification/Evidence tensions → lower confidence, not only fail.
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from app.core.config import settings
from app.services.academic_rag_context import (
    apply_subject_boost,
    build_metadata_filter_chain_for_norm,
    format_academic_scoping_for_grader,
    merge_jsonb_metadata_filters,
    normalize_academic_context,
)
from app.services.rag_documents_service import (
    build_rag_search_plans,
    get_rag_documents_service,
)
from app.services.dual_output import apply_dual_output
from app.services.feedback_generator import generate_student_feedback
from app.services.auto_rollout_service import get_effective_split_rollout_percent
from app.services.grader_ab_metrics import record_grader_ab_pair

# Shadow single-stage: rate limit (per process) + subsample (config)
_shadow_timestamps: deque[float] = deque()
_shadow_rl_lock = threading.Lock()
from app.services.assignment_spec_pass import (
    clear_spec_request_dedup,
    compute_spec_quality,
    enrich_spec_with_submission_format,
    run_assignment_spec_pass,
    spec_blob_for_grader,
)
from app.services.submission_format import (
    detect_submission_format,
    grader_block_for_submission_format,
    min_evidence_chars_for_weak_check,
    submission_format_label_ar,
    thin_evidence_multiplier,
    weak_validated_confidence_base,
)
from app.services.student_rewrite import maybe_attach_student_improvement
from app.services.submission_merge import (
    infer_source_file_for_quote,
    list_submission_file_names,
    parse_submission_file_sections,
    resolve_section_name,
)
from app.services.vector_service import get_vector_service

logger = logging.getLogger(__name__)

MIN_WORDS_STRICT = 150

_CODE_RE = re.compile(r"\b([PpMmDd][0-9]+)\b")
_TIER_BTEC_RE = re.compile(r"(?:^|[^A-Z0-9])([PMD])\d", re.IGNORECASE)

SYSTEM_GRADER = """You are a Pearson BTEC **assessor (fair-teacher standard)** — fair, accurate, and **balanced** (not a harsh “gotcha” examiner). Grade from **cognitive work shown in the writing**, not buzzwords alone.

You may use ONLY: assignment criteria / assessor notes, the reference excerpts, and the student’s work.

**Mindset (mandatory)**
- If the student **clearly** meets a criterion → `achieved: true`.
- **Do not** fail someone for small imperfections when understanding is still evident.
- Evidence matters, but the system can accept a claim with **lower confidence** when quotes are limited — your job is still to be honest in the `justification`.
- For Distinction, **full** evaluation (judgement, comparison, conclusion) is ideal; **partial** evaluation can still be `achieved: true` if the work shows real evaluative thinking — note gaps in `justification` and the system will adjust `confidence`.
- **Never** claim quotes exist that do not; never invent file names.
- Ignore words like "analysis" unless the **thinking** is actually present in the text.
- Always explain what was done well and what is missing for higher bands (where relevant).
- Be **supportive but accurate** in tone.

**Pass-level evidence: developmental (mandatory)**
- If the student **meets the fair minimum** (including PASS0 `minimum_acceptable` when present) but evidence is **thin, short, or imperfect**, keep `achieved: true` when the cognitive match is there — **do not** treat weak-but-sufficient evidence as automatic failure; lower `confidence` and explain honestly.
- In `justification` / `why_achieved` (when achieved), **acknowledge** that the minimum is met, and give **one clear, forward-looking** tip to strengthen evidence (e.g. stronger verbatim quotes, clearer links) — supportive, not punitive; avoid “unsatisfactory” or harsh failure language when the band is still Pass-appropriate.
- In **rationale** at **Pass**: state that requirements are **met at minimum** where that applies, and that **Merit/Distinction** need **stronger** analysis/evidence; avoid sounding like a fail when the final band is Pass.

---

### A) Full submission
Read the **entire** student submission before marking any row. No decisions from titles, first paragraphs, or headings alone.

### B) Anti-keyword / anti-labelling (mandatory)
- **Ignore** the student’s use of words such as: analysis, evaluate, evaluation, discuss, impact — unless the **sentences** show the matching cognitive act (see E).
- **Ignore** the student labelling a section "Evaluation" or pasting "P1/M1/D1" unless the content matches the level.
- If the work **describes a plan** or **lists steps** but does **not** weigh trade-offs, justify a conclusion, or link cause→effect for that outcome, you **must not** treat it as Merit or Distinction for that row.

### C) analysis vs evaluation (BTEC use — must drive judgements)
- **Describe / explain (Pass / P)**: what something is, what it does, a basic **because**; routine description of a plan or of effects **without** weighing alternatives or justifying a judgement is **P-level** at most for outcomes that are P-coded.
- **Analyse (Merit / M)**: **how/why** links, **relationships**, **cause–effect between factors**, or structured comparison — not a bullet list of facts.
- **Evaluate (Distinction / D)**: a **justified judgement** — weighs **strengths/weaknesses**, **options or trade-offs**, and reaches a **supported conclusion**; not “impact is important” without reasoning.

### D) Evidence (file-aware)
- Every `criteria_results` row: **"evidence"** is an array of objects, each with **"quote"** = exact substring from the student text under that file, and **"source_file"** = the `[FILE: …]` name.
- Prefer at least one verifiable quote when you claim `achieved: true`. If the model cannot anchor quotes but your reasoning still reflects clear meet of the standard, you may set `achieved: true` with **lower `confidence`**, and the automated pipeline may further reduce `confidence` when quotes cannot be matched — do **not** use this to bypass missing learning.
- Multiple files: when work spans files, do not only quote one file for all rows if the criterion is genuinely supported elsewhere.

### E) Banned "empty praise" in justifications
- You **must not** use **good, clear, strong, solid, excellent, well-developed** (or Arabic equivalents) **unless** the same sentence or the next one cites **what the student actually wrote** (paraphrase allowed only after a quote, not instead of it).
- Prefer: "The student text states: [idea reflected in evidence quotes] — therefore …"

### F) **Language must match the band of THIS row (no P vs M/D mismatch)**
- For a row with code **P** (e.g. P1): the **justification** must use **P-appropriate** wording (description / explanation of concepts). You **must not** say the student "evaluates impact", "makes a justified judgement", or "provides a comprehensive analysis" **for P1** if the criteria for M1/D1 for that same unit are **separate** rows — those belong in M/D rows. If the writing actually reaches M or D, still describe **P1** in P-terms, and set M/D rows according to the M/D requirements.
- For **M** rows: if not achieved, name what is **missing** for **analysis** (e.g. no cause–effect, no link between two factors) with no fake praise.
- For **D** rows: if not achieved, name what is **missing** for **evaluation** (e.g. no trade-offs, no justified recommendation).

### G) "why_higher_tier_excluded" (per row, mandatory when applicable)
- For each `criteria_results` object, add **"why_higher_tier_excluded"** (string):
  - If the assignment lists a **higher** P/M/D code in the same skill chain (e.g. M1, D1 when you are scoring P1), one concise sentence: **why Merit or Distinction is not met for the overall demand** of that line of criteria (e.g. "M1 not met: no analysis of how X affects Y; work stays descriptive." or "D1 not met: no justified judgement or comparison of options.").
  - If this row is already **D** or there is no higher code in the brief, use **"N/A"** or a single sentence on limits of the work.
- **"observed_cognitive_level"** (string, required): one of **describe**, **explain**, **analyse**, **evaluate** — your honest read of what the student **demonstrated** for **this** code (not the words they used).

### H) "rationale" (overall) — must not contradict "grade_band"
- **rationale** must be consistent with the **per-row** `achieved` flags and the recomputed band.
- If the final band is **Pass**, you **must** state explicitly (briefly) **why Merit was not met** and **why Distinction was not met** (one phrase each) **unless** the assignment has no M/D in scope.
- If the final band is **Merit**, state briefly **why Distinction was not met**.

### I) If achieved is false
- "justification" must say what is **missing**; "evidence" may be [] or may quote weak text.

Return **one** JSON object with these top-level keys:
- "grade_band": "Pass" | "Merit" | "Distinction" | "Not yet achieved" (system may cross-check),
- "rationale": string (see H),
- "strengths": string[] (optional empty),
- "improvements": string[] (optional empty),
- "cited_sources": [{{"source_file": string, "relevance": 0-1}}] from reference context,
- "assignment_context": {{"scenario": string, "task": string, "expected_outcomes": string, "criteria_summary": string}},
- "criteria_extracted": [ {{"code": "P1", "description": "…"}}, … ],
- "criteria_results": same order as **criteria_extracted**; each object:
  {{
    "code": "P1",
    "achieved": true or false,
    "justification": "Use structure: (1) State achieved/not and **why** with reference to the actual cognitive work. (2) Do not praise at M/D level for a P row.",
    "why_higher_tier_excluded": "see G",
    "observed_cognitive_level": "describe|explain|analyse|evaluate",
    "meets_assignment_minimum": true or false or null — if PASS 0 lists this code in `criteria`, set **true** if the student work meets that row’s `minimum_acceptable`, **false** if clearly below; **null** if PASS 0 has no row for this code or you cannot judge,
    "why_achieved": string — when **achieved** is true, one short sentence (English or Arabic to match the student) explaining why the work meets the fair minimum; empty or omit when achieved is false,
    "why_not_achieved": string — when **achieved** is false, one clear sentence: what is missing vs the fair minimum (for student transparency). Empty when achieved is true,
    "improvement_hint": string — when **achieved** is false, one short practical tip to improve. Empty when achieved is true,
    "evidence": [ {{"quote": "EXACT", "source_file": "as in [FILE: …] or submission"}} ],
    "confidence": 0-1 (optional)
  }},
- "criteria_undetected": true if no P/M/D style codes in the brief.

**STRICT (system) rules**
- No fabricated "quote" substrings. Short phrases OK if verbatim.
- Only criteria in `criteria_extracted`. If Pass-level evidence is borderline, prefer a fair judgement and lower `confidence` rather than automatic failure.

**PASS 0 block (when present)**: `[PASS 0 — ASSIGNMENT SPECIFICATION]` defines fair **minimum acceptable** evidence per criterion from the *brief* only. You MUST:
- Use each criterion’s `minimum_acceptable` as the **fair bar** for judging Pass-level achievement — not perfection, not A-level prose.
- Respect `expected_format` and `evidence_required` (report, log, bullets, mixed). If the brief expects a log, list, or short sections, do **not** treat lack of long paragraphs as failure.
- Combine with the detected **submission format** (bullet/slide/essay) in the next blocks: if both allow concise evidence, **reward meaning**, not length.
- Still require genuine cognitive match for M/D (analysis/evaluation) as defined by BTEC for that code — but the *form* of the answer can be short if the spec says so.
- If PASS 0 reports `format_mismatch` between brief and student layout, use it only in **feedback text** — do **not** lower `achieved` or `confidence` solely for layout; fairness is about content.

**PASS 1 block**: Use for consistency. Evidence `quote` = student work only. If `evaluation_detected` is false, be conservative on **D1**; the system may re-check. Do not copy PASS 1 into `evidence`.
"""

SYSTEM_PASS1 = """You are a BTEC document understanding stage (not grading). Read the full student submission and output ONE JSON object with exactly these keys:
"summary" (string, 2-4 sentences),
"analysis_detected" (boolean): true only if the work shows real why/how, cause–effect, or **relationships between ideas** (not a bare list, not labelling a section "analysis"),
"evaluation_detected" (boolean): true only if the work includes **justified** judgment, **weighing** options, trade-offs, or a **supported** conclusion (not the word "evaluate" alone, not praise without reasoning),
"key_points" (array, max 7 short strings, each under 20 words; main arguments, comparisons, or conclusions you find).

Be strict. Do not infer analysis/evaluation from keywords. No other keys. No markdown."""

# Optional stage-1 in split-grader path (strong model): compact skeleton only; stage-2 applies SYSTEM_GRADER for full JSON.
SYSTEM_GRADER_SKELETON = """You are a BTEC **fair-teacher** assessor (not a strict examiner). Read the full message: PASS0, PASS1, unit, student work, and reference excerpts.
Output **one** JSON object with:
- "grade_band": "Pass" | "Merit" | "Distinction" | "Not yet achieved" (tentative, consistent with the evidence),
- "skeleton_criteria": [ { "code": "P1", "achieved": true|false, "confidence": 0-1, "key_points": ["short", …] (max 3 per row) } ] for every P/M/D code the assignment text implies,
- "fairness_notes": string (optional, max 2 sentences) — e.g. borderline pass-level, or why a band is tentative.

**Rules (mandatory)**
- Align with **PASS 0** `minimum_acceptable` for Pass: if the work fairly meets the minimum, lean **achieved** with honest confidence, not a fail.
- If **PASS 1** says `evaluation_detected` is false, do not treat D1 as achieved.
- No long `justification`, no `evidence` array, no per-row Arabic/English student feedback — this is a **compact** pass only. JSON only."""


PASS1_STUDENT_MAX_CHARS = 14_000


def _pass1_unavailable() -> Dict[str, Any]:
    """PASS1 call failed or JSON invalid — do not assume evaluation exists."""
    return {
        "summary": "",
        "analysis_detected": None,
        "evaluation_detected": None,
        "key_points": [],
        "pass1_ok": False,
    }


def _default_pass1() -> Dict[str, Any]:
    """Empty / edge-only use: conservative, no assumed evaluation (blocks D1 until strong pass2)."""
    return {
        "summary": "",
        "analysis_detected": None,
        "evaluation_detected": None,
        "key_points": [],
        "pass1_ok": False,
    }


def _parse_pass1_payload(raw: str) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "summary": "",
        "analysis_detected": None,
        "evaluation_detected": None,
        "key_points": [],
        "pass1_ok": True,
    }
    try:
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return _pass1_unavailable()
    except (json.JSONDecodeError, TypeError):
        return _pass1_unavailable()
    d["summary"] = str(obj.get("summary") or "")[:4000]
    if "analysis_detected" in obj:
        av = obj.get("analysis_detected")
        d["analysis_detected"] = None if av is None else bool(av)
    else:
        d["analysis_detected"] = False
    if "evaluation_detected" in obj:
        evv = obj.get("evaluation_detected")
        d["evaluation_detected"] = None if evv is None else bool(evv)
    else:
        d["evaluation_detected"] = False
    kp = obj.get("key_points")
    if isinstance(kp, list):
        d["key_points"] = [str(x).strip()[:200] for x in kp if str(x).strip()][:7]
    d["pass1_ok"] = True
    return d


def _run_understanding_pass(
    client: OpenAI, model: str, student_work: str
) -> Dict[str, Any]:
    sw = (student_work or "").strip()
    if not sw:
        return _default_pass1()
    body = sw if len(sw) <= PASS1_STUDENT_MAX_CHARS else (sw[: PASS1_STUDENT_MAX_CHARS - 1] + "…")
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PASS1},
                {
                    "role": "user",
                    "content": f"Full student work:\n{body}\n\nRespond with JSON only.",
                },
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        return _parse_pass1_payload(raw)
    except Exception:
        logger.exception("understanding pass (PASS 1) failed; evaluation state UNKNOWN")
        return _pass1_unavailable()


# D1 depth (distinction): trade-off, stakeholder, risk
_RE_D1_TRADEOFF = re.compile(
    r"\b(trade-?off|tradeoff|tradeoffs|weigh(ing|ed)?\s+(options|alternatives|trade)|on the one hand|pros and cons|"
    r"cost[- ]?benefit|compared to alternatives|versus\b)\b",
    re.IGNORECASE,
)
_RE_D1_STAKEHOLDER = re.compile(
    r"\b(stakeholder|shareholder|client|customer|user|employer|employee|management|"
    r"community|supplier|investor|board)\b",
    re.IGNORECASE,
)
_RE_D1_RISK = re.compile(
    r"\b(risk|uncertaint|threat|downside|mitigat|liabilit|vulnerabil|adverse|harm|loss)\b",
    re.IGNORECASE,
)
_RE_D1_TRADEOFF_AR = re.compile(
    r"(مقارنة\s+بين|المقارنة|البديلان|نقيض|إيجابيات|سلبيات|ميزان|تضارب|ثمن|تكلفة\W+مقابل)",
    re.IGNORECASE,
)
_RE_D1_STAKEHOLDER_AR = re.compile(
    r"(أصحاب\s+المصلحة|الجهات\s+المعنية|العملاء|الموظفون|الإدارة|المورد|الشركاء|"
    r"الخسارة\s+لل|العميل|المستفيدين)",
    re.IGNORECASE,
)
_RE_D1_RISK_AR = re.compile(
    r"(مخاطر|خطر|تهديد|تأثير\s+سلبي|احتمال\s+فشل|عيب\s+|سلبيات\s+|ضعف\s+|غموض)",
    re.IGNORECASE,
)


def _d1_justification_depth_for_distinction(justification: str) -> bool:
    t = (justification or "").strip()
    if not t:
        return False
    t_ok = bool(
        _RE_D1_TRADEOFF.search(t) or _RE_D1_TRADEOFF_AR.search(t)
    )
    s_ok = bool(_RE_D1_STAKEHOLDER.search(t) or _RE_D1_STAKEHOLDER_AR.search(t))
    r_ok = bool(_RE_D1_RISK.search(t) or _RE_D1_RISK_AR.search(t))
    return t_ok and s_ok and r_ok


def _p1_evaluation_detected_optional(p1: Dict[str, Any]) -> Optional[bool]:
    v = p1.get("evaluation_detected")
    if v is None:
        return None
    return bool(v)


def _d1_strong_enough_for_unknown_pass1(row: Dict[str, Any]) -> bool:
    """
    When PASS1 cannot confirm evaluation, allow D1=achieved only with deep justification
    and substantive quotes (trade-off, stakeholder, risk signals).
    """
    if not _d1_justification_depth_for_distinction(str(row.get("justification") or "")):
        return False
    ev = row.get("evidence")
    total = 0
    if isinstance(ev, list):
        for x in ev:
            if isinstance(x, str):
                total += len(x.strip())
            elif isinstance(x, dict):
                total += len(str(x.get("quote") or x.get("text") or "").strip())
    return total >= 60


def _enforce_d1_evaluation_gate(
    rows: List[Dict[str, Any]],
    evaluation_detected: Optional[bool],
) -> List[Dict[str, Any]]:
    """
    evaluation_detected:
      True  → D1 allowed if grader said achieved (other checks still apply).
      False → D1 not awarded if grader had achieved.
      None  (PASS1 failed/unknown) → D1 only if _d1_strong_enough_for_unknown_pass1.
    """
    if not rows:
        return rows
    out: List[Dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        code = str(r.get("code") or "").strip().upper()
        if code != "D1" or not bool(r.get("achieved")):
            out.append(r)
            continue
        if evaluation_detected is True:
            out.append(r)
            continue
        if evaluation_detected is False:
            j = str(r.get("justification") or "").strip()
            suffix = " [Gate: understanding pass found no real evaluation; D1 not awarded.]"
            out.append({**r, "achieved": False, "justification": (j + suffix) if j else suffix.strip()})
            continue
        # None: unknown
        if _d1_strong_enough_for_unknown_pass1(r):
            out.append(r)
        else:
            j = str(r.get("justification") or "").strip()
            suffix = (
                " [Gate: PASS1 unavailable or inconclusive; D1 not awarded without strong "
                "evidence of trade-offs, stakeholders, and risk.]"
            )
            out.append({**r, "achieved": False, "justification": (j + suffix) if j else suffix.strip()})
    return out


def _word_count(s: str) -> int:
    t = (s or "").strip()
    if not t:
        return 0
    return len(t.split())


def _extract_codes(assignment_criteria: str) -> List[str]:
    s = (assignment_criteria or "").strip()
    if not s:
        return []
    found = _CODE_RE.findall(s)
    return list(dict.fromkeys(f.upper() for f in found))


def _tier(code: str) -> str:
    c = (code or "P0").upper()
    if not c:
        return "P"
    t = c[0]
    if t in ("P", "M", "D"):
        return t
    return "P"


def validate_evidence_quotes(evid: List[str], student_work: str) -> List[str]:
    """Return only substrings that appear in student_work (verbatim or case-matched)."""
    return _filter_evidence_to_student(evid, student_work)


def _filter_evidence_to_student(evid: List[str], student_work: str) -> List[str]:
    if not student_work or not evid:
        return []
    sw = student_work
    lo = sw.lower()
    out: List[str] = []
    for e in evid:
        if not e or not isinstance(e, str):
            continue
        s = e.strip()
        if len(s) < 2:
            continue
        if s in sw:
            out.append(s[:800])
        elif s.lower() in lo:
            # recover original casing from student work (best effort)
            idx = lo.find(s.lower())
            if idx >= 0:
                out.append(sw[idx : idx + len(s)][:800])
    return list(dict.fromkeys(out))[:8]


def _coerce_to_evidence_items(raw: Any) -> List[Dict[str, str]]:
    """Model output: list of {quote, source_file} and/or legacy plain strings."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, str]] = []
    for x in raw:
        if isinstance(x, str):
            t = x.strip()
            if len(t) >= 2:
                out.append({"quote": t, "source_file": ""})
        elif isinstance(x, dict):
            q = str(x.get("quote") or x.get("text") or "").strip()
            if len(q) < 2:
                continue
            sf = str(x.get("source_file") or x.get("file") or "").strip()
            out.append({"quote": q, "source_file": sf})
    return out[:20]


def _resolve_one_evidence_item(
    it: Dict[str, str],
    sections: List[Tuple[str, str]],
    student_work: str,
) -> Optional[Dict[str, str]]:
    q_in = (it.get("quote") or "").strip()
    if len(q_in) < 2:
        return None
    vf = _filter_evidence_to_student([q_in], student_work)
    if not vf:
        return None
    q = vf[0]
    claimed = (it.get("source_file") or "").strip()
    if claimed:
        c = resolve_section_name(claimed, sections)
        if c:
            body = next((b for n, b in sections if n == c), "") or ""
            if q in body or (body and q.lower() in body.lower()):
                return {"quote": q, "source_file": c}
    best = infer_source_file_for_quote(q, sections)
    if best:
        return {"quote": q, "source_file": best}
    if len(sections) == 1:
        return {"quote": q, "source_file": sections[0][0]}
    return None


def _default_row_confidence(row: Dict[str, Any]) -> float:
    c = row.get("confidence")
    if isinstance(c, (int, float)) and 0.0 <= float(c) <= 1.0:
        return float(c)
    return 0.75


def _confidence_reason_add(row: Dict[str, Any], *codes: str) -> None:
    if not isinstance(row, dict):
        return
    r = row.setdefault("confidence_reason", [])
    if not isinstance(r, list):
        row["confidence_reason"] = []
        r = row["confidence_reason"]
    for c in codes:
        if c and c not in r:
            r.append(c)


def _parse_band_rank(s: str) -> int:
    t = (s or "").strip().lower()
    if "not yet" in t:
        return 0
    if "distinction" in t:
        return 3
    if "merit" in t:
        return 2
    if "pass" in t:
        return 1
    return 0


def _band_str_from_rank(r: int) -> str:
    m = {0: "Not yet achieved", 1: "Pass", 2: "Merit", 3: "Distinction"}
    return m.get(max(0, min(3, r)), "Not yet achieved")


def _tier_btec(code: str) -> str:
    """P / M / D from criterion code (handles A.P1, M1, …)."""
    c = (code or "").strip().upper()
    m = _TIER_BTEC_RE.search(c) or re.search(r"^([PMD])\d", c)
    if m:
        return m.group(1).upper()
    if c and c[0] in ("P", "M", "D"):
        return c[0]
    return "P"


def weighted_achievement_ratio(results: List[Dict[str, Any]]) -> tuple[float, float]:
    """Tier-weighted share of achieved work: P=1, M=1.2, D=1.4."""
    W = {"P": 1.0, "M": 1.2, "D": 1.4}
    num = 0.0
    den = 0.0
    for r in results or []:
        if not isinstance(r, dict):
            continue
        t = _tier_btec(str(r.get("code") or ""))
        w = float(W.get(t, 1.0))
        den += w
        if r.get("achieved"):
            num += w
    return (num / max(den, 1e-6), den)


def stabilize_grade_band(
    results: List[Dict[str, Any]],
    current_band: str,
    *,
    ratio: float = 0.75,
) -> tuple[str, bool]:
    """
    If enough **weighted** criterion achievement mass is present, the band is not below **Pass**.
    """
    rows = [r for r in (results or []) if isinstance(r, dict)]
    if not rows:
        return current_band, False
    wr, _ = weighted_achievement_ratio(rows)
    if wr < ratio:
        return current_band, False
    r_cur = _parse_band_rank(current_band)
    r_new = max(r_cur, _parse_band_rank("Pass"))
    if r_new == r_cur:
        return current_band, False
    return _band_str_from_rank(r_new), True


def upper_guard(
    results: List[Dict[str, Any]],
    band: str,
) -> tuple[str, bool]:
    """
    Do not award Distinction without an achieved D row, nor Merit without an achieved M row
    (when the band would claim that level).
    """
    rows = [r for r in (results or []) if isinstance(r, dict)]
    has_m = any(
        bool(r.get("achieved")) and _tier_btec(str(r.get("code") or "")) == "M" for r in rows
    )
    has_d = any(
        bool(r.get("achieved")) and _tier_btec(str(r.get("code") or "")) == "D" for r in rows
    )
    b = (band or "").strip()
    if b == "Distinction" and not has_d:
        return "Merit", True
    if b == "Merit" and not has_m:
        return "Pass", True
    return b, False


def summarize_confidence_reasons_ar(reasons: List[str]) -> List[str]:
    """Short Arabic bullets (max 3) for quick teacher/student read."""
    s: List[str] = []
    rs = set(reasons)
    if "meets_assignment_minimum" in rs:
        s.append("حقق الحد الأدنى ✔")
    if "flexible_minimum_recovery" in rs:
        s.append("تعويض لطيف: حد أدنى متحقق مع أدلة قابلة للتقوية")
    if "thin_evidence_penalty" in rs:
        s.append("أدلة اقتباسية محدودة (مع الاعتراف باستيفاء الحد الأدنى حيث ينطبق) ⚠️")
    if "format_adjustment" in rs:
        s.append("تنسيق مختصر (مقبول)")
    if "below_spec_minimum_penalty" in rs:
        s.append("أقل من المطلوب")
    if "weak_validated_evidence" in rs:
        s.append("التحقق من الاقتباس محدود — يُنصح بتقوية الاقتباسات")
    if "confidence_floor" in rs:
        s.append("حد أدنى للثقة بعد العقوبات")
    if "multi_file_m_d_bias" in rs:
        s.append("تعدد ملفات بأدلة من ملف واحد")
    if "justification_tension" in rs:
        s.append("صياغة متوترة مع التحقيق")
    return s[:3]


def _annotate_confidence_summaries(rows: List[Dict[str, Any]]) -> None:
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("confidence_reason")
        if not isinstance(raw, list):
            continue
        reasons = [str(x) for x in raw if str(x).strip()]
        row["confidence_summary_ar"] = summarize_confidence_reasons_ar(reasons)


def _compute_overall_confidence(criteria_results: Any) -> Optional[float]:
    vals: List[float] = []
    if not isinstance(criteria_results, list):
        return None
    for r in criteria_results:
        if not isinstance(r, dict) or not r.get("achieved"):
            continue
        c = r.get("confidence")
        if isinstance(c, (int, float)):
            vals.append(float(c))
    if not vals:
        return None
    m = sum(vals) / len(vals)
    return max(0.45, min(0.95, m))


def _build_audit_payload(
    out: Dict[str, Any],
    *,
    spec_quality: float,
    spec_penalties_disabled: bool,
    student_level: str,
) -> Dict[str, Any]:
    ca = out.get("criterion_achievement") if isinstance(out.get("criterion_achievement"), dict) else {}
    return {
        "spec_quality": round(float(spec_quality), 4),
        "spec_penalties_disabled": bool(spec_penalties_disabled),
        "stability_applied": bool(out.get("grade_band_stability_applied")),
        "upper_guard_applied": bool(out.get("grade_band_upper_guard_applied")),
        "student_level": student_level,
        "weighted_achievement_ratio": ca.get("weighted_ratio"),
        "simple_achievement_ratio": ca.get("ratio"),
        "achievement_borderline": bool(out.get("achievement_borderline")),
        "overall_confidence": out.get("overall_confidence"),
    }


def _resolve_student_level(
    ctx: Optional[Dict[str, Any]],
    academic_for_grader: Optional[Dict[str, Any]],
) -> tuple[str, bool]:
    """
    (student_level, relax_thresholds). BTEC L2 default: fairer floor / softer PASS0 reliance.
    """
    if ctx and isinstance(ctx, dict):
        raw = str(
            ctx.get("student_level") or ctx.get("btec_level") or ctx.get("level") or ""
        ).strip()
        if raw:
            low = raw.lower()
            if low in ("level2", "l2", "2", "btec_l2", "btecl2"):
                return "Level2", True
            if low in ("level3", "l3", "3", "btec_l3", "btecl3"):
                return "Level3", False
            return raw, "level2" in low or low in ("2", "l2")
    if isinstance(academic_for_grader, dict):
        gt = str(academic_for_grader.get("grade_tier") or "")
        if gt.startswith("L2") or "L2" in gt:
            return "Level2", True
    return "Level2", True


def _spec_penalties_threshold(relax: bool) -> float:
    return 0.45 if relax else 0.5


def _stability_ratio(relax: bool) -> float:
    return 0.70 if relax else 0.75


def _add_criterion_achievement_momentum(
    out: Dict[str, Any],
    *,
    stability_ratio: float = 0.75,
) -> None:
    cr = out.get("criteria_results")
    if not isinstance(cr, list) or not cr:
        return
    rows = [r for r in cr if isinstance(r, dict)]
    tot = len(rows)
    ach = sum(1 for r in rows if r.get("achieved"))
    simple_r = ach / max(1, tot)
    wr, _ = weighted_achievement_ratio(rows)
    out["criterion_achievement"] = {
        "achieved": ach,
        "total": tot,
        "ratio": round(simple_r, 4),
        "weighted_ratio": round(wr, 4),
    }
    borderline = 0.6 <= wr < stability_ratio
    out["achievement_borderline"] = borderline
    if borderline:
        out["progress_momentum_ar"] = (
            "📊 أنت قريب من تحقيق المستوى — ينقصك معيار أو معياران فقط. راجع التغذية الراجعة أدناه."
        )
    elif 0.5 <= simple_r < 1.0:
        out["progress_momentum_ar"] = (
            "تقدّم واضح: أغلب معايير المهمة محقّقة. ركّز على ما تبقّى — التفصيل في التغذية الراجعة."
        )


def _apply_evidence_policy(
    rows: List[Dict[str, Any]],
    student_work: str,
    submission_format: str = "mixed",
) -> tuple[List[Dict[str, Any]], List[str], List[str]]:
    """
    Verifies quotes against student work, assigns canonical source_file per quote.
    Preserves legacy `evidence: string[]` and adds `evidence_items: [{quote, source_file}]`.
    Returns (rows, all source_file values for coverage metrics, balance_flags for weak evidence).
    If the model claims achieved but no quote validates: **keeps achieved** and penalizes confidence
    (balanced / educational; no automatic fail for missing quotes).
    """
    sections = parse_submission_file_sections(student_work)
    all_sources: List[str] = []
    balance_flags: List[str] = []
    fixed: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        if not code:
            continue
        items = _coerce_to_evidence_items(row.get("evidence"))
        cleaned: List[Dict[str, str]] = []
        for it in items:
            one = _resolve_one_evidence_item(it, sections, student_work)
            if one:
                cleaned.append(one)
                all_sources.append(one["source_file"])
        seen_k: set[str] = set()
        deduped: List[Dict[str, str]] = []
        for it in cleaned:
            k = f"{it['source_file']}\0{it['quote'][:200]}"
            if k in seen_k:
                continue
            seen_k.add(k)
            deduped.append(it)
        clean_strings = [x["quote"] for x in deduped]
        ach = bool(row.get("achieved"))
        j = str(row.get("justification") or "No justification provided.").strip()
        c_base = _default_row_confidence(row) if ach else 0.0
        if ach and not deduped:
            wv = float(weak_validated_confidence_base(submission_format))
            if row.get("meets_assignment_minimum") is True:
                wv = min(0.96, wv + 0.08)
            c_base = max(0.05, c_base * wv)
            balance_flags.append(f"{code}: weak evidence (accepted but penalized)")
            if submission_format in ("bullet_points", "slides_style"):
                j = (
                    j
                    + " [تنسيق نقاط/شرائح: لا اقتباس حرفي تام مطابق لآلية التحقق؛ التحقق مُقبول بثقة مُخفّضة.]"
                ).strip()
            else:
                j = (j + " [No verbatim student quote survived validation; achievement accepted with reduced confidence.]").strip()
        conf_reason: List[str] = []
        if isinstance(row.get("confidence_reason"), list):
            conf_reason = [str(x) for x in row["confidence_reason"] if str(x).strip()][:20]
        out_row: Dict[str, Any] = {
            "code": code,
            "achieved": ach,
            "justification": j,
            "evidence": clean_strings,
            "evidence_items": deduped,
            "confidence_reason": conf_reason,
        }
        if ach:
            out_row["confidence"] = c_base
        if ach and not deduped:
            _confidence_reason_add(out_row, "weak_validated_evidence")
        whte = str(row.get("why_higher_tier_excluded") or "").strip()
        if whte:
            out_row["why_higher_tier_excluded"] = whte[:2000]
        ocl = str(row.get("observed_cognitive_level") or "").strip().lower()
        if ocl in ("describe", "explain", "analyse", "analyze", "evaluate"):
            if ocl == "analyze":
                ocl = "analyse"
            out_row["observed_cognitive_level"] = ocl
        if "meets_assignment_minimum" in row:
            mv = row.get("meets_assignment_minimum")
            out_row["meets_assignment_minimum"] = None if mv is None else bool(mv)
        wy = str(row.get("why_achieved") or "").strip()
        if wy:
            out_row["why_achieved"] = wy[:2000]
        wn = str(row.get("why_not_achieved") or "").strip()
        if wn:
            out_row["why_not_achieved"] = wn[:2000]
        ih = str(row.get("improvement_hint") or "").strip()
        if ih:
            out_row["improvement_hint"] = ih[:2000]
        fixed.append(out_row)
    return fixed, all_sources, balance_flags


def _d1_count_evaluative_triad(justification: str) -> int:
    """0–3: judgement, comparison, conclusion signals in justification text (EN/AR)."""
    t = justification or ""
    n = 0
    if bool(_RE_D1_JUDGEMENT.search(t) or _RE_D1_J_AR.search(t)):
        n += 1
    if bool(_RE_D1_COMPARE.search(t) or _RE_D1_C_AR.search(t)):
        n += 1
    if bool(_RE_D1_CONCLUDE.search(t) or _RE_D1_E_AR.search(t)):
        n += 1
    return n


def _apply_d1_triad_balance(rows: List[Dict[str, Any]], balance_flags: List[str]) -> None:
    """
    Distinction rows: need judgement / comparison / conclusion in the **justification** (audit text).
    Score 2–3: usually keep pass; if depth signals thin, nudge confidence down.
    Score 1: pass with 0.75 confidence multiplier.
    Score 0: not achieved.
    """
    for row in rows:
        if not isinstance(row, dict):
            continue
        code_u = str(row.get("code") or "").strip().upper()
        if not code_u.startswith("D") or not bool(row.get("achieved")):
            continue
        j = str(row.get("justification") or "")
        score = _d1_count_evaluative_triad(j)
        c = _default_row_confidence(row)
        if score >= 2:
            if not _d1_justification_depth_for_distinction(j):
                row["confidence"] = max(0.05, c * 0.88)
                _confidence_reason_add(row, "d1_depth_soft")
                balance_flags.append(f"{code_u}: d1_thin_on_depth (kept, confidence reduced)")
            else:
                row["confidence"] = c
        elif score == 1:
            row["achieved"] = True
            row["confidence"] = max(0.05, c * 0.75)
            _confidence_reason_add(row, "d1_evaluative_triad_partial")
            balance_flags.append(f"{code_u}: d1_evaluative_triad_partial (1/3, confidence reduced)")
        else:
            row["achieved"] = False
            row["justification"] = (
                (j or "").strip()
                + " [Balance: Distinction needs evaluative lines (judgement, comparison, and/or conclusion) reflected in the marking rationale; none detected in justification.]"
            ).strip()
            balance_flags.append(f"{code_u}: d1_triad_not_met")


def _apply_justification_contradiction_balance(
    rows: List[Dict[str, Any]], balance_flags: List[str]
) -> None:
    """Negative wording in an 'achieved' justification → lower confidence, not auto-fail."""
    any_hit = False
    for row in rows:
        if not isinstance(row, dict) or not bool(row.get("achieved")):
            continue
        j = str(row.get("justification") or "")
        if not _achieved_justification_contradiction(j):
            continue
        row["confidence"] = max(0.05, _default_row_confidence(row) * 0.8)
        _confidence_reason_add(row, "justification_tension")
        any_hit = True
    if any_hit:
        balance_flags.append("minor_inconsistency")


def _apply_thin_evidence_confidence(
    rows: List[Dict[str, Any]], balance_flags: List[str], submission_format: str = "mixed"
) -> None:
    """
    Very short total quoted text but row still marked achieved — nudge confidence (not a fail).
    Skipped for bullet-heavy layouts; softer for slide-style; full for essay-like work.
    """
    fmt = (submission_format or "mixed").strip()
    if fmt == "bullet_points":
        return
    mult = float(thin_evidence_multiplier(fmt))
    any_hit = False
    for row in rows:
        if not isinstance(row, dict) or not bool(row.get("achieved")):
            continue
        if not _evidence_list_weak(row.get("evidence"), fmt):
            continue
        m = mult
        if row.get("meets_assignment_minimum") is True:
            m = min(1.0, m + (1.0 - m) * 0.5)
        row["confidence"] = max(0.05, _default_row_confidence(row) * m)
        _confidence_reason_add(row, "thin_evidence_penalty")
        if fmt in ("slides_style", "mixed"):
            _confidence_reason_add(row, "format_adjustment")
        any_hit = True
    if any_hit:
        balance_flags.append("achieved_thin_quoted_text (confidence reduced)")


def _find_spec_key_for_code(code: str, spec_criteria: Any) -> Optional[str]:
    if not isinstance(spec_criteria, dict):
        return None
    c = (code or "").strip()
    if not c:
        return None
    if c in spec_criteria:
        return c
    cu = c.upper().replace(" ", "")
    for k in spec_criteria:
        ks = str(k).strip()
        if ks.upper().replace(" ", "") == cu:
            return ks
    return None


def _apply_meets_spec_minimum_confidence(
    rows: List[Dict[str, Any]],
    assignment_spec: Optional[Dict[str, Any]],
    submission_format: str,
    balance_flags: List[str],
    disable_spec_penalties: bool = False,
) -> None:
    """
    If the grader set meets_assignment_minimum=false for a row with PASS0 spec, nudge confidence down.
    Softer factor for bullet/slide submission layouts. Skipped when PASS0 quality is too low.
    """
    if disable_spec_penalties:
        balance_flags.append("spec_penalties_skipped (PASS0 quality < threshold)")
        return
    if not isinstance(assignment_spec, dict) or not assignment_spec.get("assignment_spec_ok"):
        return
    crit = assignment_spec.get("criteria")
    if not isinstance(crit, dict) or not crit:
        return
    fmt = (submission_format or "mixed").strip()
    use_soft = fmt in ("bullet_points", "slides_style")
    pen = 0.6 * 0.85 if use_soft else 0.6
    any_hit = False
    for row in rows:
        if not isinstance(row, dict) or not bool(row.get("achieved")):
            continue
        if not _find_spec_key_for_code(str(row.get("code") or ""), crit):
            continue
        m = row.get("meets_assignment_minimum")
        if m is None:
            continue
        if m is True:
            continue
        row["confidence"] = max(0.05, _default_row_confidence(row) * pen)
        _confidence_reason_add(row, "below_spec_minimum_penalty")
        if use_soft:
            _confidence_reason_add(row, "format_adjustment")
        any_hit = True
    if any_hit:
        balance_flags.append("meets_assignment_minimum false (PASS 0) — confidence reduced")


def _apply_confidence_final_boost_and_floor(rows: List[Dict[str, Any]]) -> None:
    """
    Small boost when fair minimum is clearly met; global floor so stacked penalties do not collapse confidence.
    """
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "?")
        ach = bool(row.get("achieved"))
        if not ach:
            _confidence_reason_add(row, "criterion_not_achieved")
            logger.info(
                "SPEC_MIN_CHECK code=%s achieved=False reasons=%s",
                code,
                row.get("confidence_reason") or [],
            )
            continue
        if isinstance(row.get("confidence"), (int, float)):
            prior_reasons = {
                str(x) for x in (row.get("confidence_reason") or []) if str(x).strip()
            }
            meets = row.get("meets_assignment_minimum") is True
            if meets:
                _confidence_reason_add(row, "meets_assignment_minimum")
                row["confidence"] = min(1.0, float(row["confidence"]) * 1.10)
                _confidence_reason_add(row, "meets_minimum_boost")
            if meets and (
                {"thin_evidence_penalty", "weak_validated_evidence"} & prior_reasons
            ):
                row["confidence"] = min(1.0, float(row["confidence"]) * 1.10)
                _confidence_reason_add(row, "flexible_minimum_recovery")
        c = row.get("confidence")
        if not isinstance(c, (int, float)):
            continue
        c_before = float(c)
        floor = 0.48 if row.get("meets_assignment_minimum") is True else 0.35
        row["confidence"] = max(floor, min(1.0, c_before))
        if c_before < floor - 1e-9:
            _confidence_reason_add(row, "confidence_floor")
        c3 = row.get("confidence")
        logger.info(
            "SPEC_MIN_CHECK code=%s achieved=%s meets_min=%s conf=%.2f reasons=%s",
            code,
            ach,
            row.get("meets_assignment_minimum"),
            float(c3) if isinstance(c3, (int, float)) else -1.0,
            row.get("confidence_reason") or [],
        )


# --- Consistency validation (post-grading) ---------------------------------

_RE_NEG_PASS_EN = re.compile(
    r"\b(partial|partly|basic|limited|unclear|superficial|insufficient|minimal|weak|marginal)\b",
    re.IGNORECASE,
)
_RE_NEG_PASS_AR = re.compile(
    r"(جزئي|محدود|بسيط|غير واضح|سطحي|محدودة|نقص|ضعيف|شبه|غير كاف|ضعف)",
    re.IGNORECASE,
)

_RE_D1_JUDGEMENT = re.compile(
    r"\b(justif\w*|judg\w*|weigh\w*|evaluat\w*|recommend\w*|reason\w*|merit\w*|demerit\w*|\bstrength\w*|\bweakness\w*|trade-?off)\b",
    re.IGNORECASE,
)
_RE_D1_COMPARE = re.compile(
    r"\b(compar\w*|contrast\w*|versus|differ(ence|ent|ently)?\b|between|than\b|alternativ\w*\b|compared|relative\s+to)\b",
    re.IGNORECASE,
)
_RE_D1_CONCLUDE = re.compile(
    r"\b(conclud\w*|therefore|overall|thus|as a result|finally|in summary|implicat\w*)\b",
    re.IGNORECASE,
)
_RE_D1_J_AR = re.compile(
    r"(تبرير|تقييم|حكم|ميزان|نقاط القوة|نقاط الضعف|التوصية|المزايا|العيوب)",
    re.IGNORECASE,
)
_RE_D1_C_AR = re.compile(r"(مقارنة|مقارن|مقابلة|تضارب|مقارنة بين|بالمقارنة|في المقابل)", re.IGNORECASE)
_RE_D1_E_AR = re.compile(r"(استنتاج|الخلاصة|بشكل عام|لذلك|في النهاية|النتيجة|يمكن القول)", re.IGNORECASE)

MIN_EVIDENCE_CHARS_STRICT = 20  # legacy default; per-format use min_evidence_chars_for_weak_check()


def _achieved_justification_contradiction(justification: str) -> bool:
    t = (justification or "").strip()
    if not t:
        return False
    t2 = re.sub(
        r"\bnot\s+(a\s+)?(partial|unclear|limited|basic|weak|superficial|minimal|marginal)\b",
        " ",
        t,
        flags=re.IGNORECASE,
    )
    t2 = re.sub(
        r"\b(لا|ليس|غير)\s+.{0,20}(واضح|محدود|جزئي|ضعيف|سطحي)\b",
        " ",
        t2,
    )
    return bool(_RE_NEG_PASS_EN.search(t2) or _RE_NEG_PASS_AR.search(t2))


def _evidence_list_weak(evidence: Any, submission_format: str = "mixed") -> bool:
    if not isinstance(evidence, list) or not evidence:
        return True
    total = 0
    for x in evidence:
        if isinstance(x, str):
            total += len(x.strip())
        elif isinstance(x, dict):
            total += len(str(x.get("quote") or x.get("text") or "").strip())
    return total < int(min_evidence_chars_for_weak_check(submission_format))


def _collect_consistency_diagnostics(
    rows: List[Dict[str, Any]],
    *,
    part_names: List[str],
    ev_sources: List[str],
) -> List[str]:
    """
    Informational / optional. Multi-file **soft** bias is recorded in `balance_flags`
    (see `_apply_multi_file_single_source_soft_bias`); not duplicated here.
    """
    return []


def _apply_multi_file_single_source_soft_bias(
    rows: List[Dict[str, Any]],
    part_names: List[str],
    ev_sources: List[str],
    balance_flags: List[str],
) -> None:
    """
    If the submission has multiple [FILE: …] parts but **validated** evidence quotes
    all map to a single `source_file`, do **not** fail M/D. Reduce confidence and flag
    (fair when the student’s strong work is concentrated in one file).
    """
    if len(part_names) < 2:
        return
    u = {x for x in ev_sources if x}
    if len(u) != 1 or not u:
        return
    balance_flags.append("multi-file bias (soft)")
    msg = (
        " [Note: multiple source files in the submission, but verifiable evidence quotes "
        "are from one file only; confidence nudged down—does not on its own remove achievement.]"
    )
    for row in rows:
        if not isinstance(row, dict) or not bool(row.get("achieved")):
            continue
        if _tier(str(row.get("code") or "")) not in ("M", "D"):
            continue
        row["confidence"] = max(0.05, _default_row_confidence(row) * 0.85)
        _confidence_reason_add(row, "multi_file_m_d_bias")
        j = str(row.get("justification") or "").strip()
        if msg not in j:
            row["justification"] = (j + msg).strip()
    logger.info(
        "[MULTI-FILE SOFT] %s file parts, evidence from single file %s; M/D confidence *0.85",
        part_names,
        u,
    )


def _post_process_grader_dict(
    out: Dict[str, Any],
    *,
    sw: str,
    p1: Dict[str, Any],
    submission_format: str = "mixed",
    assignment_spec: Optional[Dict[str, Any]] = None,
    disable_spec_penalties: bool = False,
    stability_ratio: float = 0.75,
) -> List[str]:
    """
    Apply evidence policy, balanced D1 triad, soft consistency penalties, D1 Pass1 gate, band.
    Returns ev_sources for multi-file heuristics. Populates out["balance_flags"].
    """
    fmt = (submission_format or "mixed").strip() or "mixed"
    out["submission_format"] = fmt
    out["submission_format_label"] = submission_format_label_ar(fmt)

    cr = out.get("criteria_results")
    if not isinstance(cr, list):
        cr = []
    crit_fixed, ev_sources, balance_flags = _apply_evidence_policy(cr, sw, fmt)
    out["criteria_results"] = crit_fixed
    out["files_used"] = list(dict.fromkeys([x for x in ev_sources if x]))[:30]
    pns = list_submission_file_names(sw)
    evset = {x for x in ev_sources if x}
    logger.info("[FILES USED] %s", set(ev_sources))
    out["evidence_diversity_ok"] = len(pns) < 2 or len(evset) >= 2 or len(evset) == 0
    _apply_multi_file_single_source_soft_bias(
        out["criteria_results"],
        pns,
        ev_sources,
        balance_flags,
    )
    _apply_d1_triad_balance(out["criteria_results"], balance_flags)
    _apply_justification_contradiction_balance(out["criteria_results"], balance_flags)
    _apply_thin_evidence_confidence(out["criteria_results"], balance_flags, fmt)
    _apply_meets_spec_minimum_confidence(
        out["criteria_results"],
        assignment_spec,
        fmt,
        balance_flags,
        disable_spec_penalties=disable_spec_penalties,
    )
    out["criteria_results"] = _enforce_d1_evaluation_gate(
        out["criteria_results"],
        _p1_evaluation_detected_optional(p1),
    )
    if out.get("criteria_results"):
        try:
            out["grade_band"] = _compute_band_from_tiers(out["criteria_results"])
        except Exception:
            logger.exception("band recompute failed")
    out["grade_band_stability_applied"] = False
    out["grade_band_upper_guard_applied"] = False
    b0 = out.get("grade_band")
    if isinstance(b0, str) and isinstance(out.get("criteria_results"), list):
        nb, st_applied = stabilize_grade_band(
            out["criteria_results"],
            b0,
            ratio=stability_ratio,
        )
        out["grade_band_stability_applied"] = st_applied
        if st_applied:
            out["grade_band"] = nb
            balance_flags.append(
                f"grade_band_stability_guard (weighted ≥ {stability_ratio:.0%} → not below Pass)"
            )
    gb_mid = out.get("grade_band")
    if isinstance(gb_mid, str) and isinstance(out.get("criteria_results"), list):
        ug, up_applied = upper_guard(out["criteria_results"], gb_mid)
        if up_applied:
            out["grade_band"] = ug
            out["grade_band_upper_guard_applied"] = True
            balance_flags.append("upper_guard (Merit/Distinction requires achieved M/D row)")
        else:
            out["grade_band_upper_guard_applied"] = False
    if isinstance(out.get("criteria_results"), list):
        _apply_confidence_final_boost_and_floor(out["criteria_results"])
        _annotate_confidence_summaries(out["criteria_results"])
    out["balance_flags"] = list(balance_flags)
    return ev_sources


def _call_grader_json(client: OpenAI, user_msg: str) -> Dict[str, Any]:
    resp = client.chat.completions.create(
        model=settings.resolved_openai_assessment_model(),
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_GRADER},
            {"role": "user", "content": user_msg},
        ],
    )
    raw = (resp.choices[0].message.content or "").strip()
    return json.loads(raw)


def _sticky_bucket_0_99(
    user_id: Optional[int],
    assignment_criteria: Optional[str],
    btec_unit: str,
) -> int:
    """Deterministic 0-99 from user + assignment (unit + criteria hash) for stable split cohort."""
    ac = (assignment_criteria or "").strip()
    bu = (btec_unit or "").strip()
    uid = int(user_id) if user_id is not None else 0
    ac_fp = hashlib.sha256(ac.encode("utf-8")).hexdigest()[:32]
    msg = f"v1|uid={uid}|unit={bu}|ac={ac_fp}"
    h = int(hashlib.sha256(msg.encode("utf-8")).hexdigest(), 16)
    return h % 100


def _grader_use_split_path(
    user_id: Optional[int],
    assignment_criteria: Optional[str],
    btec_unit: str,
) -> bool:
    if getattr(settings, "ASSESSMENT_GRADER_FORCE_SINGLE_MODE", False):
        return False
    if getattr(settings, "ASSESSMENT_GRADER_FORCE_SPLIT_MODE", False):
        return True
    if not getattr(settings, "ASSESSMENT_GRADER_SPLIT_ENABLED", False):
        return False
    try:
        rp = int(get_effective_split_rollout_percent())
    except (TypeError, ValueError):
        rp = 0
    rp = max(0, min(100, rp))
    if rp <= 0:
        return False
    if rp >= 100:
        return True
    b = _sticky_bucket_0_99(user_id, assignment_criteria, btec_unit)
    return b < rp


def _shadow_rate_limit_ok() -> bool:
    """True if we may start one more shadow this minute (reserves a slot)."""
    try:
        cap = int(getattr(settings, "ASSESSMENT_AB_SHADOW_MAX_PER_MINUTE", 30) or 0)
    except (TypeError, ValueError):
        cap = 30
    if cap <= 0:
        return True
    with _shadow_rl_lock:
        now = time.monotonic()
        while _shadow_timestamps and (now - _shadow_timestamps[0]) > 60.0:
            _shadow_timestamps.popleft()
        if len(_shadow_timestamps) >= cap:
            return False
        _shadow_timestamps.append(now)
        return True


def _should_run_async_shadow() -> bool:
    """AB_TRACKING + MAX_SHADOW_% subsample + per-minute cap."""
    if not getattr(settings, "ASSESSMENT_AB_TRACKING_ENABLED", False):
        return False
    try:
        sp = int(getattr(settings, "ASSESSMENT_AB_MAX_SHADOW_PERCENT", 0) or 0)
    except (TypeError, ValueError):
        sp = 0
    if sp <= 0:
        return False
    if sp < 100 and random.uniform(0, 100) >= float(sp):
        return False
    if not _shadow_rate_limit_ok():
        logger.info("grader_ab shadow skipped: per-minute cap")
        return False
    return True


def _shadow_grader_task(api_key: str, user_msg: str, split_out: Dict[str, Any]) -> None:
    try:
        client = OpenAI(api_key=api_key)
        single_out = _call_grader_json(client, user_msg)
        record_grader_ab_pair(single_out, split_out)
    except Exception:
        logger.exception("grader A/B async shadow single failed")


def _call_grader_json_split_stages(client: OpenAI, user_msg: str) -> Dict[str, Any]:
    """
    Stage 1: chat model, compact JSON (SYSTEM_GRADER_SKELETON).
    Stage 2: assessment model, full schema (SYSTEM_GRADER).
    """
    s1 = client.chat.completions.create(
        model=settings.resolved_openai_chat_model(),
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_GRADER_SKELETON},
            {
                "role": "user",
                "content": user_msg
                + "\n\nRespond with JSON only: compact per-criterion skeleton (see system instructions).",
            },
        ],
    )
    sk = (s1.choices[0].message.content or "").strip()
    s2u = (
        "Stage-1 compact grading JSON (structured reasoning; not the final API payload):\n"
        f"{sk}\n\n"
        "Now output the **full** assessment object defined in the system instructions. "
        "Evidence `quote` values must be **exact** substrings of the student work in this message. "
        "Re-read PASS0/PASS1 and the student work for consistency. Do not invent quotes.\n\n"
        f"{user_msg}"
    )
    s2 = client.chat.completions.create(
        model=settings.resolved_openai_assessment_model(),
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_GRADER},
            {"role": "user", "content": s2u},
        ],
    )
    return json.loads((s2.choices[0].message.content or "").strip())


def _call_grader_json_routed(
    client: OpenAI,
    user_msg: str,
    *,
    user_id: Optional[int] = None,
    assignment_criteria: Optional[str] = None,
    btec_unit: str = "",
) -> Dict[str, Any]:
    """
    Sticky split cohort: same user+assignment+unit → same 0-99 bucket vs ROLLOUT_PERCENT.
    Returns split (or single) to caller immediately. Optional shadow single runs in a daemon thread
    (subsampled + rate-limited) and persists A/B to JSON store.
    """
    if not _grader_use_split_path(user_id, assignment_criteria, btec_unit):
        return _call_grader_json(client, user_msg)
    try:
        split_out = _call_grader_json_split_stages(client, user_msg)
    except Exception:
        logger.exception("split grader failed; falling back to single grader call")
        return _call_grader_json(client, user_msg)
    if _should_run_async_shadow():
        key = (settings.OPENAI_API_KEY or "").strip()
        if key:
            threading.Thread(
                target=_shadow_grader_task,
                args=(key, user_msg, split_out),
                daemon=True,
                name="grader_ab_shadow",
            ).start()
    return split_out


def compute_btec_final_band_from_results(results: List[Dict[str, Any]]) -> str:
    """Public API: map per-criterion achieved flags to Pass / Merit / Distinction / Not yet achieved."""
    return _compute_band_from_tiers(results)


def _compute_band_from_tiers(
    results: List[Dict[str, Any]],
) -> str:
    """
    P fail → Not yet achieved. P ok + M fail → Pass. P ok + M ok + D fail → Merit. All in scope achieved →
    Distinction if D present, else Merit if M present, else Pass. If there are no P but M only: M fail → Not yet.
    """
    by: Dict[str, List[Dict[str, Any]]] = {"P": [], "M": [], "D": []}
    for r in results:
        c = str(r.get("code") or "")
        t = _tier(c)
        if t in by:
            by[t].append(r)

    def all_ach(rows: List[Dict[str, Any]]) -> bool:
        return not rows or all(bool(x.get("achieved")) for x in rows)

    p, m, d = by["P"], by["M"], by["D"]
    p_ok, m_ok, d_ok = (all_ach(p), all_ach(m), all_ach(d))

    if p and not p_ok:
        return "Not yet achieved"
    if m and not m_ok:
        return "Pass" if p else "Not yet achieved"
    if d and not d_ok:
        return "Merit"
    if d and d_ok:
        return "Distinction"
    if m and m_ok:
        return "Merit"
    if p and p_ok:
        return "Pass"
    return "Pass"


def _empty_ctx() -> Dict[str, str]:
    return {
        "scenario": "",
        "task": "",
        "expected_outcomes": "",
        "criteria_summary": "",
    }


def _short_work_payload(
    *,
    btec_unit: str,
    student_work: str,
    assignment_criteria: Optional[str],
) -> Dict[str, Any]:
    ac = (assignment_criteria or "").strip()
    codes = _extract_codes(ac)
    crit_ext = [{"code": c, "description": "Stated in assignment criteria."} for c in codes] if codes else []
    crit_res = []
    for c in codes:
        crit_res.append(
            {
                "code": c,
                "achieved": False,
                "justification": (
                    "The submission is below the minimum length required to demonstrate achievement "
                    f"across the criteria. Word count: {_word_count(student_work)} (minimum {MIN_WORDS_STRICT})."
                ),
                "why_higher_tier_excluded": "N/A: insufficient length; higher tiers not evidenced.",
                "observed_cognitive_level": "describe",
                "evidence": [],
                "evidence_items": [],
            }
        )
    if not crit_res and not crit_ext:
        crit_undet = not bool(ac)
    else:
        crit_undet = len(codes) == 0
    sub_fmt = detect_submission_format((student_work or "").strip())
    return {
        "error": None,
        "grade_band": "Not yet achieved",
        "rationale": (
            f"The response is under {MIN_WORDS_STRICT} words. BTEC requires sufficient evidence; "
            "all listed criteria are marked as not achieved until the student expands their work with verifiable content."
        ),
        "strengths": [],
        "improvements": ["Resubmit with enough depth and length to address each required criterion with clear evidence."],
        "cited_sources": [],
        "assignment_context": _empty_ctx() if not ac else {**_empty_ctx(), "criteria_summary": ac[:2000]},
        "criteria_extracted": crit_ext,
        "criteria_results": crit_res,
        "criteria_undetected": crit_undet,
        "files_used": [],
        "submission_format": sub_fmt,
        "submission_format_label": submission_format_label_ar(sub_fmt),
        "student_feedback": generate_student_feedback(crit_res, submission_format=sub_fmt),
        "student_improvement": None,
    }


def _trim_context(s: str, max_chars: int) -> str:
    t = (s or "").strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1] + "…"


def _build_compacted_reference_context(
    hits: List[Any],
    *,
    max_context_chars: int,
    per_block_max: int,
) -> str:
    """
    Trims *retrieved* reference text only (not student submission). Cuts RAG ref tokens
    by per-block and global caps so meaning is preserved for diverse sources.
    """
    if not hits:
        return ""
    per_block_max = max(200, int(per_block_max))
    ref_blocks: List[str] = []
    for h in hits:
        src = (h.metadata or {}).get("source_file") or h.source_id or "unknown"
        body = (h.content or "").strip()
        if len(body) > per_block_max:
            body = body[: per_block_max - 1] + "…"
        ref_blocks.append(f"[Source: {src}]\n{body}")
    joined = "\n\n---\n\n".join(ref_blocks)
    return _trim_context(joined, max(500, int(max_context_chars)))


def assess_btec_rag(
    *,
    btec_unit: str,
    student_work: str,
    assignment_criteria: Optional[str] = None,
    metadata_filter: Optional[Dict[str, Any]] = None,
    academic_context: Optional[Dict[str, Any]] = None,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    settings.require_openai()
    clear_spec_request_dedup()
    sw = (student_work or "").strip()
    if len(sw) < 5:
        out_short: Dict[str, Any] = {
            "error": "student_work is too short",
            "grade_band": "Not yet achieved",
            "rationale": "",
            "files_used": [],
            "student_feedback": [],
            "student_improvement": None,
        }
        apply_dual_output(out_short)
        return out_short

    if _word_count(sw) < MIN_WORDS_STRICT:
        out = _short_work_payload(
            btec_unit=btec_unit,
            student_work=sw,
            assignment_criteria=assignment_criteria,
        )
        apply_dual_output(out)
        return out

    vs = get_vector_service()
    vs.ensure_schema()
    preview = re.sub(r"\s+", " ", sw)[:2000]
    q = f"BTEC {btec_unit}\n{preview}"
    top_k = max(1, min(20, settings.ASSESSMENT_RETRIEVAL_TOP_K))
    rag_top = min(5, top_k)
    norm = normalize_academic_context(academic_context)
    filter_chain, academic_for_grader = build_metadata_filter_chain_for_norm(norm)
    subj_key = (academic_for_grader or {}).get("subject_key", "general") or "general"

    extra = (assignment_criteria or "").strip()
    ch = _extract_codes(extra) if extra else []
    code_hints = ch if ch else None
    g_model = settings.resolved_openai_assessment_model()
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    def _job_retrieval() -> Tuple[List[Any], Optional[Dict[str, Any]]]:
        h: List[Any] = []
        uf: Optional[Dict[str, Any]] = None
        pls = build_rag_search_plans(academic_context, normalized=norm)
        if pls:
            try:
                rsvc = get_rag_documents_service()
                rsvc.ensure_schema()
                rh, ur = rsvc.search_first_matching_plan(
                    q, pls, top_k=rag_top, fallback_query=preview
                )
                if rh:
                    h = rh
                    uf = {"source": "rag_documents", "filters": ur or {}}
            except Exception as e:
                logger.warning("rag_documents retrieval failed, using embedding_chunks: %s", e)
        if not h:
            for raw_f in filter_chain:
                mf = merge_jsonb_metadata_filters(raw_f, metadata_filter)
                h = vs.search(q, top_k=top_k, metadata_filter=mf)
                if not h and preview:
                    h = vs.search(preview, top_k=top_k, metadata_filter=mf)
                if h:
                    uf = mf
                    break
        if not h and metadata_filter:
            h = vs.search(q, top_k=top_k, metadata_filter=metadata_filter)
            if not h:
                h = vs.search(preview, top_k=top_k, metadata_filter=metadata_filter)
            if h:
                uf = metadata_filter
        if not h:
            h = vs.search(q, top_k=top_k, metadata_filter=None)
            if not h:
                h = vs.search(preview, top_k=top_k, metadata_filter=None)
        if h:
            rt0 = (h[0].metadata or {}).get("rag_table")
            if not rt0 and subj_key and subj_key != "general":
                h = apply_subject_boost(h, subj_key, 0.2)
        return h, uf

    def _job_pass0() -> Any:
        return run_assignment_spec_pass(
            client,
            g_model,
            btec_unit=btec_unit,
            assignment_criteria=extra,
            code_hints=code_hints,
        )

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_ret = ex.submit(_job_retrieval)
        f_p0 = ex.submit(_job_pass0)
        hits, used_filter = f_ret.result()
        spec0 = f_p0.result()

    try:
        ref_frac = float(getattr(settings, "ASSESSMENT_RAG_REF_CONTEXT_FRACTION", 0.62) or 0.62)
    except (TypeError, ValueError):
        ref_frac = 0.62
    ref_frac = max(0.35, min(1.0, ref_frac))
    ref_budget = int(float(settings.ASSESSMENT_MAX_CONTEXT_CHARS) * ref_frac)
    try:
        per_blk = int(getattr(settings, "ASSESSMENT_RAG_REF_PER_BLOCK_MAX_CHARS", 3200) or 3200)
    except (TypeError, ValueError):
        per_blk = 3200
    context = _build_compacted_reference_context(
        hits,
        max_context_chars=ref_budget,
        per_block_max=per_blk,
    )
    rag_table = (hits[0].metadata or {}).get("rag_table") if hits else None
    ac_block = f"\n\nAssessor / assignment notes:\n{extra}\n" if extra else "\n"
    scope = format_academic_scoping_for_grader(norm, academic_for_grader)
    scope_block = f"\n{scope}\n" if scope else ""
    logger.info(
        "PASS0 assignment spec: ok=%s criteria_keys=%d",
        spec0.get("assignment_spec_ok"),
        len(spec0.get("criteria") or {}) if isinstance(spec0.get("criteria"), dict) else 0,
    )
    part_names = list_submission_file_names(sw)
    sub_fmt = detect_submission_format(sw)
    enrich_spec_with_submission_format(spec0, sub_fmt)
    spec_quality = float(compute_spec_quality(spec0))
    student_level, relax_thresholds = _resolve_student_level(academic_context, academic_for_grader)
    spec_penalties_disabled = spec_quality < _spec_penalties_threshold(relax_thresholds)
    stability_ratio = _stability_ratio(relax_thresholds)
    p1 = _run_understanding_pass(client, g_model, sw)
    logger.info(
        "PASS1 understanding: evaluation_detected=%s analysis_detected=%s",
        p1.get("evaluation_detected"),
        p1.get("analysis_detected"),
    )
    p1_blob = json.dumps(
        {
            "summary": p1.get("summary", "")[:2000],
            "analysis_detected": p1.get("analysis_detected"),
            "evaluation_detected": p1.get("evaluation_detected"),
            "key_points": p1.get("key_points", [])[:7],
        },
        ensure_ascii=False,
    )
    p1_block = f"[PASS 1 — DOCUMENT UNDERSTANDING]\n{p1_blob}\n"
    spec0_blob = spec_blob_for_grader(spec0)
    pass0_block = f"[PASS 0 — ASSIGNMENT SPECIFICATION]\n{spec0_blob}\n"
    fmt_block = grader_block_for_submission_format(sub_fmt)
    name_hint = (
        "File parts in this submission (use these exact source_file values in every evidence object): "
        + ", ".join(f'\"{n}\"' for n in part_names)
        if part_names
        else "(Single submission block; use \"submission\" for source_file if not split.)"
    )
    user_msg = f"""{pass0_block}{p1_block}{fmt_block}
BTEC unit / module: {btec_unit}
{scope_block}{ac_block}
{name_hint}

--- Reference excerpts (for marking) ---
{context if context else "(No retrieved excerpts — assess conservatively; evidence from references is limited.)"}
--- End references ---

--- Student work (verbatim) ---
{sw}
--- End student work ---

Respond with JSON only. criteria_extracted must list every P/M/D code from the assignment notes above, with descriptions.
When PASS 0 lists `minimum_acceptable` for a code, use it to judge whether Pass-level work is **fairly** met before demanding more.
If the assignment text does not include explicit P/M/D labels, still infer from numbered outcomes if clearly equivalent to BTEC style; otherwise set criteria_undetected to true and criteria_extracted may be empty.
If evaluation_detected in PASS 1 is false, you must not award D1 (set achieved false for D1).
If evaluation_detected is null (understanding pass unavailable or inconclusive), do not award D1 unless the grade row shows exceptional evaluative depth (trade-offs, stakeholders, impact/risk) with strong student evidence; otherwise set achieved false for D1."""

    regraded = False
    out: Dict[str, Any]
    try:
        out = _call_grader_json_routed(
            client,
            user_msg,
            user_id=user_id,
            assignment_criteria=extra,
            btec_unit=btec_unit,
        )
    except Exception as e:
        logger.exception("assessment call failed: %s", e)
        err_out: Dict[str, Any] = {
            "error": str(e),
            "grade_band": "Not yet achieved",
            "rationale": "Grading could not be completed. Check logs and API configuration.",
            "files_used": [],
            "student_feedback": [],
            "student_improvement": None,
        }
        apply_dual_output(err_out)
        return err_out

    if not isinstance(out, dict):
        inv: Dict[str, Any] = {
            "error": "Invalid model output",
            "grade_band": "Not yet achieved",
            "rationale": "Invalid model output",
            "files_used": [],
            "student_feedback": [],
            "student_improvement": None,
        }
        apply_dual_output(inv)
        return inv

    ev_src = _post_process_grader_dict(
        out,
        sw=sw,
        p1=p1,
        submission_format=sub_fmt,
        assignment_spec=spec0,
        disable_spec_penalties=spec_penalties_disabled,
        stability_ratio=stability_ratio,
    )
    out["spec_quality"] = spec_quality
    out["spec_penalties_disabled"] = spec_penalties_disabled
    out["student_level"] = student_level
    out["relax_thresholds"] = relax_thresholds
    _add_criterion_achievement_momentum(out, stability_ratio=stability_ratio)
    oc = _compute_overall_confidence(out.get("criteria_results"))
    if oc is not None:
        out["overall_confidence"] = oc
    out["audit"] = _build_audit_payload(
        out,
        spec_quality=spec_quality,
        spec_penalties_disabled=spec_penalties_disabled,
        student_level=student_level,
    )
    balance = list(out.get("balance_flags") or [])
    diag = _collect_consistency_diagnostics(
        out.get("criteria_results") or [],
        part_names=part_names,
        ev_sources=ev_src,
    )
    all_flags = list(dict.fromkeys([*balance, *diag]))

    if isinstance(out, dict):
        out["consistency_validation"] = {
            "regraded_once": regraded,
            "autocorrected": False,
            "uncertain_grading": False,
            "flags": all_flags,
        }

    # Ensure optional structure keys exist
    if "assignment_context" not in out or not isinstance(out.get("assignment_context"), dict):
        out["assignment_context"] = _empty_ctx()
    if "criteria_extracted" not in out or not isinstance(out.get("criteria_extracted"), list):
        out["criteria_extracted"] = []
    if "criteria_undetected" not in out:
        out["criteria_undetected"] = len(out.get("criteria_extracted") or []) == 0 and not (extra and _CODE_RE.search(extra))

    out["assignment_spec"] = spec0
    out["retrieval"] = {
        "chunks_used": len(hits),
        "sources": list(
            dict.fromkeys(
                (h.metadata or {}).get("source_file") or h.source_id or "?" for h in hits
            )
        )[:20],
        "academic_context": norm or None,
        "academic_inferred": academic_for_grader or None,
        "metadata_filter_applied": used_filter,
        "rag_table": (hits[0].metadata or {}).get("rag_table") if hits else None,
    }
    try:
        out["student_feedback"] = generate_student_feedback(
            out.get("criteria_results") or [],
            submission_format=sub_fmt,
            format_mismatch_message=str(spec0.get("format_mismatch_message") or "")
            if spec0.get("format_mismatch")
            else None,
        )
    except Exception:
        logger.exception("generate_student_feedback failed")
        out["student_feedback"] = []
    try:
        maybe_attach_student_improvement(out, sw, user_id=user_id, memory_scope_key=subj_key)
    except Exception:
        logger.exception("maybe_attach_student_improvement failed")
        out["student_improvement"] = None
    try:
        apply_dual_output(out)
    except Exception:
        logger.exception("apply_dual_output failed")
    return out
