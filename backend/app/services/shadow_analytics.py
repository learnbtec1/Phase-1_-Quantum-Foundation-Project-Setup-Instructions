# -*- coding: utf-8 -*-
"""
shadow_analytics.py — Silent Student Journey Logger
====================================================
Logs every meaningful interaction event to a per-student JSONL file
without affecting latency (fire-and-forget writes via executor).

This is the "Teacher Report" data layer — it captures:
  • How long a student spent in each BTEC level (P/M/D)
  • Where they got stuck (criterion difficulty signals)
  • Persona switches and their timing
  • Turn counts and response latency

Storage: backend/data/analytics/{student_id}.jsonl
         backend/data/analytics/_aggregate.jsonl  (all students, for ministry reports)

Event schema (one JSON object per line):
  {
    "ts":           "ISO-8601",          -- UTC timestamp
    "session_id":   "uuid",             -- per-WS-connection ID
    "student_id":   "anonymous|...",    -- configurable
    "event":        "turn|persona_switch|session_start|session_end|...",
    "persona":      "pass|merit|distinction",
    "turn":         int,                -- turn index in session
    "duration_ms":  int,                -- for turn events: LLM latency
    "transcript_len": int,
    "dialogue_len":   int,
    "btec_unit":    "unit25|...",
    "btec_level":   "pass|merit|distinction",
    "next_criterion": "P1|M2|...",
    "extra":        {}                  -- arbitrary extra context
  }
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("nexus.analytics")

# ── Storage directory ─────────────────────────────────────────────────────────
_ANALYTICS_DIR = Path(
    os.getenv(
        "ANALYTICS_DIR",
        str(Path(__file__).parent.parent.parent / "data" / "analytics"),
    )
)
_ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)

# ── Input-validation pattern (prevent path traversal) ────────────────────────
_SAFE_ID = re.compile(r'[^a-zA-Z0-9_\-]')


def _safe_id(value: str) -> str:
    sanitised = _SAFE_ID.sub('_', (value or "anonymous").strip())
    return sanitised[:64] or "anonymous"


# ── Per-session state ─────────────────────────────────────────────────────────

class SessionTracker:
    """
    Lightweight per-WebSocket-connection analytics state.

    Attach one instance to each WS handler:
        tracker = SessionTracker(student_id="hamza_001")

    Then call the relevant method on each event:
        await tracker.session_start(persona_level="pass")
        await tracker.log_turn(transcript="...", dialogue="...", duration_ms=420)
        await tracker.log_persona_switch(old="pass", new="merit")
        await tracker.session_end()
    """

    def __init__(self, student_id: str = "anonymous") -> None:
        self.student_id  = _safe_id(student_id)
        self.session_id  = str(uuid.uuid4())
        self.turn_count  = 0
        self.persona     = "pass"
        self.btec_unit   = ""
        self.btec_level  = "pass"
        self.next_criterion = ""

        # Level timings: track when the student entered each level
        self._level_entered_at: Dict[str, float] = {}
        self._level_seconds:    Dict[str, float] = {"pass": 0.0, "merit": 0.0, "distinction": 0.0}

        # Total session start (monotonic)
        import time
        self._session_start = time.monotonic()
        self._level_entered_at[self.persona] = self._session_start

        # Per-student file + aggregate file handles (lazy open)
        self._student_path    = _ANALYTICS_DIR / f"{self.student_id}.jsonl"
        self._aggregate_path  = _ANALYTICS_DIR / "_aggregate.jsonl"

    # ── Internal write helper ─────────────────────────────────────────────────

    def _write(self, event_data: dict) -> None:
        """Append one JSON line to both the student file and aggregate file.
        Runs in the background — never blocks the event loop."""
        line = json.dumps(event_data, ensure_ascii=False)
        try:
            with self._student_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
            with self._aggregate_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception as exc:
            logger.debug("[Analytics] Write error: %s", exc)

    def _event(self, event: str, extra: Optional[Dict[str, Any]] = None) -> dict:
        """Build a base event dict."""
        import time
        return {
            "ts":           datetime.now(timezone.utc).isoformat(),
            "session_id":   self.session_id,
            "student_id":   self.student_id,
            "event":        event,
            "persona":      self.persona,
            "turn":         self.turn_count,
            "btec_unit":    self.btec_unit,
            "btec_level":   self.btec_level,
            "next_criterion": self.next_criterion,
            "extra":        extra or {},
        }

    def _fire(self, event_data: dict) -> None:
        """Schedule a non-blocking background write."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.run_in_executor(None, self._write, event_data)
            else:
                self._write(event_data)
        except RuntimeError:
            self._write(event_data)

    # ── Public logging methods ────────────────────────────────────────────────

    async def session_start(self, persona_level: str = "pass") -> None:
        """Call immediately after the WebSocket is accepted."""
        import time
        self.persona = persona_level
        self._session_start = time.monotonic()
        self._level_entered_at = {persona_level: self._session_start}
        ev = self._event("session_start")
        self._fire(ev)
        logger.debug("[Analytics] session_start sid=%s", self.session_id[:8])

    async def log_turn(
        self,
        *,
        transcript: str = "",
        dialogue: str = "",
        duration_ms: int = 0,
        emotion: str = "neutral",
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Call after each LLM round-trip completes."""
        self.turn_count += 1
        ev = self._event("turn")
        ev.update({
            "duration_ms":    duration_ms,
            "transcript_len": len(transcript),
            "dialogue_len":   len(dialogue),
            "emotion":        emotion,
            "extra":          extra or {},
        })
        self._fire(ev)

    async def log_persona_switch(self, old: str, new: str) -> None:
        """Call when the persona level changes (P→M, M→D, etc.)."""
        import time
        now = time.monotonic()

        # Accumulate time spent in the old level
        if old in self._level_entered_at:
            elapsed = now - self._level_entered_at[old]
            self._level_seconds[old] = self._level_seconds.get(old, 0.0) + elapsed

        self._level_entered_at[new] = now
        self.persona = new

        ev = self._event("persona_switch")
        ev["extra"] = {"from": old, "to": new}
        self._fire(ev)
        logger.debug("[Analytics] persona_switch %s→%s sid=%s", old, new, self.session_id[:8])

    async def update_btec_state(
        self,
        unit_id: str = "",
        btec_level: str = "pass",
        next_criterion: str = "",
    ) -> None:
        """Call after a `btec_progress_ack` frame is processed."""
        self.btec_unit      = unit_id
        self.btec_level     = btec_level
        self.next_criterion = next_criterion
        ev = self._event("btec_progress_update")
        self._fire(ev)

    async def session_end(self) -> None:
        """Call when the WebSocket disconnects."""
        import time
        now = time.monotonic()

        # Finalise current level timing
        if self.persona in self._level_entered_at:
            elapsed = now - self._level_entered_at[self.persona]
            self._level_seconds[self.persona] = (
                self._level_seconds.get(self.persona, 0.0) + elapsed
            )

        total_s = now - self._session_start
        ev = self._event("session_end")
        ev["extra"] = {
            "total_seconds":      round(total_s, 1),
            "turns":              self.turn_count,
            "level_seconds":      {k: round(v, 1) for k, v in self._level_seconds.items()},
        }
        self._fire(ev)
        logger.info(
            "[Analytics] session_end sid=%s turns=%d total=%.0fs",
            self.session_id[:8], self.turn_count, total_s,
        )


# ── Utility: quick per-student report summary ─────────────────────────────────

def student_summary(student_id: str) -> dict:
    """
    Read the student's JSONL and return a quick summary dict:
        {sessions, total_turns, level_seconds, last_seen, criteria_encountered}

    Returns an empty dict if no data found.
    """
    path = _ANALYTICS_DIR / f"{_safe_id(student_id)}.jsonl"
    if not path.exists():
        return {}

    sessions: set = set()
    total_turns   = 0
    level_secs: Dict[str, float] = {"pass": 0.0, "merit": 0.0, "distinction": 0.0}
    criteria:   set = set()
    last_seen   = ""

    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            sessions.add(ev.get("session_id", ""))
            last_seen = ev.get("ts", last_seen)
            if ev.get("event") == "turn":
                total_turns += 1
            if ev.get("event") == "session_end":
                for lvl, secs in (ev.get("extra", {}).get("level_seconds") or {}).items():
                    level_secs[lvl] = level_secs.get(lvl, 0.0) + float(secs)
            if ev.get("next_criterion"):
                criteria.add(ev["next_criterion"])
    except Exception as exc:
        logger.warning("[Analytics] summary read error: %s", exc)
        return {}

    return {
        "student_id":         student_id,
        "sessions":           len(sessions),
        "total_turns":        total_turns,
        "level_seconds":      {k: round(v, 1) for k, v in level_secs.items()},
        "criteria_encountered": sorted(criteria),
        "last_seen":          last_seen,
    }
