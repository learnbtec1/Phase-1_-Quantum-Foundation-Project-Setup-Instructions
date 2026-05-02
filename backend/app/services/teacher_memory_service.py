# -*- coding: utf-8 -*-
"""
Learns *soft* rewrite preferences from teacher edits (word-level diff + pattern tags).
Per-teacher table + **global** aggregated memory (all teachers) with subject-scoped buckets.
Does not affect BTEC criteria grading — only enriches optional guided-rewrite prompt hints.
"""
from __future__ import annotations

import difflib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import psycopg
from psycopg.rows import dict_row

from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_EVENT_FIELD_CHARS = 32_000

# Aggregated store for all teachers. "__global__" = every event; other keys = subject / assignment_type buckets.
GLOBAL_SCOPE = "__global__"

# Tokenization: split on whitespace; keeps Arabic/English mixed work reasonable
_WS_SPLIT = re.compile(r"\s+")

# Pairs of patterns that are pedagogically hard to follow together; resolve by weight (tie → drop both).
CONFLICTING_PATTERN_GROUPS: Tuple[Tuple[str, ...], ...] = (("tighten_wording", "general_expansion"),)

# Arabic short lines for UI (explainability) — same keys as PATTERN_REWRITE_INSTRUCTIONS.
PATTERN_EXPLAIN_AR: Dict[str, str] = {
    "add_reason": "أسلوب تعلّم: تعزيز ربط السبب/النتيجة عندما يسمح نص الطالب",
    "add_cause_effect": "أسلوب تعلّم: إبراز أثر/علاقة سببية دون اختراع معلومات",
    "add_example": "أسلوب تعلّم: دعوة خفيفة لإعطاء مثال يناسب مستوى الطالب",
    "clarify_term": "أسلوب تعلّم: توضيح مفهوم بصياغة بسيطة",
    "add_judgement": "أسلوب تعلّم: إضافة رأي طالبي مع دعم",
    "connect_ideas": "أسلوب تعلّم: ربط الأفكار بجملة وصل بسيطة",
    "tighten_wording": "أسلوب تعلّم: تلخيص دون تغيير المعنى",
    "general_expansion": "أسلوب تعلّم: تطوير فقرة دون مبالغة في الأسلوب",
}

# One English instruction per pattern (rewrite soft hints — not sample text to copy).
PATTERN_REWRITE_INSTRUCTIONS: Dict[str, str] = {
    "add_reason": "When possible, add short because/since style links, only if the student’s own ideas support them.",
    "add_cause_effect": "When possible, add simple cause→effect or impact wording, without inventing new facts.",
    "add_example": "When possible, add a very short example at a student-appropriate level of detail.",
    "clarify_term": "When a term is vague, add a one-line plain clarification in the same voice as the student.",
    "add_judgement": "When appropriate for the target level, add a short student-voice view with a reason.",
    "connect_ideas": "If the draft is choppy, add a simple connective or linking line between ideas that are already there.",
    "tighten_wording": "If the draft is wordy, trim redundancy while preserving the student’s meaning.",
    "general_expansion": "If a part is under-explained, add one short sentence that develops an idea already on the page.",
}

def extract_word_diff(original: str, edited: str) -> Dict[str, Any]:
    """
    Word-level ndiff. Returns added/removed token lists and joined strings for pattern mining.
    """
    a = [w for w in _WS_SPLIT.split((original or "").strip()) if w]
    b = [w for w in _WS_SPLIT.split((edited or "").strip()) if w]
    diff = list(difflib.ndiff(a, b))
    additions: List[str] = [d[2:].strip() for d in diff if d.startswith("+ ")]
    removals: List[str] = [d[2:].strip() for d in diff if d.startswith("- ")]
    add_joined = " ".join(additions)
    rem_joined = " ".join(removals)
    return {
        "added": additions,
        "removed": removals,
        "added_text": add_joined,
        "removed_text": rem_joined,
    }


# --- Pattern inference: logic labels, not literal copy of teacher text ---

PATTERN_RULES: List[Tuple[str, str]] = [
    (r"لأن|لان|لأنّ|بسبب|نظرا ل|because|since|as a result|therefore|thus", "add_reason"),
    (r"مثال|مثلاً|مثلا|for example|e\.g\.|such as|like when", "add_example"),
    (r"أي(ّ)? هو|أي\s+مقصود|يعني|that is|i\.e\.|in other words", "clarify_term"),
    (r"أعتقد|أرى|في رأيي|from my (point of )?view|I think|I believe|in my opinion", "add_judgement"),
    (r"أيضا|كذلك|ولذلك|بالمقابل|وبالتالي|however|on the other hand|furthermore|moreover", "connect_ideas"),
    (r"العلاقة|يؤثر|يؤدّي إلى|affects?|leads? to|impact on", "add_cause_effect"),
]


def infer_patterns(added_text: str, removed_text: str) -> List[str]:
    t = f"{(added_text or '')} {(removed_text or '')}"
    t_lower = t.lower()
    out: List[str] = []
    for rx, name in PATTERN_RULES:
        if re.search(rx, t, re.IGNORECASE) or re.search(rx, t_lower, re.IGNORECASE):
            if name not in out:
                out.append(name)
    if len(removed_text or "") > len(added_text or "") * 1.4 and (removed_text or "").split():
        if "tighten_wording" not in out:
            out.append("tighten_wording")
    if not out and (added_text or "").strip():
        out.append("general_expansion")
    return out


def text_similarity(a: str, b: str) -> float:
    """0–1 character-level ratio; same family as student Style Guard."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return float(difflib.SequenceMatcher(None, a, b).ratio())


def _lexical_richness(s: str) -> float:
    words = [w for w in _WS_SPLIT.split(s.strip().lower()) if w]
    if not words:
        return 0.0
    longish = sum(1 for w in words if len(w) >= 9)
    return longish / len(words)


def _avg_word_len(s: str) -> float:
    words = [w for w in _WS_SPLIT.split(s.strip()) if w]
    if not words:
        return 0.0
    return sum(len(w) for w in words) / len(words)


def is_too_advanced(edited: str, original: str) -> bool:
    """
    Reject when the teacher’s text looks off-level (much denser / more “sophisticated” wording than the original).
    Heuristic: relative jump in long tokens + mean word length, without LLM.
    """
    o0, o1 = (original or "").strip(), (edited or "").strip()
    if not o0 or not o1:
        return False
    lr = _lexical_richness(o1) - _lexical_richness(o0)
    if lr > 0.12:
        return True
    a0, a1 = _avg_word_len(o0), _avg_word_len(o1)
    if a0 > 0 and a1 / a0 > 1.4 and len(o1) >= len(o0) * 0.85:
        return True
    if len(o1) > len(o0) * 2.2 and a1 / max(a0, 0.01) > 1.25:
        return True
    return False


def validate_teacher_edit_quality(
    original: str,
    edited: str,
) -> Dict[str, Any]:
    """
    If this fails, we still log the event but we do **not** update global/per-user style counters.
    """
    o, e = (original or "").strip(), (edited or "").strip()
    sim = text_similarity(o, e)
    min_s = float(getattr(settings, "TEACHER_EDIT_MIN_SIMILARITY", 0.5))
    reasons: List[str] = []
    if sim < min_s:
        reasons.append("low_similarity")
    if is_too_advanced(e, o):
        reasons.append("too_advanced")
    passed = len(reasons) == 0
    return {
        "passed": passed,
        "similarity": round(sim, 4),
        "reasons": reasons,
    }


def _db_url() -> str:
    return (settings.DATABASE_URL or "").strip()


def normalize_memory_scope(raw: Optional[str]) -> str:
    """
    Buckets for subject/assignment: merge empty/generic into global-only bump paths elsewhere.
    """
    t = (raw or "").strip().lower()[:128]
    if not t or t in ("general", "default", "__global__", "global"):
        return GLOBAL_SCOPE
    return t


def count_to_weight(count: Union[int, float]) -> float:
    d = max(1, int(getattr(settings, "TEACHER_MEMORY_WEIGHT_COUNT_DIVISOR", 20)))
    c = max(0.0, float(count))
    return min(1.0, c / float(d))


def ensure_schema() -> None:
    url = _db_url()
    if not url.startswith(("postgresql://", "postgres://")):
        return
    parts = [
        """
    CREATE TABLE IF NOT EXISTS teacher_edit_events (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        original_text TEXT NOT NULL,
        ai_suggestion TEXT NOT NULL,
        teacher_edited_text TEXT NOT NULL,
        grade_band VARCHAR(64) DEFAULT '',
        target_band VARCHAR(64) DEFAULT '',
        assignment_type VARCHAR(128) DEFAULT 'general',
        patterns_json JSONB DEFAULT '[]',
        diff_summary JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
        """
    CREATE TABLE IF NOT EXISTS teacher_style_memory (
        user_id INTEGER NOT NULL,
        pattern VARCHAR(64) NOT NULL,
        frequency INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, pattern)
    )
    """,
        """
    CREATE TABLE IF NOT EXISTS global_teacher_style_memory (
        scope_key VARCHAR(128) NOT NULL,
        pattern VARCHAR(64) NOT NULL,
        frequency INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (scope_key, pattern)
    )
    """,
        """
    CREATE INDEX IF NOT EXISTS idx_teacher_edit_user_created
    ON teacher_edit_events (user_id, created_at DESC)
    """,
        """
    CREATE INDEX IF NOT EXISTS idx_global_teacher_mem_scope
    ON global_teacher_style_memory (scope_key)
    """,
    ]
    try:
        with psycopg.connect(url) as conn:
            for s in parts:
                conn.execute(s.strip())
        logger.info("teacher_memory schema ensured")
    except Exception as e:
        logger.warning("teacher_memory ensure_schema: %s", e)


def _truncate(s: str) -> str:
    t = s or ""
    if len(t) > MAX_EVENT_FIELD_CHARS:
        return t[: MAX_EVENT_FIELD_CHARS - 1] + "…"
    return t


def _scope_keys_for_event(assignment_type: str) -> List[str]:
    """Every edit counts toward global; non-generic types also get a second bucket."""
    keys: List[str] = [GLOBAL_SCOPE]
    sk = normalize_memory_scope(assignment_type)
    if sk != GLOBAL_SCOPE:
        keys.append(sk)
    return list(dict.fromkeys(keys))


def _bump_global_style(cur: Any, scope_keys: List[str], patterns: List[str]) -> None:
    for sk in scope_keys:
        skey = (sk or GLOBAL_SCOPE)[:128]
        for p in patterns:
            pn = (p or "")[:64]
            if not pn:
                continue
            cur.execute(
                """
                INSERT INTO global_teacher_style_memory (scope_key, pattern, frequency, updated_at)
                VALUES (%s, %s, 1, NOW())
                ON CONFLICT (scope_key, pattern) DO UPDATE
                SET frequency = global_teacher_style_memory.frequency + 1, updated_at = NOW()
                """,
                (skey, pn),
            )


def _apply_decay_all_global_frequencies(cur: Any) -> None:
    """Gentle shrink of all global table rows; default factor 1.0 disables."""
    f = float(getattr(settings, "TEACHER_MEMORY_DECAY_ON_VALID_SAVE", 1.0))
    if f >= 0.9999999 or f <= 0.0 or f > 1.0:
        return
    cur.execute(
        """
        UPDATE global_teacher_style_memory
        SET frequency = GREATEST(0, (FLOOR(frequency * %s))::bigint)
        """,
        (f,),
    )


def _dt_utc_aware(du: Any) -> datetime:
    if du is None:
        return datetime.now(timezone.utc)
    if isinstance(du, datetime):
        if du.tzinfo is None:
            return du.replace(tzinfo=timezone.utc)
        return du.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _effective_count(freq: int, row_updated: Any) -> float:
    """Time-based decay: older rows contribute less, without a batch job."""
    per = float(getattr(settings, "TEACHER_MEMORY_TIME_DECAY_PER_30D", 0.98))
    if per >= 0.99999:
        return max(0.0, float(freq))
    now = datetime.now(timezone.utc)
    dt = _dt_utc_aware(row_updated)
    age = max(0.0, (now - dt).total_seconds() / 86400.0)
    return max(0.0, float(freq) * (per ** (age / 30.0)))


def _load_scope_effective_counts(scope_key: str) -> Dict[str, float]:
    """Per-scope effective counts (float) after time decay, summed by pattern for that scope only."""
    sk = (scope_key or GLOBAL_SCOPE)[:128]
    out: Dict[str, float] = {}
    ensure_schema()
    url = _db_url()
    if not url.startswith(("postgresql://", "postgres://")):
        return out
    try:
        with psycopg.connect(url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT pattern, frequency, updated_at
                    FROM global_teacher_style_memory
                    WHERE scope_key = %s
                    """,
                    (sk,),
                )
                rows = cur.fetchall()
    except Exception as e:
        logger.warning("load scope %s: %s", sk, e)
        return out
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        p, fq, u = r.get("pattern"), r.get("frequency"), r.get("updated_at")
        if p is None or not isinstance(fq, (int, float)):
            continue
        eff = _effective_count(int(fq), u)
        ps = str(p)
        out[ps] = out.get(ps, 0.0) + eff
    return out


def save_teacher_edit(
    *,
    user_id: int,
    original_text: str,
    ai_suggestion: str,
    teacher_edited_text: str,
    grade_band: str = "Pass",
    target_band: str = "Merit",
    assignment_type: str = "general",
) -> Dict[str, Any]:
    """
    Store one edit session + update per-teacher pattern frequencies + **global** (all teachers) scoped counts.
    """
    o = _truncate(original_text)
    ai = _truncate(ai_suggestion)
    te = _truncate(teacher_edited_text)
    diff = extract_word_diff(o, te)
    patterns = infer_patterns(diff.get("added_text") or "", diff.get("removed_text") or "")
    qc = validate_teacher_edit_quality(o, te)
    ts = datetime.now(timezone.utc).isoformat()
    out: Dict[str, Any] = {
        "ok": True,
        "record": {
            "grade_band": grade_band,
            "target_band": target_band,
            "assignment_type": assignment_type,
            "timestamp": ts,
            "patterns": patterns,
            "quality_passed": qc.get("passed"),
            "quality": qc,
        },
    }
    diff_summary: Dict[str, Any] = {
        "added_tokens": (diff.get("added") or [])[:200],
        "removed_tokens": (diff.get("removed") or [])[:200],
        "quality_control": qc,
    }
    ensure_schema()
    url = _db_url()
    if not url.startswith(("postgresql://", "postgres://")):
        out["ok"] = False
        out["error"] = "database_unavailable"
        out["message"] = "DATABASE_URL not set or not PostgreSQL."
        return out
    try:
        scope_keys = _scope_keys_for_event(assignment_type)
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO teacher_edit_events (
                        user_id, original_text, ai_suggestion, teacher_edited_text,
                        grade_band, target_band, assignment_type, patterns_json, diff_summary
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb
                    )
                    """,
                    (
                        user_id,
                        o,
                        ai,
                        te,
                        grade_band[:64],
                        target_band[:64],
                        assignment_type[:128],
                        json.dumps(patterns),
                        json.dumps(diff_summary),
                    ),
                )
                if qc.get("passed"):
                    _apply_decay_all_global_frequencies(cur)
                    for p in patterns:
                        cur.execute(
                            """
                            INSERT INTO teacher_style_memory (user_id, pattern, frequency, updated_at)
                            VALUES (%s, %s, 1, NOW())
                            ON CONFLICT (user_id, pattern) DO UPDATE
                            SET frequency = teacher_style_memory.frequency + 1, updated_at = NOW()
                            """,
                            (user_id, p[:64]),
                        )
                    _bump_global_style(cur, scope_keys, patterns)
    except Exception as e:
        logger.exception("save_teacher_edit: %s", e)
        out["ok"] = False
        out["error"] = str(e)
    else:
        if out.get("ok") and qc.get("passed"):
            out["record"]["global_scopes_bumped"] = _scope_keys_for_event(assignment_type)
        elif out.get("ok") and not qc.get("passed"):
            out["record"]["global_scopes_bumped"] = []
    return out


def load_pattern_counts(user_id: int) -> Dict[str, int]:
    ensure_schema()
    url = _db_url()
    if not url.startswith(("postgresql://", "postgres://")):
        return {}
    try:
        with psycopg.connect(url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pattern, frequency FROM teacher_style_memory WHERE user_id = %s",
                    (user_id,),
                )
                rows = cur.fetchall()
    except Exception as e:
        logger.warning("load_pattern_counts: %s", e)
        return {}
    out: Dict[str, int] = {}
    for r in rows or []:
        if isinstance(r, dict):
            p, f = r.get("pattern"), r.get("frequency")
        else:
            p, f = r[0], r[1]
        if p is not None and isinstance(f, (int, float)):
            out[str(p)] = int(f)
    return out


def load_merged_memory_for_rewrite(memory_scope: Optional[str] = None) -> Dict[str, Dict[str, float]]:
    """
    Blended **weights** (global + subject) with per-pattern cap, time-scoped effective counts.
    Returns { pattern: { "count": n, "weight": w } }.
    - Subject (material) is weighted more than __global__ when a subject scope exists and has any signal.
    """
    sk = normalize_memory_scope(memory_scope)
    cg = _load_scope_effective_counts(GLOBAL_SCOPE)
    cs: Dict[str, float] = {}
    if sk != GLOBAL_SCOPE:
        cs = _load_scope_effective_counts(sk)
    g_blend = float(getattr(settings, "TEACHER_MEMORY_BLEND_GLOBAL", 0.4))
    s_blend = float(getattr(settings, "TEACHER_MEMORY_BLEND_SUBJECT", 0.6))
    s_sum = sum(cs.values()) if cs else 0.0
    subj_has_signal = s_sum > 1e-9
    w_cap = float(getattr(settings, "TEACHER_MEMORY_MAX_PATTERN_WEIGHT", 0.85))
    tot_b = g_blend + s_blend
    if tot_b > 0:
        g_blend, s_blend = g_blend / tot_b, s_blend / tot_b
    all_p = set(cg) | set(cs)
    out: Dict[str, Dict[str, float]] = {}
    for p in all_p:
        w_g = count_to_weight(cg.get(p, 0.0))
        w_s = count_to_weight(cs.get(p, 0.0)) if subj_has_signal else 0.0
        if not subj_has_signal or sk == GLOBAL_SCOPE:
            w0 = w_g
        else:
            w0 = w_g * g_blend + w_s * s_blend
        wfin = min(w_cap, max(0.0, w0))
        n_disp = float(cg.get(p, 0.0) + (cs.get(p, 0.0) if subj_has_signal else 0.0))
        out[p] = {"count": n_disp, "weight": wfin}
    return out


def get_active_patterns(
    memory: Dict[str, Dict[str, Any]],
    *,
    min_weight: Optional[float] = None,
) -> Dict[str, Dict[str, Any]]:
    if not memory:
        return {}
    floor = min_weight
    if floor is None:
        floor = float(getattr(settings, "TEACHER_MEMORY_MIN_WEIGHT", 0.4))
    return {k: v for k, v in memory.items() if float(v.get("weight", 0.0)) >= floor}


def _resolve_conflicting_patterns(
    active: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """If two incompatible patterns (e.g. tighten vs expand) are both active, keep the higher weight; tie → drop both."""
    out = dict(active)
    for group in CONFLICTING_PATTERN_GROUPS:
        present: List[str] = [p for p in group if p in out]
        if len(present) < 2:
            continue
        weights = [(p, float(out[p].get("weight", 0.0))) for p in present]
        weights.sort(key=lambda x: -x[1])
        best_p, best_w = weights[0]
        second = weights[1][1] if len(weights) > 1 else -1.0
        for p in present:
            del out[p]
        if best_w > second and abs(best_w - second) > 1e-6:
            out[best_p] = active[best_p]
    return out


def _active_ordered_patterns(
    memory: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Tuple[str, Dict[str, Any]]]:
    if not memory:
        return []
    active = get_active_patterns(memory)
    active = _resolve_conflicting_patterns(active)
    if not active:
        return []
    return sorted(active.items(), key=lambda x: (-float(x[1].get("weight", 0.0)), x[0]))


def format_memory_for_rewrite_with_meta(
    memory: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Tuple[str, List[str], List[str]]:
    """
    Returns: (system_prompt_addendum, arabic_explanations, pattern_ids_used).
    """
    ordered = _active_ordered_patterns(memory)
    if not ordered:
        return "", [], []
    instructions: List[str] = []
    ar_lines: List[str] = []
    pats: List[str] = []
    seen: Set[str] = set()
    for pat, spec in ordered:
        if pat in seen:
            continue
        line = PATTERN_REWRITE_INSTRUCTIONS.get(pat)
        if not line:
            continue
        w = float(spec.get("weight", 0.0))
        instructions.append(f"- {line} (aggregated strength ~{w:.2f})")
        ex = PATTERN_EXPLAIN_AR.get(pat)
        if ex:
            ar_lines.append(ex)
        pats.append(pat)
        seen.add(pat)
    if not instructions:
        return "", [], []
    block = (
        "\n\n[Global teaching priors — soft, non-binding, aggregated from many teachers]\n"
        "The following nudge *types* reflect recurring educator moves across the platform — not any single teacher, "
        "and not text to copy. Use only when the student draft allows; never invent facts; preserve student voice.\n"
        + "\n".join(instructions)
    )
    return block, ar_lines, pats


def format_memory_for_rewrite_prompt(
    memory: Optional[Dict[str, Dict[str, Any]]] = None,
) -> str:
    t, _, _ = format_memory_for_rewrite_with_meta(memory)
    return t


def build_memory_payload_for_api(scope: Optional[str] = None) -> Dict[str, Any]:
    """What the API shows should match the rewriter: blended weights + same scope story."""
    sk = normalize_memory_scope(scope)
    merged = load_merged_memory_for_rewrite(scope)
    keys_m: List[str] = [GLOBAL_SCOPE]
    if sk != GLOBAL_SCOPE:
        keys_m.append(sk)
    return {
        "scope": sk,
        "scope_keys_merged": keys_m,
        "patterns": merged,
    }
