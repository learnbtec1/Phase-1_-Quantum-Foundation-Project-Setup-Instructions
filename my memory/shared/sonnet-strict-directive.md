# Sonnet Strict Execution Directive (Current Session)

You MUST execute in this order:

## Step 0 — Read shared memory first (mandatory)
- my memory/shared/index.md
- my memory/shared/handoff.md
- my memory/gpt/GPT-0001.md
- my memory/sonnet/SONNET-0001.md

## Step 1 — Preserve stability hard-constraints
- Do not break Avatar visibility.
- Do not remove domReady Canvas safety gate.
- Do not set primary VRM path to /models/cogni.vrm (404 on this machine).

## Step 2 — Execute next roadmap item only
Roadmap (from latest diagnostic):
1) Stable VRMA enablement (safe fallback, no black screen)
2) Full intensity/mood propagation through all UnifiedGestureEngine paths
3) Word-boundary bridge (next phase)

Execute only unfinished parts, keep diffs minimal.

## Step 3 — Validation (mandatory)
- npx tsc --noEmit --skipLibCheck
- ReadLints for changed files
- Runtime check notes (what was tested)

## Step 4 — Write report (append only)
Append to: my memory/sonnet/SONNET-0001.md
Include:
- Timestamp
- Files changed
- Exact validation outputs
- Remaining risks
- Next step

## Step 5 — Run memory manager
powershell -ExecutionPolicy Bypass -File "my memory/scripts/memory-manage.ps1" -MaxGB 10
