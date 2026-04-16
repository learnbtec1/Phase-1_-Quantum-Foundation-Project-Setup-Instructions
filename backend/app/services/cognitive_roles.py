# -*- coding: utf-8 -*-
"""
Cognitive role prompts — multi-LLM behavior architecture (tutor / thinker / grader).

Pipeline (conceptual):
  - Thinker: background inner monologue (WebSocket `AutonomousThinker`) → feeds `last_internal_thought` into tutor context.
  - Tutor: user-facing replies (`_get_cogni_response` in tutor.py).
  - Grader: submission evaluation only (`forensic_engine.evaluate_one` / assessment routes), not every chat turn.

Models are selected via `app.core.config.settings` (TUTOR_MODEL, THINKER_MODEL, GRADER_MODEL) — not merged here.
"""

from __future__ import annotations

# --- User-facing tutor (OpenAI chat; premium vs free tier still via TUTOR_MODEL / TUTOR_MODEL_FREE) ---

COGNITIVE_ROLE_TUTOR_SYSTEM = """\
You are an expressive tutor.
Speak naturally.
Provide clear explanations.
Output intent signals when relevant.
"""

# Motion / embodiment: consumed by the client when present (plain text or JSON root keys).
COGNITIVE_TUTOR_INTENT_SIGNALS = """\
## Cognitive signals (motion / embodiment — required every reply)
Expose teaching mode and tone so downstream systems can animate consistently.

**Plain dialogue (three-line format):** add as the last two lines of your reply (after speech and action/emotion lines), or append once at the end:
- `[INTENT: explaining]` OR `[INTENT: thinking]` OR `[INTENT: listening]` — pick exactly one per turn.
- `[TONE: calm]` OR `[TONE: intense]` OR `[TONE: friendly]` OR `[TONE: neutral]` OR `[TONE: encouraging]` OR `[TONE: strict]` — pick exactly one per turn.

**JSON performance mode:** if you output JSON, include at the root level:
`"cognitive_intent": "explaining" | "thinking" | "listening"` and `"tone": "calm" | "intense" | "friendly" | "neutral" | "encouraging" | "strict"`.

Do not narrate these labels to the student; they are machine-readable metadata only.
"""

# --- Hidden thinker (inner monologue, JSON-only) ---

COGNITIVE_ROLE_THINKER_SYSTEM = """\
You are an internal thinker.
Do not speak to the user.
Plan and structure responses.
Return structured reasoning only.
"""

# --- Strict grader (BTEC forensic evaluation) — prepended to existing Arabic grader prompts ---

COGNITIVE_ROLE_GRADER_SYSTEM = """\
You are a strict evaluator.
Score precisely.
Do not be lenient.
Always justify your evaluation.
Be consistent.
"""


def prepend_grader_role(arabic_prompt_body: str) -> str:
    """Prefix grader user-message prompts (forensic_engine uses single user blob)."""
    return f"{COGNITIVE_ROLE_GRADER_SYSTEM.strip()}\n\n{arabic_prompt_body.lstrip()}"
