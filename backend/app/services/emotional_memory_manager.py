# -*- coding: utf-8 -*-
"""
Per-connection session memory for Cogni Thinker + affect logging.

Feeds tutor context as emotional snapshots; keep summaries factual — persona rules
live in `personality.ts` / tutor `_DEFAULT_PERSONA_SYSTEM_AR`, not here.

Not to be confused with vector episodic store (`episodic_memory.py`).

Phase A: optional `user_id` loads/saves snapshots to `user_memory` (PostgreSQL).
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

_MAX_ENTRIES = 200

if TYPE_CHECKING:
    from app.services.thinker import AutonomousThinker

logger = logging.getLogger(__name__)


class EmotionalMemoryManager:
    """In-memory rolling log for one WebSocket session; optional DB persistence per user."""

    def __init__(
        self,
        user_id: Optional[uuid.UUID] = None,
        *,
        session_only: bool = True,
    ) -> None:
        self._user_id = user_id
        self._session_only = session_only
        self._persist_enabled = bool(user_id) and not session_only
        self._entries: List[Dict[str, Any]] = []
        self.active_lesson_plan: Optional[str] = None
        self.plan_updated_at: Optional[str] = None
        self._dialogue_turn_count: int = 0
        self.last_user_text: str = ""
        self.restored_goal: Optional[str] = None
        # V28 — simple theory-of-mind + teaching-style preference (session + optional DB snapshot)
        self.student_understanding_score: float = 0.55
        self.preferred_teaching_style: str = "encouraging"
        self._thinker_redis_patch: Optional[Dict[str, Any]] = None

        if self._persist_enabled:
            self._load_from_db()
            self._load_redis_after_db()

    @property
    def persist_enabled(self) -> bool:
        return self._persist_enabled

    @property
    def user_id(self) -> Optional[uuid.UUID]:
        return self._user_id

    def _load_redis_after_db(self) -> None:
        if not self._user_id or not self._persist_enabled:
            return
        try:
            from app.services.cogni_redis_state import apply_state_to_emm, load_state

            data = load_state(self._user_id)
            if not data:
                return
            apply_state_to_emm(self, data)
            t = data.get("thinker")
            if isinstance(t, dict):
                self._thinker_redis_patch = t
        except Exception as e:
            logger.debug("[EmotionalMemoryManager] redis load skipped: %s", e)

    def _load_from_db(self) -> None:
        if not self._user_id:
            return
        try:
            from sqlalchemy import desc

            from app.database import SessionLocal
            from app.models.db_models import UserMemory

            db = SessionLocal()
            try:
                rows = (
                    db.query(UserMemory)
                    .filter(UserMemory.user_id == self._user_id)
                    .order_by(desc(UserMemory.created_at))
                    .all()
                )
                seen: set[str] = set()
                for row in rows:
                    mt = row.memory_type or ""
                    if mt in seen:
                        continue
                    seen.add(mt)
                    if mt == "emotional":
                        try:
                            data = json.loads(row.content or "{}")
                        except json.JSONDecodeError:
                            continue
                        if isinstance(data, dict):
                            ent = data.get("entries")
                            if isinstance(ent, list):
                                self._entries = ent[-_MAX_ENTRIES:]
                            self._dialogue_turn_count = int(data.get("dialogue_turn_count") or 0)
                            self.last_user_text = str(data.get("last_user_text") or "")[:800]
                            try:
                                self.student_understanding_score = float(
                                    data.get("student_understanding_score", self.student_understanding_score)
                                )
                            except (TypeError, ValueError):
                                pass
                            _ps = str(data.get("preferred_teaching_style") or "").strip()
                            if _ps:
                                self.preferred_teaching_style = _ps[:32]
                    elif mt == "lesson_plan":
                        try:
                            data = json.loads(row.content or "{}")
                            plan = data.get("text") if isinstance(data, dict) else None
                            if isinstance(plan, str) and plan.strip():
                                self.active_lesson_plan = plan.strip()[:8000]
                                self.plan_updated_at = datetime.now(timezone.utc).isoformat()
                        except json.JSONDecodeError:
                            if (row.content or "").strip():
                                self.active_lesson_plan = (row.content or "").strip()[:8000]
                    elif mt == "goal":
                        try:
                            data = json.loads(row.content or "{}")
                            g = data.get("goal") if isinstance(data, dict) else None
                            if isinstance(g, str) and g.strip():
                                self.restored_goal = g.strip()[:240]
                        except json.JSONDecodeError:
                            pass
            finally:
                db.close()
        except Exception as e:
            logger.warning("[EmotionalMemoryManager] load_from_db failed (session-only fallback): %s", e)

    def save_to_db(self, thinker: Optional["AutonomousThinker"] = None) -> None:
        """Persist last emotional entries, lesson plan, and Thinker goal for logged-in users."""
        if not self._persist_enabled or not self._user_id:
            return
        try:
            from app.database import SessionLocal
            from app.models.db_models import UserMemory

            goal: Optional[str] = None
            if thinker is not None:
                try:
                    goal = thinker.current_goal
                except Exception:
                    goal = None

            db = SessionLocal()
            try:
                db.query(UserMemory).filter(
                    UserMemory.user_id == self._user_id,
                    UserMemory.memory_type.in_(["emotional", "lesson_plan", "goal"]),
                ).delete(synchronize_session=False)

                snap = {
                    "entries": self._entries[-20:],
                    "dialogue_turn_count": self._dialogue_turn_count,
                    "last_user_text": self.last_user_text,
                    "student_understanding_score": self.student_understanding_score,
                    "preferred_teaching_style": self.preferred_teaching_style,
                }
                db.add(
                    UserMemory(
                        user_id=self._user_id,
                        memory_type="emotional",
                        content=json.dumps(snap, ensure_ascii=False),
                    )
                )
                if self.active_lesson_plan:
                    db.add(
                        UserMemory(
                            user_id=self._user_id,
                            memory_type="lesson_plan",
                            content=json.dumps({"text": self.active_lesson_plan}, ensure_ascii=False),
                        )
                    )
                if goal:
                    db.add(
                        UserMemory(
                            user_id=self._user_id,
                            memory_type="goal",
                            content=json.dumps({"goal": goal}, ensure_ascii=False),
                        )
                    )
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        except Exception as e:
            logger.warning("[EmotionalMemoryManager] save_to_db failed: %s", e)
        self._save_redis_snapshot(thinker)

    def _save_redis_snapshot(self, thinker: Optional["AutonomousThinker"] = None) -> None:
        if not self._persist_enabled or not self._user_id:
            return
        try:
            from app.services.cogni_redis_state import build_state_from_emm_and_thinker, save_state

            save_state(self._user_id, build_state_from_emm_and_thinker(self, thinker))
        except Exception as e:
            logger.debug("[EmotionalMemoryManager] redis snapshot: %s", e)

    def _trim(self) -> None:
        if len(self._entries) > _MAX_ENTRIES:
            del self._entries[: len(self._entries) - _MAX_ENTRIES]

    def observe_dialogue_turn(
        self,
        user: str,
        assistant: str,
        *,
        user_mood: str = "neutral",
        avatar_emotion: str = "neutral",
    ) -> None:
        self._dialogue_turn_count += 1
        self.last_user_text = (user or "")[:800]
        self._entries.append(
            {
                "ts": time.time(),
                "type": "conversation",
                "summary": f"User: {(user or '')[:280]} | Assistant: {(assistant or '')[:280]}",
                "metadata": {
                    "user_mood": user_mood,
                    "avatar_emotion": avatar_emotion,
                },
            }
        )
        self._trim()

    def adjust_understanding_and_style(
        self,
        user_text: str,
        *,
        graded_feedback: Optional[str] = None,
    ) -> None:
        """Update 0–1 understanding estimate and coarse preferred_style from Jordanian-friendly heuristics."""
        u = (user_text or "").strip()
        ul = u.lower()
        gf = (graded_feedback or "").strip()
        confused = any(
            x in ul
            for x in (
                "مش فاهم",
                "ما فهمت",
                "شو يعني",
                "ضيعت",
                "صعب علي",
                "شرحلي أكثر",
                "شرحلي اكثر",
            )
        )
        clear = any(
            x in ul
            for x in (
                "فهمت",
                "تمام",
                "زين",
                "منيح هيك",
                "واضح",
            )
        )
        if confused:
            self.student_understanding_score = max(0.08, float(self.student_understanding_score) - 0.12)
        if clear:
            self.student_understanding_score = min(1.0, float(self.student_understanding_score) + 0.08)
        if gf:
            if any(x in gf for x in ("صح", "ممتاز", "تقريباً صح", "تقريبا صح", "رائع")):
                self.student_understanding_score = min(1.0, float(self.student_understanding_score) + 0.1)
            if any(x in gf for x in ("خطأ", "أقل", "غير كامل", "ناقص")):
                self.student_understanding_score = max(0.08, float(self.student_understanding_score) - 0.1)
        if any(x in ul for x in ("ههه", "😂", "ضحك", "لول")):
            self.preferred_teaching_style = "humorous"
        elif confused:
            self.preferred_teaching_style = "encouraging"
        elif any(x in ul for x in ("اسمع", "بدي جد", "ركز", "امتحان")):
            self.preferred_teaching_style = "strict"

    def apply_thumb_feedback(self, thumbs_up: bool) -> None:
        """V29 — session thumbs up/down nudges teaching style (real-time adaptation)."""
        if thumbs_up:
            if self.preferred_teaching_style == "strict":
                self.preferred_teaching_style = "encouraging"
            elif self.preferred_teaching_style == "encouraging":
                self.preferred_teaching_style = "humorous"
            else:
                self.preferred_teaching_style = "encouraging"
        else:
            if self.preferred_teaching_style == "humorous":
                self.preferred_teaching_style = "encouraging"
            else:
                self.preferred_teaching_style = "strict"

    def record_moment(
        self,
        user_mood: str,
        avatar_emotion: str,
        intensity: float,
        topic: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        md = dict(metadata or {})
        md.setdefault("type", "emotion")
        md["user_mood"] = user_mood
        md["avatar_emotion"] = avatar_emotion
        md["intensity"] = intensity
        if topic and "full_thought" not in md:
            md.setdefault("full_thought", topic)
        self._entries.append(
            {
                "ts": time.time(),
                "type": md.get("type", "emotion"),
                "summary": (topic or "")[:500],
                "metadata": md,
            }
        )
        self._trim()

    def get_recent(self, limit: int = 5, types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Last `limit` entries, optionally filtered by top-level `type` or `metadata.type`."""
        items = list(self._entries)
        if types:
            want = set(types)
            items = [
                e
                for e in items
                if e.get("type") in want
                or (e.get("metadata") or {}).get("type") in want
            ]
        return items[-limit:] if limit > 0 else items

    def get_last_of_type(self, type_: str) -> Optional[str]:
        """Most recent memory of this logical type (top-level or metadata.type).

        Used by Thinker proactive speech (`internal_thought`) to build contextual SYSTEM_EVENT prompts.
        """
        for e in reversed(self._entries):
            if e.get("type") == type_ or (e.get("metadata") or {}).get("type") == type_:
                md = e.get("metadata") or {}
                return md.get("full_thought") or md.get("topic") or e.get("summary")
        return None

    def count_thoughts_since(self, since_ts: float) -> int:
        """Count `internal_thought` entries with timestamp strictly after `since_ts`."""
        n = 0
        for e in self._entries:
            md = e.get("metadata") or {}
            typ = md.get("type") or e.get("type")
            if typ != "internal_thought":
                continue
            try:
                ts = float(e.get("ts", 0))
            except (TypeError, ValueError):
                continue
            if ts > since_ts:
                n += 1
        return n

    def count_dialogue_turns(self) -> int:
        return self._dialogue_turn_count

    def set_active_lesson_plan(self, plan_text: str) -> None:
        self.active_lesson_plan = (plan_text or "").strip()[:8000] or None
        self.plan_updated_at = datetime.now(timezone.utc).isoformat()

    def get_active_lesson_plan(self) -> Optional[str]:
        return self.active_lesson_plan

    def clear_active_lesson_plan(self) -> None:
        self.active_lesson_plan = None
        self.plan_updated_at = None

    def get_tutorial_state(self, unit_id: str) -> Optional[Dict[str, Any]]:
        """Load BTEC tutorial scaffolding row for this user + unit (V44)."""
        if not self._user_id:
            return None
        try:
            from app.services import tutorial_progress_store as _tps

            row = _tps.get_tutorial_row(self._user_id, unit_id)
            if row is None:
                return None
            return _tps.row_to_dict(row)
        except Exception as ex:
            logger.warning("[EmotionalMemoryManager] get_tutorial_state failed: %s", ex)
            return None

    def update_tutorial_state(self, unit_id: str, **updates: Any) -> None:
        if not self._user_id:
            return
        try:
            from app.services import tutorial_progress_store as _tps

            _tps.update_tutorial_row(self._user_id, unit_id, **updates)
        except Exception as ex:
            logger.warning("[EmotionalMemoryManager] update_tutorial_state failed: %s", ex)

    def clear_tutorial_state(self, unit_id: str) -> None:
        if not self._user_id:
            return
        try:
            from app.services import tutorial_progress_store as _tps

            _tps.clear_tutorial_state(self._user_id, unit_id)
        except Exception as ex:
            logger.warning("[EmotionalMemoryManager] clear_tutorial_state failed: %s", ex)
