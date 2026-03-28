# GROUND LOCK V2 — Implementation Report

## Objective

Stop vertical drift by locking floor calibration after the first successful pass (with optional single recalibration), ignoring floor deltas ≤ **0.02 m**, and fusing further resets. Rapier init remains a singleton via `_rapierWorldInitPromise` in `rapierColliders.ts` (unchanged).

## New module

| File | Role |
|------|------|
| `frontend/src/engine/ground/GroundLock.ts` | `createGroundLock()` — `groundLockedRef`, `firstFloorYRef`, `lastAppliedYRef`, `allowedResetsRef` (starts at **1**), `resetsPerformedRef`, `tryApplyFloorY(nextY, applyAvatarGroundOffset)` |

## Guarded sites (wiring)

1. **`AvatarCanvas` (default export)**  
   - Carpet settle path: `onCarpet` debounces with `CARPET_FLOOR_SETTLE_MS` (**150 ms**), then `applyLockedCarpetFloor(box)` calls `tryApplyFloorY(proposed, applyAvatarGroundOffset)` with `proposed = (box.max.y ?? 0) + RUG_WALK_SURFACE_Y_EXTRA` (module snapshot of `readRugWalkSurfaceYExtraEnv()`, same semantics as `applyCarpetFloorYFromWorldBox` in RoomShell).  
   - `applyAvatarGroundOffset` updates `ROOM_BOUNDS` (floor + default XZ), `setPlayableBounds`, then dispatches `room:bounds:applied` **before** optional `?groundLock=1` fuse so the first stand/foot reset still runs when the query param is used.  
   - Dev: `window.__groundLockV2()` returns `{ groundLocked, firstFloorY, lastAppliedY, allowedResetsLeft, resetsPerformed }`.

2. **`VRMScene`**  
   - `room:bounds:applied` handler: early return if `groundLockedRef.current`.  
   - `room:footRecalib` handler: early return if locked.  
   - `[V52] foot–floor calibration` log: only if `!groundLockedRef.current`.

3. **`EduverseCarpetGlbFloor`**  
   - Double-rAF bounds emission: early exit if `groundLockedRef?.current` (before/inside rAF).

4. **`EduverseRoomBackdrop`**  
   - Passes `groundLockedRef` into `EduverseCarpetGlbFloor`.

5. **`OfficeDeskFromGltf`**  
   - Collider registration effect: early return if `groundLockedRef?.current` before first registration (edge/HMR); ref is **not** in the effect dependency array so a later lock does not clear the desk scene.

## First `floorY`, `lastAppliedY`, reset count

These are **runtime** values stored in refs. After load, in devtools:

```js
window.__groundLockV2?.()
```

- **`firstFloorY`**: baseline Y from the first accepted `tryApplyFloorY`.  
- **`lastAppliedY`**: last accepted floor Y.  
- **`resetsPerformed`**: number of accepted applications where `firstFloorYRef !== nextY` (post-baseline recalibrations consumed).  
- **`groundLocked`**: `true` when locked by fuse, `allowedResetsRef <= 0`, or absolute lock inside `tryApplyFloorY`.

## Dev URL toggle

- Append **`?groundLock=1`** — after the **first** successful `applyAvatarGroundOffset`, `groundLockedRef` is set to `true` (immediate lock for testing; `room:bounds:applied` still runs once because dispatch happens before the query check).

## Expected log behavior

- `[V55] room bounds applied — stand reset + foot re-calibration` at most **twice** in normal flows (initial + optional single reset), then stops when locked.  
- `[V52] foot–floor calibration` does not print after lock.  
- `[G2/V56] carpet → tryApplyFloorY` logs proposed floor and `groundLocked` state once per carpet settle pass.

## Physics

- `frontend/src/app/avatar-agent/physics/rapierColliders.ts` — `_rapierWorldInitPromise` singleton retained; no duplicate `RAPIER.init` on remount.
