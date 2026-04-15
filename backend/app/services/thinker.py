# -*- coding: utf-8 -*-
"""
Autonomous inner monologue («الفص الجبهي») for Cogni — per WebSocket session.

- Interval + idle gates; proactive speech; curriculum guard.
- Optional multi-step lesson_plan (Phase 3) stored on EmotionalMemoryManager.
- Near-duplicate thoughts filtered via difflib.SequenceMatcher.
"""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import time
from typing import Awaitable, Callable, Optional

from app.core.config import settings
from app.archive.emotional_memory_manager import EmotionalMemoryManager
from app.services.cognitive_roles import COGNITIVE_ROLE_THINKER_SYSTEM
from app.services.llm_client import cogni_chat_completion

logger = logging.getLogger(__name__)

OnGoalChange = Optional[Callable[[Optional[str]], Awaitable[None]]]
OnProactive = Optional[Callable[[], Awaitable[None]]]
OnSoftNudge = Optional[Callable[[], Awaitable[None]]]
LastInteractionFn = Optional[Callable[[], float]]
BusyFn = Optional[Callable[[], bool]]

_NEW_TOPIC_HINTS = re.compile(
    r"اشرح|وضّح|درس|موضوع|وحدة|تعريف|ما\s*هو|ما\s*هي|دورة\s*حياة|درسنا|صفحة|فصل|واجب\s*جديد",
    re.I | re.UNICODE,
)


def _extract_json_object(raw: str) -> Optional[dict]:
    if not raw:
        return None
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```\s*$", "", s)
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _text_similar(a: str, b: str, threshold: float) -> bool:
    """Ratio of whole-string alignment — works better than word Jaccard for Arabic."""
    if not a or not b or len(a) < 8 or len(b) < 8:
        return False
    r = difflib.SequenceMatcher(None, a, b).ratio()
    return r > threshold


class AutonomousThinker:
    """Background loop: inner reflection, teaching goal, optional lesson plan, proactive speech."""

    def __init__(
        self,
        memory_manager: EmotionalMemoryManager,
        *,
        interval_seconds: int = 35,
        idle_threshold_seconds: int = 15,
        get_last_interaction: LastInteractionFn = None,
        is_llm_busy: BusyFn = None,
        is_tts_playing: BusyFn = None,
        on_proactive: OnProactive = None,
        on_goal_change: OnGoalChange = None,
        on_soft_nudge: OnSoftNudge = None,
        initial_goal: Optional[str] = None,
    ) -> None:
        self.memory = memory_manager
        self.interval = max(20, int(interval_seconds))
        self.idle_threshold = max(5, int(idle_threshold_seconds))
        self._get_last_interaction = get_last_interaction
        self._is_llm_busy = is_llm_busy
        self._is_tts_playing = is_tts_playing
        self.on_proactive = on_proactive
        self.on_goal_change = on_goal_change
        self.on_soft_nudge = on_soft_nudge
        self._soft_nudge_task: Optional[asyncio.Task[None]] = None
        self.running = False
        self.task: Optional[asyncio.Task[None]] = None
        self.current_goal: Optional[str] = None
        if getattr(self.memory, "restored_goal", None):
            self.current_goal = str(self.memory.restored_goal).strip()[:240] or None
        elif isinstance(initial_goal, str) and initial_goal.strip():
            self.current_goal = initial_goal.strip()[:240]
        self.last_proactive_time: float = 0.0
        self._proactive_anchor_ts: float = 0.0
        self._proactive_n = max(1, int(getattr(settings, "PROACTIVE_THOUGHT_COUNT", 2)))
        self._proactive_cd = max(10, int(getattr(settings, "PROACTIVE_COOLDOWN_SEC", 60)))
        self._sim_th = float(getattr(settings, "THOUGHT_SIMILARITY_THRESHOLD", 0.7))
        self._planning_enabled = bool(getattr(settings, "PLANNING_ENABLED", True))
        self._planning_interval = max(2, int(getattr(settings, "PLANNING_INTERVAL_TURNS", 5)))
        # Pause inner monologue after repeated LLM failures (e.g. quota)
        self._thinker_cooldown_until: float = 0.0
        self._llm_fail_streak: int = 0
        self._last_soft_nudge_at: float = 0.0
        patch = getattr(self.memory, "_thinker_redis_patch", None)
        if isinstance(patch, dict):
            from app.services.cogni_redis_state import apply_thinker_state

            apply_thinker_state(self, {"thinker": patch})
        try:
            self.memory._thinker_redis_patch = None
        except Exception:
            pass

    async def start(self) -> None:
        if self.running:
            return
        self.running = True
        self.task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self.running = False
        if self._soft_nudge_task and not self._soft_nudge_task.done():
            self._soft_nudge_task.cancel()
            self._soft_nudge_task = None
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    async def _run(self) -> None:
        while self.running:
            try:
                await self._think()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("[AutonomousThinker] loop error")
            try:
                await asyncio.sleep(self.interval)
            except asyncio.CancelledError:
                break

    def _should_request_lesson_plan(self) -> bool:
        if not self._planning_enabled:
            return False
        if not self.memory.get_active_lesson_plan():
            return True
        turns = self.memory.count_dialogue_turns()
        if turns > 0 and turns % self._planning_interval == 0:
            return True
        u = self.memory.last_user_text or ""
        if u and _NEW_TOPIC_HINTS.search(u):
            return True
        return False

    async def _update_lesson_plan(self, reason_hint: str) -> None:
        """Revise stored lesson plan when inner thought signals confusion."""
        cur = self.memory.get_active_lesson_plan() or ""
        sys = (
            COGNITIVE_ROLE_THINKER_SYSTEM.strip()
            + "\n\n"
            + "أنت مخطّط تعليمي لمنهج BTEC إدارة الأعمال. لديك خطة حالية؛ راجعها بإيجاز وأضف خطوة توضيحية "
            + "أو مثالاً إذا لزم. أخرج JSON فقط: {\"lesson_plan\": \"...\"}\n"
            + f"سبب المراجعة (داخلي): {reason_hint[:400]}"
        )
        user = f"الخطة الحالية:\n{cur[:4000]}"
        try:
            raw = await cogni_chat_completion(
                [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                model=getattr(settings, "THINKER_MODEL", None) or getattr(settings, "TUTOR_MODEL_FREE", "gpt-4o-mini"),
                max_tokens=400,
                temperature=0.55,
                user_id=self.memory.user_id if getattr(self.memory, "user_id", None) else None,
            )
        except Exception as e:
            logger.warning("[AutonomousThinker] plan revision LLM failed: %s", e)
            return
        data = _extract_json_object(raw)
        if not data:
            return
        lp = data.get("lesson_plan")
        if lp and str(lp).strip():
            self.memory.set_active_lesson_plan(str(lp).strip()[:8000])
            logger.info("[AutonomousThinker] lesson plan revised (len=%d)", len(str(lp)))

    async def _think(self) -> None:
        if self._is_llm_busy and self._is_llm_busy():
            logger.info("[AutonomousThinker] skip — LLM/pipeline busy (is_llm_busy)")
            return
        if self._is_tts_playing and self._is_tts_playing():
            logger.info("[AutonomousThinker] skip — TTS playing (is_tts_playing)")
            return

        last_t = time.time()
        if self._get_last_interaction is not None:
            try:
                last_t = float(self._get_last_interaction())
            except Exception:
                last_t = time.time()
            idle_sec = time.time() - last_t
            if idle_sec < self.idle_threshold:
                logger.info(
                    "[AutonomousThinker] skip — idle not met (%.1fs < %ds)",
                    idle_sec,
                    self.idle_threshold,
                )
                return

        _mono = time.monotonic()
        if _mono < self._thinker_cooldown_until:
            logger.warning(
                "[AutonomousThinker] skip — thinker cooldown active (%.0fs left) due to repeated LLM failures",
                self._thinker_cooldown_until - _mono,
            )
            return

        recent = self.memory.get_recent(
            limit=8,
            types=["conversation", "internal_thought", "emotion"],
        )
        last_thought = self.memory.get_last_of_type("internal_thought")
        goal_line = self.current_goal or "لا يوجد"
        want_plan = self._should_request_lesson_plan()

        plan_instructions = ""
        if want_plan:
            plan_instructions = (
                "\n\nإذا رأيت أن الطالب بدأ موضوعاً جديداً أو يحتاج شرحاً منظماً، أضف حقل lesson_plan: "
                "نص عربي يحتوي 2–4 خطوات مرقّمة أو جمل قصيرة (كل خطوة في سطر). "
                "إن لم تكن هناك حاجة، اجعل lesson_plan قيمة null.\n"
            )

        system_prompt = (
            COGNITIVE_ROLE_THINKER_SYSTEM.strip()
            + "\n\n"
            + "أنت العقل الباطن للمعلّم «كوجني» في منصة إيدوفيرس — **مختص في BTEC إدارة الأعمال** (وليس كامل المناهج الأردنية).\n"
            + "تفكير داخلي لا يُقرأ للطالب كما هو؛ ركّز على تقييم الفهم، والتخطيط، والخطوة التالية ضمن إطار الوحدة/المعايير.\n\n"
            + "قواعد:\n"
            + "- لا أفكار ترفيهية/سياسية بعيدة عن الدرس.\n"
            + "- فكرة داخلية قصيرة بالعربية (1–2 جملة).\n"
            + f"{plan_instructions}"
            + "أخرج JSON فقط بدون markdown، بالشكل:\n"
            + '{"thought": "...", "goal": "مهمة قصيرة أو null", "lesson_plan": "خطوات أو null"}\n'
        )

        user_context = (
            f"ذكريات حديثة: {recent!r}\n"
            f"آخر فكرة داخلية: {last_thought!r}\n"
            f"الهدف المخزّن: {goal_line}\n"
            f"خطة نشطة حالياً: {self.memory.get_active_lesson_plan()!r}\n"
            f"طلب خطة في هذه الدورة: {want_plan}"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_context},
        ]

        try:
            # Inner monologue uses the fast/cheap model — gpt-4o-mini is ideal:
            # • Lower cost (background process, high frequency)
            # • Sufficient for Arabic reflection + JSON output
            # • Keeps premium gpt-4o budget for actual student turns
            response = await cogni_chat_completion(
                messages,
                model=getattr(settings, "THINKER_MODEL", None) or getattr(settings, "TUTOR_MODEL_FREE", "gpt-4o-mini"),
                max_tokens=420 if want_plan else 220,
                temperature=0.65,
                user_id=self.memory.user_id if getattr(self.memory, "user_id", None) else None,
            )
        except Exception as e:
            self._llm_fail_streak += 1
            logger.warning("[AutonomousThinker] LLM call failed: %s", e)
            strike_need = max(2, int(getattr(settings, "LLM_FAILURE_COOLDOWN_COUNT", 3)))
            strike_cd = float(getattr(settings, "THINKER_LLM_STRIKE_COOLDOWN_SEC", 300))
            if self._llm_fail_streak >= strike_need:
                self._thinker_cooldown_until = time.monotonic() + strike_cd
                logger.warning(
                    "[AutonomousThinker] Thinker disabled for %.0fs due to repeated LLM failures (streak=%d)",
                    strike_cd,
                    self._llm_fail_streak,
                )
                self._llm_fail_streak = 0
            return

        self._llm_fail_streak = 0

        data = _extract_json_object(response)
        if not data:
            logger.info(
                "[AutonomousThinker] Unparseable inner-thought JSON (first 200 chars): %s",
                (response or "")[:200],
            )
            return

        thought = data.get("thought")
        new_goal = data.get("goal")
        lesson_plan = data.get("lesson_plan")

        if new_goal in (None, "", "null"):
            new_goal = None
        elif isinstance(new_goal, str):
            new_goal = new_goal.strip()[:240] or None

        if lesson_plan in (None, "", "null"):
            lesson_plan = None
        elif isinstance(lesson_plan, str):
            lesson_plan = lesson_plan.strip()[:8000] or None

        if thought and str(thought).strip():
            t = str(thought).strip()[:600]
            prev = self.memory.get_last_of_type("internal_thought")
            if prev and _text_similar(prev, t, self._sim_th):
                logger.debug(
                    "[AutonomousThinker] skipped near-duplicate thought (difflib > %.2f)",
                    self._sim_th,
                )
                return

            low = t.lower()
            if any(x in low for x in ("لم يفهم", "صعب", "يحتاج مثال", "ارتباك", "لم افهم", "ما فهمت")):
                if self._planning_enabled and self.memory.get_active_lesson_plan():
                    await self._update_lesson_plan(t)

            self.memory.record_moment(
                user_mood="internal",
                avatar_emotion="thoughtful",
                intensity=0.4,
                topic=t[:100],
                metadata={"type": "internal_thought", "full_thought": t},
            )
            logger.info("🧠 [COGNI'S INNER THOUGHT]: %s", t[:200])

            if self.on_soft_nudge:
                if self._soft_nudge_task and not self._soft_nudge_task.done():
                    self._soft_nudge_task.cancel()
                snap = time.time()
                if self._get_last_interaction is not None:
                    try:
                        snap = float(self._get_last_interaction())
                    except Exception:
                        snap = time.time()

                async def _run_soft_nudge(interaction_snap: float) -> None:
                    # V29 — 10s gate, then +5s; min 120s between nudges to avoid nagging
                    try:
                        await asyncio.sleep(10.0)
                    except asyncio.CancelledError:
                        return
                    if not self.running:
                        return
                    try:
                        cur = (
                            float(self._get_last_interaction())
                            if self._get_last_interaction is not None
                            else time.time()
                        )
                    except Exception:
                        cur = time.time()
                    if cur > interaction_snap + 0.08:
                        return
                    try:
                        await asyncio.sleep(5.0)
                    except asyncio.CancelledError:
                        return
                    if not self.running:
                        return
                    try:
                        cur2 = (
                            float(self._get_last_interaction())
                            if self._get_last_interaction is not None
                            else time.time()
                        )
                    except Exception:
                        cur2 = time.time()
                    if cur2 > interaction_snap + 0.08:
                        return
                    if self._is_llm_busy and self._is_llm_busy():
                        return
                    if self._is_tts_playing and self._is_tts_playing():
                        return
                    now_m = time.time()
                    if now_m - self._last_soft_nudge_at < 120.0:
                        logger.debug("[AutonomousThinker] soft nudge skipped — cooldown 120s")
                        return
                    self._last_soft_nudge_at = now_m
                    try:
                        await self.on_soft_nudge()
                    except Exception as sn_e:
                        logger.warning("[AutonomousThinker] on_soft_nudge failed: %s", sn_e)

                self._soft_nudge_task = asyncio.create_task(_run_soft_nudge(snap))

        if lesson_plan and want_plan:
            self.memory.set_active_lesson_plan(lesson_plan)
            logger.info("[AutonomousThinker] lesson plan set (len=%d)", len(lesson_plan))

        if new_goal is not None and new_goal != self.current_goal:
            self.current_goal = new_goal
            logger.info("[AutonomousThinker] goal → %s", new_goal)
            if self.on_goal_change:
                try:
                    await self.on_goal_change(new_goal)
                except Exception as ge:
                    logger.debug("[AutonomousThinker] on_goal_change failed: %s", ge)

        anchor = max(last_t, self._proactive_anchor_ts)
        try:
            n_th = self.memory.count_thoughts_since(anchor)
        except Exception:
            n_th = 0
        now = time.time()
        if (
            n_th >= self._proactive_n
            and self.on_proactive
            and (now - self.last_proactive_time) >= self._proactive_cd
        ):
            if self._is_llm_busy and self._is_llm_busy():
                logger.debug("[AutonomousThinker] proactive deferred — busy")
                return
            if self._is_tts_playing and self._is_tts_playing():
                logger.debug("[AutonomousThinker] proactive deferred — TTS")
                return
            try:
                logger.info(
                    "[AutonomousThinker] proactive trigger | thoughts_since_anchor=%d need=%d cooldown=%ds",
                    n_th,
                    self._proactive_n,
                    self._proactive_cd,
                )
                # Cooldown starts before await so rapid re-entry cannot stack triggers.
                self.last_proactive_time = now
                await self.on_proactive()
                self._proactive_anchor_ts = time.time()
            except Exception as pe:
                logger.warning("[AutonomousThinker] on_proactive failed: %s", pe)

        if self.memory.persist_enabled and getattr(self.memory, "user_id", None):
            try:
                self.memory._save_redis_snapshot(self)
            except Exception:
                pass


Thinker = AutonomousThinker
