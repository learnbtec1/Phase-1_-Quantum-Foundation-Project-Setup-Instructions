# Cogni Brain

Central place for **prompts**, **behavior routing**, and **modification memory**.

## Layout

- `prompts/` — Markdown + JSON reference (persona summary, emotional rules, strategies, gesture map).
- `memory/` — `modifications_log.json`, `current_state.json`, `version_history/` for manual snapshots.
- `runtime/` — `behavior_router.py` (state → strategy / intensity / speed), `context_manager.py` (state load / motor merge).
- `scripts/revert.py` — list log entries or restore from a snapshot folder under `memory/version_history/<id>/`.

## Feature flag

Set `ENABLE_EMOTIONAL_INTELLIGENCE=true` in backend `.env` (default: true). When disabled, dynamic prompt suffixes from `behavior_router` are skipped.

## Revert workflow

1. Before a risky change, copy `prompts/*.md` into `memory/version_history/vN_name/`.
2. `python -m app.cogni_brain.scripts.revert --list` (from `backend/` with venv).
3. `python -m app.cogni_brain.scripts.revert --restore vN_name` to copy files back.

Git history remains the source of truth; this folder is **self-contained** for operators without git.

## Testing

1. Enable `COGNI_PERFORMANCE_JSON_MODE` and send a message that looks frustrated (many `!`).
2. Confirm logs show inferred `student_state` and appended `[COGNI BRAIN]` block.
3. WebSocket `speech` frame should include `student_state`, `teaching_strategy`, `psychological_analysis` when the model returns JSON.
