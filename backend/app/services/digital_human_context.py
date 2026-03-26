# -*- coding: utf-8 -*-
"""Theory-of-mind, persona traits, user context strings for tutor (V28)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db_models import (
    Answer,
    Question,
    StudentPersonaPreference,
    StudentTimeline,
    Topic,
    UserContextRow,
    UserMemory,
    UserTopicMastery,
)

logger = logging.getLogger(__name__)

TRAIT_LABELS_AR = {
    "strictness": "صرامة",
    "humor": "دعابة",
    "praise_frequency": "مدح وتشجيع",
}


def _recent_wrong_answer(db: Session, user_id: uuid.UUID, limit: int = 3) -> bool:
    rows = (
        db.query(Answer.score)
        .filter(Answer.user_id == user_id)
        .order_by(desc(Answer.created_at))
        .limit(limit)
        .all()
    )
    if not rows:
        return False
    bad = sum(1 for (s,) in rows if s is not None and float(s) < 0.5)
    return bad >= max(1, len(rows) // 2)


def _topic_mastery_summary(db: Session, user_id: uuid.UUID) -> str:
    rows = (
        db.query(UserTopicMastery, Topic.name)
        .join(Topic, Topic.id == UserTopicMastery.topic_id)
        .filter(UserTopicMastery.user_id == user_id)
        .order_by(desc(UserTopicMastery.updated_at))
        .limit(8)
        .all()
    )
    parts: list[str] = []
    for m, tname in rows:
        st = "متقن" if m.mastered else "قيد التعلم"
        parts.append(f"- {tname}: {st} (درجة تقريبية {float(m.score or 0):.0%})")
    return "\n".join(parts) if parts else "لا توجد بيانات كفاية بعد."


def build_student_mental_state(
    db: Optional[Session],
    user_id: Optional[uuid.UUID],
    camera_perception: Optional[dict[str, Any]],
    graded_feedback_recent: Optional[str] = None,
) -> dict[str, Any]:
    """Light-weight theory-of-mind snapshot."""
    out: dict[str, Any] = {
        "mastered_topics_hint": "",
        "recent_mistake": False,
        "camera_emotion": None,
        "attention": None,
        "engagement": None,
    }
    if camera_perception and isinstance(camera_perception, dict):
        out["camera_emotion"] = camera_perception.get("emotion")
        out["attention"] = camera_perception.get("attention")
        out["engagement"] = camera_perception.get("engagement")

    if db is not None and user_id is not None:
        try:
            out["mastered_topics_hint"] = _topic_mastery_summary(db, user_id)
            out["recent_mistake"] = _recent_wrong_answer(db, user_id)
        except Exception as e:
            logger.debug("mental_state db: %s", e)

    if graded_feedback_recent and (
        "أقل" in graded_feedback_recent or "خطأ" in graded_feedback_recent
    ):
        out["recent_mistake"] = True

    return out


def mental_state_to_ar_instruction(state: dict[str, Any]) -> str:
    """Arabic block for system prompt."""
    lines: list[str] = []
    ce = state.get("camera_emotion")
    if ce:
        lines.append(f"- الحالة الظاهرة من الكاميرا (تقريبية): {ce}")
    att = state.get("attention")
    if att is not None:
        lines.append(f"- الانتباه للشاشة (0-1): {att}")
    eng = state.get("engagement")
    if eng is not None:
        lines.append(f"- الانخراط (0-1): {eng}")
    if state.get("recent_mistake"):
        lines.append("- يبدو أن الطالب ارتكب خطأً مؤخراً في إجابة — بسّط الشرح وشجّع.")
    lines.append("## موضوعات الطالب (داخلي)\n" + str(state.get("mastered_topics_hint") or ""))
    return "\n".join(lines).strip()


def load_persona_traits_ar(db: Session, user_id: uuid.UUID) -> str:
    if not settings.ENABLE_PERSONA_LEARNING:
        return ""
    rows = db.query(StudentPersonaPreference).filter(StudentPersonaPreference.user_id == user_id).all()
    if not rows:
        return ""
    parts: list[str] = []
    for r in rows:
        label = TRAIT_LABELS_AR.get(r.trait, r.trait)
        v = float(r.value or 0.5)
        if r.trait == "humor" and v > 0.62:
            parts.append(f"كن أكثر دعابة ولطفاً مع هذا الطالب (مؤشر {v:.2f}).")
        elif r.trait == "strictness" and v > 0.55:
            parts.append(f"حافظ على بعض الصرامة البناءة ({v:.2f}).")
        elif r.trait == "strictness" and v < 0.38:
            parts.append(f"كن أكثر ليناً ومرونة؛ الصرامة منخفضة ({v:.2f}).")
        elif r.trait == "praise_frequency" and v > 0.6:
            parts.append("كثّر التشجيع والمدح عند التقدم.")
        else:
            parts.append(f"نمط {label}: {v:.2f}")
    return "\n".join(parts)


def load_user_context_ar(db: Session, user_id: uuid.UUID) -> str:
    if not settings.ENABLE_DEVICE_CONTEXT:
        return ""
    row = db.query(UserContextRow).filter(UserContextRow.user_id == user_id).first()
    if not row:
        return ""
    dev = row.device_type or "غير معروف"
    tz = row.timezone or ""
    cc = row.country_code or ""
    bits = [f"الجهاز: {dev}"]
    if tz:
        bits.append(f"المنطقة الزمنية: {tz}")
    if cc:
        bits.append(f"البلد (مقدّر): {cc}")
    prefs = row.prefs or {}
    if isinstance(prefs, dict) and prefs.get("short_sessions"):
        bits.append("يفضّل جلسات قصيرة.")
    return "؛ ".join(bits)


def load_yearly_snapshot(db: Session, user_id: uuid.UUID) -> str:
    if not settings.ENABLE_YEARLY_MEMORY:
        return ""
    y = datetime.utcnow().year
    row = (
        db.query(UserMemory)
        .filter(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "yearly_snapshot",
        )
        .order_by(desc(UserMemory.created_at))
        .first()
    )
    if not row or not row.content:
        return ""
    return f"ملخص سنوي ({y}): " + row.content.strip()[:2000]


def load_recent_timeline(db: Session, user_id: uuid.UUID, days: int = 7) -> str:
    if not settings.ENABLE_SESSION_TIMELINE:
        return ""
    since = date.today() - timedelta(days=days)
    rows = (
        db.query(StudentTimeline)
        .filter(StudentTimeline.user_id == user_id, StudentTimeline.day_date >= since)
        .order_by(desc(StudentTimeline.day_date))
        .limit(5)
        .all()
    )
    if not rows:
        return ""
    lines = []
    for r in rows:
        lines.append(f"- {r.day_date}: {(r.summary or '')[:280]}")
    return "\n".join(lines)


def empathy_instruction(mental: dict[str, Any]) -> str:
    if not settings.ENABLE_ACTIVE_EMPATHY:
        return ""
    ce = str(mental.get("camera_emotion") or "").lower()
    if ce in ("frustrated", "angry", "upset", "stressed"):
        return (
            "يبدو الطالب متأثراً أو منزعجاً — استخدم نبرة دافئة جداً وتشجيعية، مع جملة تعاطف قصيرة قبل الشرح، "
            "مثل: «أتفهم إن الموضوع ممكن يكون مزعج، خلينا نمشي خطوة خطوة»."
        )
    if mental.get("recent_mistake") or ce in ("confused", "sad", "bored"):
        return (
            "إذا شعرت أن الطالب يواجه صعوبة، عبّر عن تفهمك بجملة قصيرة قبل المساعدة، "
            "مثل: «أتفهم أن هذا الموضوع صعب، دعني أوضحه بطريقة مختلفة»."
        )
    return ""


def contagion_avatar_hint(student_emotion: Optional[str]) -> dict[str, Any]:
    """Map student affect to suggested avatar emotion + intensity."""
    if not settings.ENABLE_EMOTIONAL_CONTAGION or not student_emotion:
        return {}
    se = str(student_emotion).lower()
    intensity = float(settings.EMOTIONAL_CONTAGION_INTENSITY)
    if se in ("frustrated", "angry", "sad", "confused"):
        return {"emotion": "calm", "intensity": intensity, "note": "student_negative"}
    if se in ("happy", "excited"):
        return {"emotion": "friendly", "intensity": min(1.0, intensity + 0.15), "note": "student_positive"}
    return {"emotion": "neutral", "intensity": 0.4, "note": "neutral"}


def update_persona_from_feedback(db: Session, user_id: uuid.UUID, thumbs_up: bool) -> None:
    if not settings.ENABLE_PERSONA_LEARNING:
        return
    try:
        def _bump(trait: str, delta: float) -> None:
            row = (
                db.query(StudentPersonaPreference)
                .filter(
                    StudentPersonaPreference.user_id == user_id,
                    StudentPersonaPreference.trait == trait,
                )
                .first()
            )
            if not row:
                row = StudentPersonaPreference(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    trait=trait,
                    value=0.5,
                )
                db.add(row)
            row.value = max(0.0, min(1.0, float(row.value or 0.5) + delta))
            row.updated_at = datetime.utcnow()

        if thumbs_up:
            _bump("humor", 0.03)
            _bump("praise_frequency", 0.02)
        else:
            _bump("strictness", 0.02)
        db.commit()
    except Exception as e:
        logger.warning("persona update failed: %s", e)
        db.rollback()


def rl_select_action(user_id: uuid.UUID, db: Session, actions: list[str]) -> str:
    """Epsilon-greedy over stored Q-table in user_memory (optional)."""
    if not settings.ENABLE_RL_POLICY or not actions:
        return actions[0] if actions else "neutral"
    import random

    row = (
        db.query(UserMemory)
        .filter(UserMemory.user_id == user_id, UserMemory.memory_type == "rl_policy")
        .first()
    )
    q: dict[str, float] = {}
    if row and row.content:
        try:
            q = json.loads(row.content).get("q") or {}
        except json.JSONDecodeError:
            q = {}
    epsilon = 0.15
    if random.random() < epsilon:
        return random.choice(actions)
    best = actions[0]
    best_v = q.get(best, 0.0)
    for a in actions:
        if q.get(a, 0.0) > best_v:
            best = a
            best_v = q.get(a, 0.0)
    return best


def enrich_ws_tutor_context(
    db: Optional[Session],
    user_id: Optional[uuid.UUID],
    perception: Optional[dict[str, Any]],
    device: Optional[dict[str, Any]],
    context: dict[str, Any],
) -> None:
    """Mutates `context` with V28 tutor blocks (theory of mind, empathy, etc.)."""
    if not settings.ENABLE_THEORY_OF_MIND and not settings.ENABLE_DEVICE_CONTEXT:
        return
    perception = perception or {}
    device = device or {}
    if device and settings.ENABLE_DEVICE_CONTEXT:
        parts = []
        dt = device.get("device_type") or device.get("deviceType")
        tz = device.get("timezone") or device.get("timeZone")
        loc = device.get("country") or device.get("countryCode")
        tod = device.get("time_of_day") or device.get("timeOfDay")
        if dt:
            parts.append(f"جهاز: {dt}")
        if tz:
            parts.append(f"منطقة زمنية: {tz}")
        if loc:
            parts.append(f"موقع تقريبي: {loc}")
        if tod:
            parts.append(f"وقت اليوم: {tod}")
        if parts:
            context["user_context_ar"] = "؛ ".join(parts)

    if user_id is None or db is None:
        mental = build_student_mental_state(None, None, perception, context.get("graded_feedback"))
        if settings.ENABLE_THEORY_OF_MIND:
            context["student_mental_state_ar"] = mental_state_to_ar_instruction(mental)
            context["empathy_instruction_ar"] = empathy_instruction(mental)
        try:
            su = float(context.get("student_understanding_score") or 0.55)
            su = max(0.0, min(1.0, su))
            context["subtopic_mastery_hint_ar"] = (
                f"إتقان تقديري للموضوع الفرعي الحالي: {su:.0%}. "
                "إن كان منخفضاً، اشرح خطوة بخطوة؛ إن كان مرتفعاً، انتقل إلى سؤال تحدي من المنهاج."
            )
        except (TypeError, ValueError):
            pass
        return

    try:
        mental = build_student_mental_state(
            db,
            user_id,
            perception,
            str(context.get("graded_feedback") or ""),
        )
        if settings.ENABLE_THEORY_OF_MIND:
            context["student_mental_state_ar"] = mental_state_to_ar_instruction(mental)
            context["empathy_instruction_ar"] = empathy_instruction(mental)
        if settings.ENABLE_DEVICE_CONTEXT:
            uctx = load_user_context_ar(db, user_id)
            if uctx:
                prev = context.get("user_context_ar") or ""
                context["user_context_ar"] = (prev + "؛ " if prev else "") + uctx
        if settings.ENABLE_PERSONA_LEARNING:
            pt = load_persona_traits_ar(db, user_id)
            if pt:
                context["persona_traits_ar"] = pt
        if settings.ENABLE_YEARLY_MEMORY:
            ys = load_yearly_snapshot(db, user_id)
            if ys:
                context["yearly_snapshot_ar"] = ys
        if settings.ENABLE_SESSION_TIMELINE:
            tl = load_recent_timeline(db, user_id)
            if tl:
                context["timeline_recent_ar"] = tl
        try:
            su = float(context.get("student_understanding_score") or 0.55)
            su = max(0.0, min(1.0, su))
            context["subtopic_mastery_hint_ar"] = (
                f"إتقان تقديري للموضوع الفرعي الحالي: {su:.0%}. "
                "إن كان منخفضاً، اشرح خطوة بخطوة؛ إن كان مرتفعاً، انتقل إلى سؤال تحدي من المنهاج."
            )
        except (TypeError, ValueError):
            pass
    except Exception as e:
        logger.debug("enrich_ws_tutor_context: %s", e)


def rl_update_q(
    db: Session,
    user_id: uuid.UUID,
    action: str,
    reward: float,
    learning_rate: float = 0.12,
) -> None:
    if not settings.ENABLE_RL_POLICY:
        return
    try:
        row = (
            db.query(UserMemory)
            .filter(UserMemory.user_id == user_id, UserMemory.memory_type == "rl_policy")
            .first()
        )
        payload = {"q": {}}
        if row and row.content:
            try:
                payload = json.loads(row.content)
            except json.JSONDecodeError:
                payload = {"q": {}}
        q = payload.get("q") or {}
        old = float(q.get(action, 0.0))
        q[action] = old + learning_rate * (reward - old)
        payload["q"] = q
        if row:
            row.content = json.dumps(payload, ensure_ascii=False)
        else:
            db.add(
                UserMemory(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    memory_type="rl_policy",
                    content=json.dumps(payload, ensure_ascii=False),
                )
            )
        db.commit()
    except Exception as e:
        logger.debug("rl_update: %s", e)
        db.rollback()
