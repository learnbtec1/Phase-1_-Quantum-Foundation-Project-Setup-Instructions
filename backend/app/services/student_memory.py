# -*- coding: utf-8 -*-
"""
Longitudinal Student Memory — State Management v1.0
----------------------------------------------------
يحفظ سجل تقييمات كل طالب عبر الجلسات ويُنتج سياقاً مقارناً:
  "في محاولتك السابقة لم تحقق P1 بسبب X — هل عالجته الآن؟"
  "لا يزال M2 ضعيفاً عبر محاولتين متتاليتين."

التخزين: JSON files في /data/student_memory/{student_id}.json
الحد الأقصى: 10 جلسات لكل طالب (الأقدم يُحذف).
"""
from __future__ import annotations

import re
import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict

logger = logging.getLogger("nexus.memory")

_MEMORY_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "student_memory")
os.makedirs(_MEMORY_DIR, exist_ok=True)

MAX_SESSIONS = 10  # per student
_SAFE_ID_PATTERN = re.compile(r'[^a-zA-Z0-9_\-\u0600-\u06FF]')


# ─── Data structures ────────────────────────────────────────────────────────

@dataclass
class CriterionHistory:
    code: str
    achieved: bool
    quality: str
    missing_requirements: List[str]
    timestamp: str
    scaffolding_questions: List[str] = field(default_factory=list)


@dataclass
class AssessmentSession:
    job_id: str
    timestamp: str
    subject: str
    final_grade: str
    criteria: List[CriterionHistory]
    metadata: Dict[str, Any] = field(default_factory=dict)


# ─── Path helper ─────────────────────────────────────────────────────────────

def _student_path(student_id: str) -> str:
    """Return sanitised file path — prevents path traversal attacks."""
    safe_id = _SAFE_ID_PATTERN.sub('_', student_id)
    if not safe_id:
        safe_id = "anonymous"
    return os.path.join(_MEMORY_DIR, f"{safe_id}.json")


# ─── Persistence ─────────────────────────────────────────────────────────────

def load_student_history(student_id: str) -> List[AssessmentSession]:
    """Load all past sessions for a student from disk."""
    path = _student_path(student_id)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        sessions = []
        for s in data.get("sessions", []):
            criteria = []
            for c in s.get("criteria", []):
                cc = dict(c)
                cc.setdefault("scaffolding_questions", [])
                criteria.append(CriterionHistory(**cc))
            sessions.append(AssessmentSession(
                job_id=s["job_id"],
                timestamp=s["timestamp"],
                subject=s.get("subject", "غير محدد"),
                final_grade=s["final_grade"],
                criteria=criteria,
                metadata=s.get("metadata", {}),
            ))
        return sessions
    except Exception as e:
        logger.warning("Failed to load history for %s: %s", student_id, e)
        return []


def save_assessment_session(
    student_id: str,
    job_id: str,
    subject: str,
    final_grade: str,
    criteria_results: Dict[str, Any],
    metadata: Optional[Dict] = None,
) -> None:
    """Persist a new assessment session to disk."""
    path    = _student_path(student_id)
    sessions = load_student_history(student_id)

    criteria_list = []
    for code, r in criteria_results.items():
        _sq = r.get("scaffolding_questions")
        if not isinstance(_sq, list):
            _sq = []
        criteria_list.append(
            CriterionHistory(
                code=code,
                achieved=r.get("achieved", False),
                quality=r.get("quality", "غير محدد"),
                missing_requirements=r.get("missing_requirements", []),
                timestamp=datetime.utcnow().isoformat(),
                scaffolding_questions=_sq,
            )
        )

    new_session = AssessmentSession(
        job_id=job_id,
        timestamp=datetime.utcnow().isoformat(),
        subject=subject or "غير محدد",
        final_grade=final_grade,
        criteria=criteria_list,
        metadata=metadata or {},
    )

    sessions.insert(0, new_session)
    sessions = sessions[:MAX_SESSIONS]  # cap

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "student_id": student_id,
                    "last_updated": datetime.utcnow().isoformat(),
                    "sessions": [asdict(s) for s in sessions],
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        logger.info("Memory saved for student %s (%d sessions)", student_id, len(sessions))
    except Exception as e:
        logger.error("Failed to save memory for %s: %s", student_id, e)


# ─── Context generation ───────────────────────────────────────────────────────

def generate_longitudinal_context(
    student_id: str,
    current_criteria_codes: List[str],
) -> str:
    """
    Build an Arabic context string for injection into the AI grading prompt.

    Produces text like:
      "📚 في محاولتك السابقة (2026-03-10):
         • P1: كان ناقصاً — لم تقدم تطبيقاً عملياً واضحاً
         • M2: لم يتحقق في المحاولة السابقة
       🔄 هذه المرة: تحقق مما إذا كانت الإجابة الجديدة تُعالج هذه النقاط."
    """
    sessions = load_student_history(student_id)
    if not sessions:
        return ""  # first attempt — nothing to compare

    last = sessions[0]

    lines = [
        f"📚 [سياق الذاكرة الطولية — المحاولة السابقة: {last.timestamp[:10]}]",
        f"الدرجة السابقة: {last.final_grade}",
    ]

    last_by_code = {c.code: c for c in last.criteria}

    still_failing: List[tuple] = []
    newly_appearing: List[str]  = []

    for code in current_criteria_codes:
        if code not in last_by_code:
            newly_appearing.append(code)
        elif not last_by_code[code].achieved:
            still_failing.append((code, last_by_code[code].missing_requirements))

    if still_failing:
        lines.append("\n⚠️ المعايير التي لم تتحقق سابقاً — يرجى التحقق منها بعناية:")
        for code, missing in still_failing:
            if missing:
                lines.append(f"  • {code}: كان ناقصاً — {'; '.join(missing[:2])}")
            else:
                lines.append(f"  • {code}: لم يتحقق في المحاولة السابقة")

    if newly_appearing:
        lines.append(f"\n🆕 معايير جديدة لم تُقيَّم سابقاً: {', '.join(newly_appearing)}")

    lines.append("\n🔄 راعِ هذا السياق — زِن ما إذا كانت الإجابة الجديدة تُعالج النقاط المذكورة.")

    return "\n".join(lines)


# ─── Analytics ────────────────────────────────────────────────────────────────

def build_longitudinal_summary(student_id: str) -> Dict[str, Any]:
    """
    Build a full progression analytics report for a student.
    Returned as JSON-serialisable dict for the API.
    """
    sessions = load_student_history(student_id)
    if not sessions:
        return {
            "status": "no_history",
            "message": "لا توجد سجلات سابقة لهذا الطالب.",
        }

    grade_order = {"REFER": 0, "PASS": 1, "MERIT": 2, "DISTINCTION": 3}

    grade_progression = [
        {"date": s.timestamp[:10], "grade": s.final_grade, "subject": s.subject}
        for s in sessions
    ]

    # Per-criterion pass rate across sessions
    criterion_stats: Dict[str, Dict] = {}
    for session in sessions:
        for c in session.criteria:
            if c.code not in criterion_stats:
                criterion_stats[c.code] = {"attempts": 0, "achieved_count": 0, "missing": []}
            criterion_stats[c.code]["attempts"]       += 1
            criterion_stats[c.code]["achieved_count"] += int(c.achieved)
            criterion_stats[c.code]["missing"].extend(c.missing_requirements[:2])

    # Persistent weaknesses: failed every attempt (≥2)
    persistent_weak = [
        code for code, stats in criterion_stats.items()
        if stats["attempts"] >= 2 and stats["achieved_count"] == 0
    ]

    # Improvement trend: latest grade vs oldest
    trend = "stable"
    if len(sessions) >= 2:
        latest_rank = grade_order.get(sessions[0].final_grade, 0)
        oldest_rank = grade_order.get(sessions[-1].final_grade, 0)
        if latest_rank > oldest_rank:
            trend = "improving"
        elif latest_rank < oldest_rank:
            trend = "declining"

    return {
        "student_id":          student_id,
        "total_sessions":      len(sessions),
        "latest_grade":        sessions[0].final_grade,
        "grade_progression":   grade_progression,
        "criterion_stats":     criterion_stats,
        "persistent_weaknesses": persistent_weak,
        "improvement_trend":   trend,
    }
