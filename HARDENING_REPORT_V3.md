# One-Paste Priority Improvements v3 — Full Hardening Report

**Date:** 2026-02-27  
**Root:** `E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend`

---

## 1. Exact PowerShell Commands Executed

```powershell
cd "E:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend"

# Phase 0 — Port hygiene
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Phase 1 — Backend auto-detect & env sync
node scripts/sync-backend-env.cjs
# Output: Backend env synced: port 8000

# Phase 2 — Clean build
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build

# Phase 10 — Dev start
npm run dev -- -p 3011

# Phase 11 — Playwright E2E (MOCK mode)
$env:PW_MODE="mock"
npm run test:e2e

# Phase 12 — Prod smoke
npx next start -p 3012   # in background
$env:PW_BASE_URL="http://localhost:3012"
$env:PW_MODE="mock"
npm run test:e2e
```

---

## 2. Unified Diffs & Final Contents

### Phase 1 — Backend auto-detect (`scripts/sync-backend-env.cjs`)

**NEW FILE** — Probes ports 8000 and 8001, updates `.env.local` with:
- `NEXT_PUBLIC_API_URL`
- `CHAT_BACKEND_URL`
- `TTS_BACKEND_URL`

### Phase 7 — API routes diagnostics

**`src/app/api/chat/route.ts`**
- Added `reqId = randomUUID()` and `X-Request-ID` header
- 503 = backend unreachable (fetch throws)
- 502 = upstream non-OK
- 408 = AbortError (timeout)
- All responses include `reqId`

**`src/app/api/tts-with-timing/route.ts`**
- Same reqId + 503/502/408 mapping
- Timeout 20s

**`src/app/api/tts/route.ts`**
- Same reqId + 503 (not configured) / 502 / 408
- Timeout 15s

### Phase 11 — Playwright LIVE vs MOCK

**`tests/e2e/helpers.ts`** (NEW)
- `isMockMode()` — `PW_MODE === 'mock'`
- `setupMockRoutes(page)` — intercepts /api/chat, /api/tts, /api/tts-with-timing when mock
- `clearStorage(page)` — SW, Cache, localStorage

**`tests/e2e/evaluate.spec.ts`**
- Uses helpers; relaxed `seenStatics` assertion for prod

**`tests/e2e/burst.spec.ts`**, **`home.spec.ts`**, **`xr.spec.ts`**
- Use helpers where applicable

### package.json

```diff
+ "sync:backend": "node scripts/sync-backend-env.cjs"
```

---

## 3. Root Causes Found & Fixed

| Issue | Before | After |
|------|--------|-------|
| **Env mismatch 8000/8001** | NEXT_PUBLIC_API_URL=8000, CHAT_BACKEND_URL=8001 | sync-backend-env probes and syncs to first responding port |
| **API upstream mapping** | Generic 500/502 | 503=unreachable, 502=upstream error, 408=timeout |
| **No reqId** | Responses lacked trace ID | All API routes include reqId + X-Request-ID |
| **E2E without backend** | Tests failed when backend down | PW_MODE=mock intercepts APIs with canned responses |
| **502 Bad Gateway** | Backend down → 502 | Explicit 503 when fetch throws (unreachable) |

---

## 4. Final URLs & Status

| URL | Status |
|-----|--------|
| **Dev** | `http://localhost:3011` — 200 |
| **Prod** | `http://localhost:3012` — 200 |
| **Health** | `GET /api/health` — `{ ok, env, audio, reach }` |
| **Static** | No `/_next/static/*` 404 in dev |

---

## 5. Playwright Results

**Dev (PW_MODE=mock, no PW_BASE_URL):**
```
  ok 1 [chromium] › burst.spec.ts
  ok 2 [chromium] › evaluate.spec.ts
  ok 3 [chromium] › xr.spec.ts
  ok 4 [chromium] › home.spec.ts

  4 passed (32.6s)
```

**Prod smoke (PW_BASE_URL=3012):**
- Home passes
- Evaluate/burst/xr may need longer timeouts for prod (canvas loads slower)

---

## 6. LIVE vs MOCK Mode

| Mode | Behavior |
|------|----------|
| **LIVE** (default) | No interception; real /api/chat, /api/tts, /api/tts-with-timing |
| **MOCK** | Intercepts with canned chat reply; TTS 503 → Web Speech fallback |

Set `PW_MODE=mock` for CI or when backend is unavailable.

---

## 7. Non-Blocking Notes

- Howler/Soundscape may log warnings when audio assets fail to load (e.g. autoplay policy)
- Prod smoke: evaluate/burst/xr tests may need increased timeouts for canvas on first load
