# -*- coding: utf-8 -*-
"""
BTEC interactive training mode — RAG-grounded practice questions and P/M/D-style feedback.

Uses Chroma collection ``btec_knowledge_base`` (same as tutor) and optional ``forensic_grade``
when ``BTEC_TRAINING_FORENSIC=true``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.services.btec_chroma_rag import retrieve_btec_chroma_block

logger = logging.getLogger(__name__)

_PROGRESS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "training_progress")
)


def _norm_difficulty(d: str) -> str:
    x = (d or "merit").strip().lower()
    if x in ("p", "pass", "easy", "ناجح", "بسيط"):
        return "pass"
    if x in ("d", "distinction", "hard", "ممتاز", "صعب"):
        return "distinction"
    return "merit"


def _grade_band_label(diff: str) -> str:
    return {"pass": "Pass", "merit": "Merit", "distinction": "Distinction"}.get(diff, "Merit")


def _map_forensic_to_pmd(final: str) -> str:
    u = (final or "").strip().upper()
    if u in ("P", "PASS"):
        return "P"
    if u in ("M", "MERIT"):
        return "M"
    if u in ("D", "DISTINCTION"):
        return "D"
    if "DISTINCTION" in u:
        return "D"
    if "MERIT" in u:
        return "M"
    if "PASS" in u:
        return "P"
    return "M"


def _parse_json_object(raw: str) -> Optional[dict]:
    t = (raw or "").strip()
    if not t:
        return None
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


def _first_source_ref_from_rag(block: str) -> str:
    if not block:
        return "—"
    m = re.search(r"\[1\][^\n]*", block)
    return m.group(0).strip()[:200] if m else "مرجع المنهج المحلي"


async def generate_practice_question(topic: str, difficulty: str, session_id: str) -> str:
    """Retrieve BTEC chunks for ``topic``, then ask the LLM for one short Arabic practice question."""
    from app.services.llm_client import cogni_chat_completion

    topic = (topic or "BTEC Business").strip()
    diff = _norm_difficulty(difficulty)
    band = _grade_band_label(diff)
    sid = f"{session_id}_train_q"[:120]
    rag_query = f"BTEC Business {topic} unit learning outcomes assessment criteria"
    ref = await retrieve_btec_chroma_block(rag_query, session_id=sid, top_k=6, use_cache=False)

    sys = (
        "You write exactly ONE short-answer practice question in Arabic for BTEC Business students.\n"
        f"Target difficulty band: BTEC {band} (match typical expectations for that band).\n"
        "Ground the question in the reference excerpts when they are non-empty; if empty, use standard BTEC Business syllabus topics.\n"
        "Rules:\n"
        "- Output only the question in Arabic (1–3 sentences). No solutions, no bullet labels, no JSON, no English except acronyms (PESTLE, SWOT, BTEC).\n"
        "- Jordanian-friendly wording is allowed in the stem.\n"
    )
    user = f"Topic focus: {topic}\n\nReference excerpts:\n{ref or '(no local chunks)'}\n"
    messages = [
        {"role": "system", "content": sys},
        {"role": "user", "content": user[:14000]},
    ]
    out = await cogni_chat_completion(messages, max_tokens=220, temperature=0.55)
    q = (out or "").strip()
    q = re.sub(r"^[\d\-\.\)\s]+", "", q).strip()
    if len(q) < 12:
        return (
            f"اشرح باختصار مفهوم «{topic}» في سياق إدارة الأعمال، واذكر مثالاً واقعياً واحداً "
            f"مناسباً لمستوى {band}."
        )
    return q[:2000]


async def evaluate_answer(question: str, student_answer: str, session_id: str) -> dict:
    """
    Compare the answer to RAG references; return ``grade`` in {P,M,D}, Arabic ``feedback``, ``source_ref``.
    """
    from app.services.llm_client import cogni_chat_completion

    q = (question or "").strip()
    a = (student_answer or "").strip()
    sid = f"{session_id}_train_e"[:120]
    rag_query = f"{q}\n{a}"
    ref = await retrieve_btec_chroma_block(rag_query, session_id=sid, top_k=6, use_cache=False)
    source_ref = _first_source_ref_from_rag(ref)

    grade = "M"
    feedback_ar = ""
    forensic_summary = ""

    if os.getenv("BTEC_TRAINING_FORENSIC", "false").lower() in ("1", "true", "yes"):
        try:
            from app.services.forensic_engine import forensic_grade

            assignment = (
                "مهمة تدريبية (BTEC Business):\n"
                f"{q}\n\n"
                "معايير ومقتطفات مرجعية من المنهج المحلي:\n"
                f"{(ref or '')[:10000]}"
            )
            timeout = float(os.getenv("BTEC_TRAINING_FORENSIC_TIMEOUT_SEC", "75"))
            fg = await asyncio.wait_for(forensic_grade(assignment, a), timeout=timeout)
            fg_grade = fg.get("final_grade") if isinstance(fg, dict) else None
            grade = _map_forensic_to_pmd(str(fg_grade))
            forensic_summary = str(fg.get("summary") or "")[:1500]
        except Exception as ex:
            logger.warning("[training_mode] forensic_grade skipped: %s", ex)

    sys = (
        "You are a BTEC Business examiner. Compare the student's answer to the reference excerpts.\n"
        "Assign one grade: P (Pass), M (Merit), or D (Distinction) using BTEC descriptors "
        "(describe/explain → P; analyse/link → M; evaluate/justify → D).\n"
        "Respond with a single JSON object only, keys: grade (P, M, or D), feedback (Arabic, 2–5 sentences, supportive Jordanian-friendly tone), "
        "source_ref (short string citing which excerpt e.g. [1] page …).\n"
        f"Forensic engine hint (may be empty): {forensic_summary[:800]!r}\n"
    )
    user = (
        f"Question:\n{q}\n\nStudent answer:\n{a}\n\nReference excerpts:\n{ref or '(none)'}\n"
    )
    messages = [
        {"role": "system", "content": sys},
        {"role": "user", "content": user[:14000]},
    ]
    raw = await cogni_chat_completion(messages, max_tokens=450, temperature=0.35)
    parsed = _parse_json_object(raw or "")
    if isinstance(parsed, dict):
        g = str(parsed.get("grade") or "").strip().upper()
        if g in ("P", "M", "D"):
            grade = g
        fb = str(parsed.get("feedback") or "").strip()
        if fb:
            feedback_ar = fb[:3500]
        sr = str(parsed.get("source_ref") or "").strip()
        if sr:
            source_ref = sr[:300]

    if not feedback_ar:
        feedback_ar = (
            f"درجتك التقريبية ضمن معايير BTEC: {grade}. راجع المفاهيم الأساسية في المرجع وأعد صياغة الإجابة بربط أوضح بالسياق."
        )

    return {
        "grade": grade,
        "feedback": feedback_ar,
        "source_ref": source_ref or "—",
        "reference_excerpt_len": len(ref or ""),
    }


def track_student_progress(user_id: str, topic: str, grade: str) -> None:
    """Append a grade event to a simple JSON file per user (guest keys: ``guest:<session>``)."""
    uid = (user_id or "anonymous").strip()[:200]
    topic_k = (topic or "general").strip()[:200] or "general"
    g = (grade or "M").strip().upper()[:1]
    if g not in ("P", "M", "D"):
        g = "M"

    os.makedirs(_PROGRESS_DIR, exist_ok=True)
    path = os.path.join(_PROGRESS_DIR, re.sub(r"[^\w\-\.]", "_", uid) + ".json")
    try:
        data: dict[str, Any] = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        topics = data.setdefault("topics", {})
        arr = topics.setdefault(topic_k, [])
        arr.append(
            {
                "grade": g,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )
        arr[:] = arr[-80:]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as ex:
        logger.warning("[training_mode] track_student_progress failed: %s", ex)


def persist_training_evaluation_row(
    *,
    user_uuid: Optional[uuid.UUID],
    question: str,
    student_answer: str,
    evaluation: dict,
) -> None:
    """Best-effort insert into ``TrainingData`` for future fine-tuning."""
    try:
        from app.database import SessionLocal
        from app.models.db_models import TrainingData

        db = SessionLocal()
        try:
            score_map = {"P": 0.45, "M": 0.72, "D": 1.0}
            sc = score_map.get(str(evaluation.get("grade") or "M").upper(), 0.72)
            row = TrainingData(
                user_id=user_uuid,
                prompt=(question or "")[:8000],
                response=(student_answer or "")[:8000],
                score=sc,
                meta={
                    "kind": "btec_training_eval",
                    "grade": evaluation.get("grade"),
                    "feedback": (evaluation.get("feedback") or "")[:2000],
                    "source_ref": evaluation.get("source_ref"),
                },
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
    except Exception as ex:
        logger.debug("[training_mode] TrainingData persist skipped: %s", ex)
