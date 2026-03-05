# One-Paste Priority Improvements Report

**Date:** 2026-02-27  
**Target:** Next.js (App Router) on Windows/PowerShell

---

## 1. PowerShell Commands Executed

```powershell
cd "E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend"

# Port hygiene
$conn = netstat -ano | findstr :3000
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Clean build
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build

# E2E
npm run playwright:install
npm run test:e2e

# Prod smoke (separate terminal)
npx next start -p 3012
$env:PW_BASE_URL="http://localhost:3012"; npm run test:e2e
```

---

## 2. Unified Diffs & Changes

### P0A — Lip-sync reliability flag (`src/components/avatar/VRMAvatar.tsx`)

- **Removed:** `__lipSyncStarted` on event registration.
- **Added:** `lipSyncFlagSetRef`; set flag only when:
  - **Timing-based:** first viseme frame applied from `timingsToVisemeAt()` in `useFrame`.
  - **Procedural:** first procedural viseme applied in `useFrame`.
- Reset `lipSyncFlagSetRef` in `onSpeakEnd`.

### P0B — Audio policy LAST-ONE-WINS (`src/ai/io/tts.ts`)

- Already implemented: `cancelCurrentTTS()` at start of `speakWithTTS()`.
- TTS uses `AudioPool` (acquire/release).

### P0C — AudioPool

- Confirmed: `src/lib/audio-pool.ts` exists; TTS uses `getAudioPool().acquire()`.

### P1D — Burst & XR E2E (`tests/e2e/burst.spec.ts`, `tests/e2e/xr.spec.ts`)

- **burst.spec.ts:** Mocks `/api/chat`, `/api/tts`, `/api/tts-with-timing`; dispatches `test:sendMessage` x3; asserts no static 404.
- **xr.spec.ts:** Smoke test; waits for canvas on `/evaluate`.

### P1E — Health deep-ping (`src/app/api/health/route.ts`)

- Added `pingReachable()` (HEAD, 2s timeout).
- Added `reach: { tts, ttsWithTiming }` from self-ping.
- Non-fatal: health still returns `ok: true` if ping fails.

### P1F — Prod smoke scripts (`package.json`)

- `smoke:prod:start`: `npm run build && next start -p 3012`
- `smoke:prod:test`: `playwright test` (use `PW_BASE_URL=http://localhost:3012`)

### P1G — Chat `test:sendMessage` (`src/components/ui/Chat.tsx`)

- Added `sendMessageWithText(text)`.
- Added listener for `test:sendMessage` with `detail.text`.

### CI — `.github/workflows/e2e.yml`

- Runs on push/PR.
- `npm ci`, `playwright:install`, `playwright test` in `frontend/`.

---

## 3. What Improved and Why

| Area | Change | Reason |
|------|--------|--------|
| **Lip-sync flag** | Set only on first applied viseme (timing or procedural) | Avoids false positives from listener registration |
| **Audio policy** | LAST-ONE-WINS via `cancelCurrentTTS()` | Prevents overlapping TTS |
| **E2E coverage** | Burst + XR tests | Broader coverage for rapid messages and XR |
| **Health** | Optional reachability ping for TTS routes | Better diagnostics without failing health |
| **Prod smoke** | Scripts for build + start + test | Validates production build |
| **E2E triggers** | `test:sendMessage` + `sendMessageWithText` | Programmatic message injection for tests |

---

## 4. Final Dev URL and Status

- **Dev:** `http://localhost:3011` (from `npm run dev -- -p 3011`)
- **Prod smoke:** `http://localhost:3012` (from `next start -p 3012`)
- **Health:** `GET /api/health` → `{ ok, time, env, audio, reach }`

---

## 5. Playwright Results

Run:

```powershell
cd frontend
npm run test:e2e
```

Tests:

- `home.spec.ts` — home paints, no static 404
- `evaluate.spec.ts` — 3D avatar, lip-sync, mocks for chat/TTS
- `burst.spec.ts` — burst messages, no overlapping TTS
- `xr.spec.ts` — XR smoke

For prod smoke:

```powershell
# Terminal 1
npm run smoke:prod:start

# Terminal 2
$env:PW_BASE_URL="http://localhost:3012"; npm run test:e2e
```

---

## 6. E2E Adjustments

- **Click target:** Use `page.click('body', { position: { x: 50, y: 50 } })` instead of `canvas` (Chat overlay blocks canvas).
- **Evaluate test:** Mocks `/api/chat`, `/api/tts`, `/api/tts-with-timing`; fills input, clicks send; waits for `__lipSyncStarted`.
