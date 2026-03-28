# Performance repair V1 — AvatarCanvas & scene (Ultra Surgical)

**Date:** 2026-03-28  
**Scope:** `frontend/src/app/avatar-agent/AvatarCanvas.tsx`, `frontend/src/app/avatar-agent/physics/rapierColliders.ts`

## What was fixed

### 1. Eduverse carpet — single AABB dispatch (V57)
- **Loop:** `useEffect(..., [object])` re-ran whenever the carpet primitive was recreated; double `requestAnimationFrame` dispatched `room:carpetBounds` repeatedly → main-thread work + downstream `room:bounds:applied` / foot recalibration churn.
- **Fix:** `carpetBoundsDispatchedRef` — measure and dispatch **once** per carpet mesh lifetime; log tag `(once)`.

### 2. Office desk GLB — stable layout memo (V57)
- **Loop:** `useMemo(..., [scene, floorY, zCenter])` rebuilt the cloned desk whenever `floorY` moved (carpet settle) → new `deskRoot` → `useEffect([deskRoot])` called `setDeskScene` + chair anchor **every frame** of that drift.
- **Fix:** Horizontal layout uses `ROOM_BOUNDS_DEFAULT.floorY` only for bbox centering; `useMemo` deps are **`[scene, zCenter]`** only. World Y comes from `deskPosition = [px, floorY, pz]` via a small `useMemo` so the mesh tracks the floor without recloning the GLB.

### 3. `room:bounds:applied` — idempotent handler (V57)
- **Loop:** Same `floorY` could still trigger multiple full resets (foot off, Rapier reset, patrol rebuild).
- **Fix:** `lastRoomBoundsFloorYRef` — if `|floorY - last| < 0.02`, skip the heavy path (dev `console.debug` only).

### 4. Rapier — single wasm init promise
- **Loop:** Each `VRMScene` mount called `initRapierWorld()` → repeated `RAPIER.init` / wasm setup (contributed to “deprecated init” / long tasks).
- **Fix:** Module-level `_rapierWorldInitPromise` — first call creates the promise; later calls await the same instance.

### 5. VRMA loader noise & clip setup
- **specVersion / T-pose warnings:** Cannot patch binary `.vrma` assets from code without a custom parser; **temporary `console.warn` filter** during the batch `Promise.allSettled` (restored in `.finally`) suppresses known noisy `VRMAnimationLoaderPlugin` messages.
- **VRMLookAtQuaternionProxy:** `ensureVRMLookAtQuaternionProxyForVrm(model)` runs once after VRM load so `createVRMAnimationClip` does not create/warn for a missing proxy on every clip.
- **Plugin registration:** Centralized `registerVRMAnimationLoaderPlugin(loader)` for Cogni + idle batch loaders.

### 6. `useFrame` / dev diagnostics
- Removed one-shot **`USE-FRAME IS ALIVE`** tracer log.
- Throttled **`[V54]`** dev diagnostics from **1s → 5s** (`V54_DEV_LOG_INTERVAL_SEC`).
- Foot–floor calibration log only in **development**.

## Loops / hotspots addressed

| Source | Symptom | Mitigation |
|--------|---------|------------|
| Carpet `object` identity + effect | Repeated `room:carpetBounds` | Single dispatch ref |
| Desk `useMemo` + `floorY` | `setDeskScene` / collider churn | Decouple layout from live `floorY` |
| Duplicate `room:bounds:applied` | Foot + Rapier reset spam | Floor-Y equality guard |
| Multiple `initRapierWorld` | Extra wasm init / long tasks | Singleton promise |
| VRMA batch | Console + proxy warnings | Warn filter + explicit LookAt proxy |

## Render time / FPS

- Expect **lower main-thread time per frame** after removing redundant desk/carpet registration and duplicate bounds handling. Exact FPS depends on GPU, SSAO, and asset size; the changes **remove unnecessary work**, which is necessary (not sufficient) for a stable **60 FPS** target.

## Not changed (by design)

- **`VRMAnimationLoaderPlugin` constructor** in `@pixiv/three-vrm-animation` **3.5.x** remains `new VRMAnimationLoaderPlugin(parser)` per published typings; “single object” deprecation, if any, comes from **Rapier** or another dependency — Rapier already uses `RAPIER.init({})`.
- **Binary `.vrma` files** — permanent fix for `specVersion` is to re-export assets with `VRMC_vrm_animation.specVersion` set; we only filter console noise in dev.

## Verification checklist

1. Load `/avatar-agent` once: **one** `[V55] EduverseCarpetGlbFloor world AABB (once)` (dev).
2. **One** `[OfficeDeskFromGltf] desk scene registered` per session (unless HMR).
3. **One** foot–floor log in dev (`[V52] foot–floor calibration (once)`).
4. No growing spam of `room:bounds:applied` for the same `floorY`.
5. Profiler: fewer long tasks on the frame after load.
