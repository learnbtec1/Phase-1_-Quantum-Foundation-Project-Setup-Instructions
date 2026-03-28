# V56 — FEET FINAL LOCK + WARN ORIGIN FIX

## A) Feet — baseline-relative clamp (`FeetFixer.ts`)

**Algorithm (after `mixer.update` each frame when `?fixFeet=1`):**

1. At **`captureBaseline()`** (called once when the fixer is created for the loaded VRM):  
   `qRelBase = inv(qLowerLegWorld) * qFootWorld` per side.
2. Each **`apply()`**:  
   - `qRelNow = inv(qLowerLegWorld) * qFootWorld`  
   - `qDelta = inv(qRelBase) * qRelNow`  
   - Euler `XYZ` on `qDelta`, clamp **Pitch / Yaw / Roll** (defaults: 35° / 12° / 12°).  
   - `qRelTarget = qRelBase * qDeltaClamped`  
   - `qWorldTarget = qLowerLegWorld * qRelTarget`  
   - Slerp current foot **world** quaternion toward `qWorldTarget` with **blend** (default **0.75**), then **`parent⁻¹ * R_world`** into local `foot.quaternion`.

**Diagnostics:** `window.__feetFix.dump()` returns `{ left?, right? }` with **pitchDeg / yawDeg / rollDeg** of the current **relative** `qRel` (foot vs lower leg), useful for idle/wave checks.

**Pruning:** `?pruneFeet=1` still routes all VRMA clip builds (batch + Cogni dynamic) through `pruneFootTracksFromClip` only — no `PRUNE_FOOT_TRACKS_FOR_TEST` constant.

**Dev-only:** With `?fixFeet=1` in development, small **magenta/cyan** spheres are parented to left/right foot bones (`FeetFixV56DebugMarker`) to verify bone placement.

---

## B) Warning — “using deprecated parameters… pass a single object instead”

| Before | After |
|--------|--------|
| `new VRMLoaderPlugin(parser as never)` | `new VRMLoaderPlugin(parser as never, {})` |

**Rationale:** `@pixiv/three-vrm` **`VRMLoaderPlugin`** is documented as `constructor(parser, options?)`. Passing an explicit **options object** (`{}`) aligns with internal **three-vrm-core** plugin construction and avoids positional-only init warnings seen around **`AvatarCanvas.tsx`** load (stack lines often point at the **`console.warn` shim** ~1712–1716, not the true callee).

**Left unchanged:** `VRMAnimationLoaderPlugin(parser)` — **3.5.x** has no supported object constructor; using `{ gl, … }` would break types/runtime.

**If the warning persists:** capture the **full stack** in DevTools; remaining sources are often **three.js** / extension internals outside this repo.

---

## C) Legacy carpet shim

- **`applyCarpetFloorYFromWorldBox`** remains a **local alias** to `legacyCarpetRedirect` inside `AvatarCanvas.tsx` only (no import from `RoomShell`).
- GroundLock path is unchanged — see `__GROUND_LOCK_V2_REPORT__.md`.

---

## D) Dev APIs

| API | Purpose |
|-----|--------|
| `window.__groundLockV2()` | Ground lock snapshot (`firstFloorY`, `lastAppliedY`, `resetsPerformed`, …) |
| `window.__feetFix.dump()` | Per-foot relative Euler (deg) |

---

## E) Test URLs

- ` /avatar-agent?groundLock=1&fixFeet=1`
- ` /avatar-agent?groundLock=1&fixFeet=1&pruneFeet=1`

**Acceptance (expected):** With **`fixFeet=1`**, relative foot dump shows **|Pitch|** within clamp order, **|Yaw|/|Roll|** ≤ ~12° after stabilization; **`__groundLockV2()`** shows **`resetsPerformed <= 1`** and **`groundLocked === true`** with `?groundLock=1`. If feet still flip with both **`fixFeet`** and **`pruneFeet`**, treat as rest-pose / asset issue and extend diagnostics (clip names, `qRelNow` vs `qRelBase`).

---

## F) `forward-logs-shared.ts`

Not present under `frontend/` in this workspace; no change applied. If your deployment adds a shared log forwarder, keep VRMA **specVersion** warnings as warnings only (do not hide **deprecated init** until the originating call is fixed).
