# Avatar Feet + Sub-floor Fix (V122)

## Scope
This patch documents and hardens two runtime issues in `AvatarCanvas`:

1. Feet inversion / unstable lower-body pose while standing.
2. Avatar occasional sinking below room floor during standing/walking.

## What Was Fixed

### 1) Feet orientation and lower-body stability
- Standing lower-body now uses bind-pose restoration through `resetLowerBodyToIdle()` in standing paths.
- This avoids unsafe `rotation.set(0,0,0)` assumptions that break rig-specific bind orientations.
- Result: feet and leg chain remain anatomically correct for the current VRM rig.

### 2) Sub-floor sinking guard (new in V122)
- Added a standing-floor guard in the per-frame update:
  - Computes a floor baseline from `ROOM_BOUNDS.floorY + yOffset + footToFloorYOffsetRef.current - 0.01`.
  - Clamps `group.position.y` upward only when it falls below that baseline.
- The guard is one-way (downward protection only), so normal movement/breath remains intact.
- Added throttled dev warning log: `[V122] standing Y guard clamp`.

## Why This Works
- Feet correction is solved at skeletal level (bind-pose restore), not by mutating bone positions.
- Floor protection is solved at transform level with a low-risk clamp against negative drift.
- Combined behavior preserves standing posture and prevents falling under the room.

## Files Updated
- `frontend/src/app/avatar-agent/AvatarCanvas.tsx`
- `docs/AVATAR_FEET_AND_SUBFLOOR_FIX_V122.md`

## Runtime Behavior Notes
- Guard applies only during standing/walking branch (`!isSittingNow`).
- Sitting path is unchanged.
- GroundLock V2 behavior remains unchanged.
