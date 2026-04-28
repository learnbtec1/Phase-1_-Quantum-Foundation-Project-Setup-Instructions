# Testing — Eduverse frontend

## Framework choice

| Layer | Tool | Notes |
|--------|------|--------|
| Unit / integration (Node) | **`node:test`** + **`tsx`** (for `@/` imports) | **Jest is not used.** Unifying on Node’s built-in runner keeps dependencies small. |
| Browser E2E | **Playwright** (`@playwright/test`) | Config: `playwright.config.ts`, `tests/e2e/`, `tests/ui/`. |
| Backend | **pytest** (see repo `backend/`) | CI: `.github/workflows/backend-tests.yml`. |

## Scripts (run from `frontend/`)

| Script | What it runs |
|--------|----------------|
| `npm run test:ws-url` | `src/lib/wsAgentUrl.test.ts` |
| `npm run test:brain` | `src/store/useBrainStore.brain.test.ts` — `processFrame`, `tickIntentBrain`, `interrupt` |
| `npm run test:normalize` | `src/utils/events/__tests__/normalizeAvatarEvents.test.ts` |
| `npm run test:integration` | `src/integration/brainMotionPipeline.integration.test.ts` — BrainState + gesture tokens (no WebGL) |
| `npm run test:unit` | ws + brain + normalize (fast CI gate) |
| `npm run test:e2e` | Playwright (`tests/e2e/`) — needs dev server or `CI` + build per `playwright.config.ts` |
| `npm run test:ci` | `test:unit` + `test:integration` (used in GitHub Actions) |

From **repository root**: `npm run test:unit`, `npm run test:e2e`, etc. (see root `package.json`).

## CI/CD (GitHub Actions)

| Workflow | Purpose |
|----------|---------|
| `.github/workflows/frontend-unit.yml` | `npm run test:ci` in `frontend/` |
| `.github/workflows/e2e.yml` | `npm run build` + Playwright Chromium |
| `.github/workflows/backend-tests.yml` | `pytest` in `backend/` |
| `.github/workflows/ci-complete.yml` | **Manual full gate** — runs frontend tests + type-check, backend `pytest`, and E2E in one workflow; optional **deploy** job runs **only** when you enable `run_deploy` and **all** three jobs succeed |
| `.github/workflows/deploy.yml` | **Placeholder** — add your host (Vercel/Azure/…) and secrets; manual `workflow_dispatch` only |

**Production deploy gating:** This repo does not ship host secrets. Use **`ci-complete`** with `run_deploy`, or wire `deploy.yml` to your provider and use **GitHub Environments** (required reviewers) so production only deploys after green checks. Prefer **branch protection** rules that require the workflows you rely on (split per-path jobs vs. the combined `ci-complete` run).

## Environment variables

See **`frontend/.env.example`** — includes API/WebSocket URLs, `NEXT_PUBLIC_COGNI_INTEGRATION_TRACE`, `NEXT_PUBLIC_DEBUG_FACE_SYNC`, gesture calibration flags, and pointers to test commands.

## What is *not* fully automated

- **`useAgentAgent`** hook: exercised in the browser (E2E) and indirectly via BrainState tests; no headless hook-only suite.
- **`VRMSkeletonManager` / `LipSyncManager`**: require WebGL + R3F; covered by Playwright canvas smoke + BrainState/integration tests for shared state/events.
