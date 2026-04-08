# -*- coding: utf-8 -*-
"""
XAI Audit Trail — Justification Logger v1.1
-------------------------------------------
يسجّل كل خطوة في عملية التقييم كـ NDJSON (newline-delimited JSON)
لضمان الامتثال لمعايير الذكاء الاصطناعي القابل للتفسير (XAI):
  — ISO/IEC 22989:2022 (AI Concepts and Terminology)
  — IEEE 7001-2021 (Transparency of Autonomous Systems)
  — EU AI Act, Article 13 (Transparency & Provision of Information)

التغييرات الأساسية في v1.1:
  - الكتابة بصيغة append-only فعليًا مع fsync.
  - عدم تخزين سلاسل التفكير CoT افتراضيًا؛ استبدالها بـ Justification موجزة.
  - تنظيف PII (البريد/الهاتف) واقتصاص الحقول الطويلة.
  - SCHEMA_VERSION = 1.1 + app_version.
  - أسماء ملفات آمنة ومسار سجلات قابل للتهيئة.

كل حدث (Event) يحتوي حقولًا أساسية منها:
  event_type, job_id, timestamp, criterion_code?,
  input_summary?, decision?, justification?, (reasoning_chain? اختياري)،
  ai_model?, confidence?, metadata

يُحفَظ كـ JSONL في: AUDIT_LOG_DIR/{job_id}.jsonl
"""

from __future__ import annotations

import os
import re
import json
import errno
import logging
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field, asdict
from enum import Enum

# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

logger = logging.getLogger("eduverse.audit")

# --------------------------------------------------------------------------- #
# Defaults & Config
# --------------------------------------------------------------------------- #

# المسار الافتراضي بجانب الملف: ../../data/audit_logs
_DEFAULT_AUDIT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "audit_logs")

# متغيرات البيئة
SCHEMA_VERSION      = "1.1"
APP_VERSION         = os.environ.get("EDUVERSE_APP_VERSION", "unknown")
AUDIT_DIR           = os.environ.get("AUDIT_LOG_DIR") or _DEFAULT_AUDIT_DIR
MAX_FIELD_CHARS     = int(os.environ.get("AUDIT_MAX_FIELD_CHARS", "700"))
ALLOW_COT           = os.environ.get("AUDIT_ALLOW_COT", "0") == "1"   # افتراضيًا: لا نخزن CoT

# تأكد من وجود المجلد
os.makedirs(AUDIT_DIR, exist_ok=True)

# أنماط إزالة المعرّفات الحساسة (Best-effort)
_PII_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE = re.compile(r"\+?\d[\d\s\-()]{6,}\d")

def _sanitize_text(s: Optional[str]) -> Optional[str]:
    """تنظيف نص (اقتطاع + إزالة بريد/هاتف)."""
    if not s or not isinstance(s, str):
        return s
    s2 = s.strip()
    if len(s2) > MAX_FIELD_CHARS:
        s2 = s2[:MAX_FIELD_CHARS] + "…"
    s2 = _PII_EMAIL.sub("[email]", s2)
    s2 = _PII_PHONE.sub("[phone]", s2)
    return s2

def _summarize_reasoning(reasoning_chain: Optional[List[str]], max_items: int = 3) -> Optional[List[str]]:
    """تحويل سلسلة التفكير إلى نقاط موجزة (بدلاً من كشف CoT)."""
    if not reasoning_chain:
        return None
    bullets: List[str] = []
    for it in reasoning_chain[:max_items]:
        if not it:
            continue
        it = _sanitize_text(str(it))
        # إزالة إشارات صريحة لسلاسل التفكير واستبدالها بـ "موجز"
        it = re.sub(r"(خطوات|تفكير|Chain|Reasoning|Thought).*?:", "موجز:", it, flags=re.I)
        bullets.append(it)
    return bullets or None

def _safe_filename(name: str) -> str:
    """تحويل job_id إلى اسم ملف آمن (بدون مسارات/محارف خاصّة)."""
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "job")
    return base[:120]

# --------------------------------------------------------------------------- #
# Vocabulary
# --------------------------------------------------------------------------- #

class AuditEventType(str, Enum):
    JOB_STARTED         = "JOB_STARTED"
    CRITERIA_EXTRACTED  = "CRITERIA_EXTRACTED"
    QUANTITATIVE_PARSED = "QUANTITATIVE_PARSED"
    CRITERION_EVALUATED = "CRITERION_EVALUATED"
    VERIFICATION_RUN    = "VERIFICATION_RUN"
    CORRECTION_APPLIED  = "CORRECTION_APPLIED"
    STAIRCASE_APPLIED   = "STAIRCASE_APPLIED"
    EMOTION_GENERATED   = "EMOTION_GENERATED"
    MEMORY_LOADED       = "MEMORY_LOADED"
    MEMORY_SAVED        = "MEMORY_SAVED"
    FINAL_GRADE         = "FINAL_GRADE"
    APPEAL_RECEIVED     = "APPEAL_RECEIVED"
    APPEAL_RESOLVED     = "APPEAL_RESOLVED"
    ERROR               = "ERROR"

# --------------------------------------------------------------------------- #
# Data Model
# --------------------------------------------------------------------------- #

@dataclass
class AuditEvent:
    event_type:      str
    job_id:          str
    timestamp:       str           = field(default_factory=lambda: datetime.utcnow().isoformat())
    schema_version:  str           = SCHEMA_VERSION
    app_version:     str           = APP_VERSION

    criterion_code:  Optional[str] = None
    # ملاحظة: نُخزّن ملخصات مختصرة فقط
    input_summary:   Optional[str] = None
    decision:        Optional[Any] = None

    # سلسلة التفكير — لا تُخزن افتراضيًا (إلا إن ALLOW_COT=1)
    reasoning_chain: Optional[List[str]] = None

    # بديل آمن: نقاط موجزة/مبررات
    justification:   Optional[List[str]] = None

    ai_model:        Optional[str] = None
    confidence:      Optional[float] = None
    metadata:        Dict[str, Any] = field(default_factory=dict)

# --------------------------------------------------------------------------- #
# AuditTrail
# --------------------------------------------------------------------------- #

class AuditTrail:
    """
    Collects audit events for a single grading job.
    Thread-safe via asyncio.Lock.
    Flushes to disk as JSONL (append-only).
    """

    def __init__(self, job_id: str, student_id: Optional[str] = None):
        safe_id = _safe_filename(job_id)
        self.job_id:     str           = safe_id
        self.student_id: Optional[str] = student_id
        self._events:    List[AuditEvent] = []
        self._lock       = asyncio.Lock()

        # Log job start immediately
        self._events.append(AuditEvent(
            event_type=AuditEventType.JOB_STARTED.value,
            job_id=safe_id,
            metadata={"student_id": _sanitize_text(student_id)},
        ))

    # -------------------------- Internal ----------------------------------- #

    def _prepare_event(self, e: AuditEvent) -> AuditEvent:
        """Sanitize event fields and enforce storage policy."""
        e.input_summary  = _sanitize_text(e.input_summary)
        e.criterion_code = _sanitize_text(e.criterion_code)
        e.ai_model       = _sanitize_text(e.ai_model)

        # confidence إلى [0..1]
        if e.confidence is not None:
            try:
                e.confidence = max(0.0, min(1.0, float(e.confidence)))
            except Exception:
                e.confidence = None

        # Chain-of-Thought policy
        if e.reasoning_chain and not ALLOW_COT:
            e.justification  = _summarize_reasoning(e.reasoning_chain)
            e.reasoning_chain = None
        return e

    # -------------------------- Logging APIs -------------------------------- #

    async def log(self, event_type: AuditEventType, **kwargs) -> None:
        """Append an audit event (async-safe)."""
        e = AuditEvent(event_type=event_type.value, job_id=self.job_id, **kwargs)
        e = self._prepare_event(e)
        async with self._lock:
            self._events.append(e)

    def log_sync(self, event_type: AuditEventType, **kwargs) -> None:
        """Synchronous variant — for use outside coroutines."""
        e = AuditEvent(event_type=event_type.value, job_id=self.job_id, **kwargs)
        e = self._prepare_event(e)
        self._events.append(e)

    # -------------------------- Criterion Helper ---------------------------- #

    def log_criterion(
        self,
        code:            str,
        achieved:        bool,
        reasoning:       str,
        verifier_score:  float = 0.0,
        correction:      bool  = False,
        ai_model:        Optional[str] = None,
    ) -> None:
        """Log the evaluation decision for a single criterion."""
        bullets: List[str] = [
            f"المعيار: {code}",
            f"الحكم: {'حقق ✓' if achieved else 'لم يحقق ✗'}",
        ]
        if reasoning:
            bullets.append(f"المبرر: {_sanitize_text(reasoning)[:300]}")
        if verifier_score > 0:
            bullets.append(f"درجة التحقق: {verifier_score:.2f}")
        if correction:
            bullets.append("✅ تم تطبيق تصحيح من الناقد الداخلي")

        self.log_sync(
            AuditEventType.CRITERION_EVALUATED,
            criterion_code=code,
            decision={"achieved": achieved},
            justification=bullets,  # ← بدلاً من تخزين CoT
            ai_model=ai_model,
            confidence=1.0 - max(0.0, min(1.0, verifier_score)),
        )

    # -------------------------- Flush -------------------------------------- #

    async def flush(self) -> str:
        """
        Append all events to JSONL file atomically enough for our use-case.
        Returns the output path.
        """
        path = os.path.join(AUDIT_DIR, f"{self.job_id}.jsonl")
        os.makedirs(AUDIT_DIR, exist_ok=True)

        async with self._lock:
            try:
                # فتح بالملحق (append) لضمان عدم المسح
                with open(path, "a", encoding="utf-8") as f:
                    for event in self._events:
                        f.write(json.dumps(asdict(event), ensure_ascii=False) + "\n")
                    # ضمان ثبات السطور على القرص
                    f.flush()
                    os.fsync(f.fileno())
            except Exception as ex:
                logger.exception("Failed to flush audit trail: %s", ex)
                raise
            # لا نفرغ الذاكرة للحفاظ على get_summary() في نفس الجلسة
        logger.info("Audit trail flushed: %s (+%d events)", path, len(self._events))
        return path

    # -------------------------- Summary ------------------------------------ #

    def get_summary(self) -> Dict[str, Any]:
        """
        Return a privacy-safe, XAI-compliant summary.
        Suitable for embedding in the API response.
        """
        corrections = sum(
            1 for e in self._events
            if e.event_type == AuditEventType.CORRECTION_APPLIED.value
        )
        criteria_codes = [
            e.criterion_code for e in self._events
            if e.event_type == AuditEventType.CRITERION_EVALUATED.value
            and e.criterion_code
        ]
        final_grade = next(
            (e.decision for e in reversed(self._events)
             if e.event_type == AuditEventType.FINAL_GRADE.value),
            None,
        )

        return {
            "job_id":               self.job_id,
            "schema_version":       SCHEMA_VERSION,
            "app_version":          APP_VERSION,
            "total_events":         len(self._events),
            "event_types":          list(dict.fromkeys(e.event_type for e in self._events)),
            "criteria_evaluated":   criteria_codes,
            "corrections_applied":  corrections,
            "final_grade":          final_grade,
            # Compliance declarations
            "xai_compliant":        True,
            "standards": [
                "ISO/IEC 22989:2022 — AI Concepts and Terminology",
                "IEEE 7001-2021 — Transparency of Autonomous Systems",
                "EU AI Act Art.13 — Transparency & Provision of Information",
            ],
        }

# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #

def load_audit_trail(job_id: str) -> Optional[List[Dict[str, Any]]]:
    """Load a persisted audit trail from disk. Returns None if not found."""
    safe_id = _safe_filename(job_id)
    path = os.path.join(AUDIT_DIR, f"{safe_id}.jsonl")
    if not os.path.exists(path):
        return None
    events: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                # تجاهل السطور التالفة إن وُجدت
                pass
    return events

