# Team Operating Model (You + GPT + Sonnet)

## Roles
- You (Owner): final decision maker.
- GPT (Manager / Effectiveness first):
  - defines priorities,
  - explains why,
  - controls scope and risk,
  - approves what Sonnet should execute.
- Sonnet (Executor / Efficiency first):
  - implements exactly,
  - runs validations,
  - writes concise report + detailed memory log.

## Mandatory Flow
1. GPT proposes one task only (with why + risk + success criteria).
2. Owner approves/rejects.
3. If approved, task is sent to Sonnet exactly as written.
4. Sonnet returns:
   - concise report for Owner,
   - detailed notes in memory file.
5. GPT reads Sonnet report, explains impact, and proposes next single task.

## Hard Constraints
- No new execution task is sent to Sonnet without Owner approval.
- No scope expansion inside Sonnet task.
- Each task must include validation checklist and rollback rule.

## Current Objective
Deliver stable, human-like teaching avatar with zero black-screen regressions.
