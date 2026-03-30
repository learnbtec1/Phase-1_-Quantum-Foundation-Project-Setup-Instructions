/**
 * GroundLock.ts — derivative-clamp guard that prevents runaway floorY resets.
 *
 * `createGroundLock()` returns a stable `GroundLockApi` used by AvatarCanvas via
 * `useMemo(() => createGroundLock(), [])`.
 *
 * NOTE: All refs are plain `{ current }` objects (no React dependency).
 * `tryApplyFloorY` is defined as an arrow function ON the returned object
 * (not a closure variable) so Turbopack never loses the reference.
 */

export interface GroundLockApi {
  groundLockedRef:    { current: boolean };
  firstFloorYRef:     { current: number | null };
  lastAppliedYRef:    { current: number | null };
  allowedResetsRef:   { current: number };
  resetsPerformedRef: { current: number };
  tryApplyFloorY: (
    nextY: number,
    applyFn: (y: number) => void,
    opts?: { bypassGroundLock?: boolean },
  ) => void;
}

export function createGroundLock(): GroundLockApi {
  // All state lives on the returned object so arrow methods close over `api`,
  // not over separately-declared closure variables that Turbopack might transform.
  const api: GroundLockApi = {
    groundLockedRef:    { current: false },
    firstFloorYRef:     { current: null },
    lastAppliedYRef:    { current: null },
    allowedResetsRef:   { current: 3 },
    resetsPerformedRef: { current: 0 },

    tryApplyFloorY: (
      nextY: number,
      applyFn: (y: number) => void,
      opts?: { bypassGroundLock?: boolean },
    ): void => {
      // Hard guard: NaN/Infinity would poison ROOM_BOUNDS and all downstream
      // position calculations. `?? 0` in callers does NOT catch NaN.
      if (!Number.isFinite(nextY)) return;

      const bypass = opts?.bypassGroundLock === true;
      if (api.groundLockedRef.current && !bypass) return;

      // Record first application
      if (api.firstFloorYRef.current === null) {
        api.firstFloorYRef.current = nextY;
      }

      // Sanity: ignore implausible jumps (> 3 m from first value)
      const delta = Math.abs(nextY - (api.firstFloorYRef.current ?? nextY));
      if (delta > 3.0) return;

      // Engage lock after allowedResetsRef resets
      api.resetsPerformedRef.current += 1;
      if (api.resetsPerformedRef.current > api.allowedResetsRef.current) {
        api.groundLockedRef.current = true;
      }

      api.lastAppliedYRef.current = nextY;
      applyFn(nextY);
    },
  };

  return api;
}
