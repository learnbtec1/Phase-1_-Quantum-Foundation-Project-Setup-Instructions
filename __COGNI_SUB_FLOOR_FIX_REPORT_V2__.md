# COGNI Sub-Floor Recovery — Sovereignty Report **V2** (NEXUS V100 MAX)

**Date:** 2026-03-28  
**Supersedes:** Adds concrete code hooks to `__COGNI_SUB_FLOOR_FIX_REPORT__.md` §2–§4 after regression (images 13 / 16).

---

## 1. Memory recall (source report)

Re-read **`__COGNI_SUB_FLOOR_FIX_REPORT__.md`**:

| Topic | Summary |
|--------|---------|
| **2. Root cause** | Stale V52 foot pass if carpet matrix settled late; early skip when AABB ≈ `ROOM_BOUNDS` skipped foot recovery. |
| **3. New coordinates** | `floorY = carpetWorldBox.max.y + readRugWalkSurfaceYExtraEnv()` (default **+0.06 m**). |
| **4. Foot contact** | V52: `footToFloorYOffsetRef = ROOM_BOUNDS.floorY - footBox.min.y + readAvatarStandYOffsetEnv()`. |

---

## 2. What V2 changed in code

### `frontend/src/config/avatar.ts`

- Confirmed **`readAvatarStandYOffsetEnv()`** default **0** and **`readRugWalkSurfaceYExtraEnv()`** default **0.06** (already correct).
- Comment block ties defaults to this report.

### `frontend/src/app/avatar-agent/scene/RoomShell.tsx`

- **`applyRoomBoundsFromCarpetWorldBox`**: JSDoc now states explicitly  
  `ROOM_BOUNDS.floorY = worldBox.max.y + readRugWalkSurfaceYExtraEnv()` (same as report §3).
- Implementation was already: line `ROOM_BOUNDS.floorY = worldBox.max.y + readRugWalkSurfaceYExtraEnv()`.

### `frontend/src/app/avatar-agent/AvatarCanvas.tsx`

1. **`EduverseCarpetGlbFloor`**  
   - Still uses **double `requestAnimationFrame`** before `setFromObject` / `room:carpetBounds` (V55/V100 timing).

2. **Carpet settle → `applyLockedCarpetFloor`**  
   - After **`tryApplyFloorY(proposed, applyAvatarGroundOffset)`**, always **`dispatch('room:footRecalib')`** (when `window` exists).  
   - **Why:** GroundLock **`tryApplyFloorY`** can **no-op** when `|ΔY| ≤ SMALL_DELTA` (0.02 m), so **`room:bounds:applied`** never runs — V52 never re-ran on a **numerically similar** floor, leaving a **bad first-pass** foot offset (sub-floor / “buried” avatar).

3. **`room:footRecalib` listener (VRMScene)**  
   - Removed **`groundLockedRef`** early return.  
   - Foot re-calibration only resets **`footCalibDoneRef`** + Rapier avatar state; it does **not** mutate `ROOM_BOUNDS` — safe alongside GroundLock.

4. **Dev log** after carpet: tag updated to mention **`footRecalib`**.

---

## 3. GroundLock unchanged

- **`createGroundLock` / `tryApplyFloorY`** logic in `frontend/src/engine/ground/GroundLock.ts` is **unchanged**.
- Floor Y fusion / derivative clamp / reset fuse behave as in **`__GROUND_LOCK_V2_REPORT__.md`**.
- Sub-floor fix is **orthogonal**: forced **foot** pass via **`room:footRecalib`** after every carpet **settle timer** completion.

---

## 4. QA

1. **`/avatar-agent`** with carpet GLB: avatar feet on **rug walk plane** (`floorY = rug max.y + 0.06`), not under pile / void.  
2. With **`?groundLock=1`**: `window.__groundLockV2()` stable; **`window.__feetFix?.dump()`** optional if `?fixFeet=1`.  
3. Idle / breathe: root Y stable relative to **raised** `floorY`.

---

## 5. If regression persists

- Tune **`NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA`** (e.g. **0.07–0.08**).  
- Confirm **`CARPET_FLOOR_SETTLE_MS`** allows matrix settle (default **150 ms** in canvas).  
- Verify **`EDUVERSE_FLOOR_MODE === 'carpet_glb'`** so **`EduverseCarpetGlbFloor`** mounts.

---

*End — NEXUS V100 MAX sub-floor recovery V2. Agent recalled `__COGNI_SUB_FLOOR_FIX_REPORT__.md` and applied sovereign criteria without removing GroundLock.*
