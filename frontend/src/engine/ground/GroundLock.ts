import type { MutableRefObject } from 'react';

/**
 * GROUND LOCK V2 — lock floor calibration after first successful pass, clamp tiny floor
 * deltas, fuse further resets (at most one post-load recalibration).
 */
/** Options for carpet / authoritative AABB updates (see `bypassGroundLock`). */
export type TryApplyFloorYOptions = {
  /** Carpet world AABB must win over GroundLock / reset fuse — otherwise floorY never updates when locked. */
  bypassGroundLock?: boolean;
};

export type GroundLock = {
  groundLockedRef: MutableRefObject<boolean>;
  firstFloorYRef: MutableRefObject<number | null>;
  lastAppliedYRef: MutableRefObject<number | null>;
  allowedResetsRef: MutableRefObject<number>;
  /** Increments when a non-baseline floor Y is accepted (post-load recalibration). */
  resetsPerformedRef: MutableRefObject<number>;
  tryApplyFloorY: (
    nextY: number,
    applyAvatarGroundOffset: (y: number) => void,
    opts?: TryApplyFloorYOptions,
  ) => void;
};

const SMALL_DELTA = 0.02;

export function createGroundLock(): GroundLock {
  const groundLockedRef: MutableRefObject<boolean> = { current: false };
  const firstFloorYRef: MutableRefObject<number | null> = { current: null };
  const lastAppliedYRef: MutableRefObject<number | null> = { current: null };
  const allowedResetsRef: MutableRefObject<number> = { current: 1 };
  const resetsPerformedRef: MutableRefObject<number> = { current: 0 };

  function tryApplyFloorY(
    nextY: number,
    applyAvatarGroundOffset: (y: number) => void,
    opts?: TryApplyFloorYOptions,
  ) {
    if (!Number.isFinite(nextY)) return;
    const bypass = opts?.bypassGroundLock === true;
    if (!bypass && groundLockedRef.current) return;
    const prev = lastAppliedYRef.current;
    if (prev != null && Math.abs(nextY - prev) <= SMALL_DELTA) {
      return;
    }
    if (!bypass && firstFloorYRef.current != null && allowedResetsRef.current <= 0) {
      groundLockedRef.current = true;
      return;
    }
    if (firstFloorYRef.current == null) firstFloorYRef.current = nextY;
    applyAvatarGroundOffset(nextY);
    lastAppliedYRef.current = nextY;
    if (firstFloorYRef.current !== nextY) {
      allowedResetsRef.current -= 1;
      resetsPerformedRef.current += 1;
      if (allowedResetsRef.current <= 0) {
        groundLockedRef.current = true;
      }
    }
  }

  return {
    groundLockedRef,
    firstFloorYRef,
    lastAppliedYRef,
    allowedResetsRef,
    resetsPerformedRef,
    tryApplyFloorY,
  };
}
