# COGNI Sub-Floor Recovery — Surface Sovereignty Report (V100 MAX)

**Date:** 2026-03-28  
**Scope:** Avatar buried below the visible floor / rug; incorrect Z on carpet; foot–floor vs backdrop timing.

---

## 1. Where the bug lived

| Area | File | Role |
|------|------|------|
| Logical walk height | `frontend/src/app/avatar-agent/scene/RoomShell.tsx` | `ROOM_BOUNDS.floorY`, `applyRoomBoundsFromCarpetWorldBox()` |
| Carpet measurement + timing | `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | `EduverseCarpetGlbFloor` → `room:carpetBounds` |
| Avatar Y (root + V52 foot) | `frontend/src/app/avatar-agent/AvatarCanvas.tsx` | `useFrame` — `footToFloorYOffsetRef`, `standTargetY` |
| Tunables | `frontend/src/config/avatar.ts` | `readAvatarStandYOffsetEnv`, **new** `readRugWalkSurfaceYExtraEnv` |

There is **no** separate `frontend/src/components/AvatarCanvas.tsx`; the live canvas is  
`frontend/src/app/avatar-agent/AvatarCanvas.tsx`.

---

## 2. Root cause (coordinates)

- **Old `Y` behaviour:** `ROOM_BOUNDS.floorY` was taken from carpet AABB `max.y` only. The **beige Eduverse floor plane** and **backdrop lifts** (`EDUVERSE_FULL_IMAGE_Y_LIFT_M`, etc.) can leave the **visual rug top** slightly above the value used for foot alignment, or the first foot pass ran **before** the carpet world matrix was stable — so V52 aligned the VRM to a **stale** floor and the body read as **submerged** relative to the rug / foreground plane.
- **Skipped recovery:** When the carpet AABB **matched** `ROOM_BOUNDS` numerically, the handler **returned early** and **never** re-ran foot calibration — leaving a bad first-pass `footY`.
- **Z:** Playable X/Z come from the same carpet box; forcing foot re-calibration after every carpet report keeps `getDefaultStandXZ()`-driven resets consistent when bounds do change.

---

## 3. New coordinates / behaviour

- **Walk surface Y:**  
  `ROOM_BOUNDS.floorY = carpetWorldBox.max.y + readRugWalkSurfaceYExtraEnv()`  
  Default **extra:** **0.06 m** (configurable via `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA`).
- **Foot calibration:** After every successful carpet measurement, if bounds are unchanged we still fire **`room:footRecalib`** so V52 runs again against the **current** `floorY` (sub-floor recovery without requiring a diff in X/Z).
- **Carpet timing:** Carpet measurement uses **double `requestAnimationFrame`** so world matrices include **EduverseRoomBackdrop** parent transforms before `setFromObject`.

Typical **before** (symptom): group / feet aligned to a floor that was **below** the visible rug (e.g. reported **Y ≈ −5.8** vs logical **floorY ≈ −2.95** in logs).  
**After:** feet track **`floorY = rugMaxY + 0.06`** (plus optional `NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET`).

---

## 4. Foot contact with the rug

- V52 still computes `footToFloorYOffsetRef = ROOM_BOUNDS.floorY - footBox.min.y + readAvatarStandYOffsetEnv()` with the **full** VRM scene AABB minimum after world updates.
- Raising **`ROOM_BOUNDS.floorY`** by the rug extra makes the solved **group Y** place the lowest mesh point on the **raised** walk plane — **contact** is on the logical rug surface, not the void below the pile.

---

## 5. QA (requested)

1. Rebuild/run: `docker compose down && docker compose up -d --build` (from repo root with Docker available).
2. Open `/avatar-agent`: avatar should be **fully visible**, standing on the **rug**, not in the beige foreground slab.
3. Idle / breathing should remain stable **above** the new floor.

---

## 6. Env knobs

| Variable | Meaning |
|----------|---------|
| `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA` | Metres added on top of carpet `max.y` for `floorY` (default **0.06**) |
| `NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET` | Fine trim **after** V52 (negative = sink slightly) |

---

*End of report — NEXUS V100 MAX sub-floor recovery.*
