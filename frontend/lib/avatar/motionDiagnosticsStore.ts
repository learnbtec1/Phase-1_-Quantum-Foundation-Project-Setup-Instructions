/**
 * Motion diagnostic counters — no imports from behavior/authority (avoids cycles).
 * Incremented from gesture engine, brain gate, authority, VRMA paths.
 */

export type MotionBlockKind = 'behavior' | 'authority' | 'gestureRepeat' | 'internalThought';

export const motionBlockStats: Record<MotionBlockKind, number> = {
  behavior: 0,
  authority: 0,
  gestureRepeat: 0,
  internalThought: 0,
};

/** Successful body plays (UnifiedGestureEngine `#execute` completed with motion). */
export let motionPlaySuccessCount = 0;

export function motionDiagIncrBlock(kind: MotionBlockKind): void {
  motionBlockStats[kind] += 1;
}

export function motionDiagIncrPlay(): void {
  motionPlaySuccessCount += 1;
}

export function motionDiagBlockTotal(): number {
  return (
    motionBlockStats.behavior
    + motionBlockStats.authority
    + motionBlockStats.gestureRepeat
    + motionBlockStats.internalThought
  );
}
