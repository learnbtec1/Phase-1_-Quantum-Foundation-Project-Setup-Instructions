/**
 * Level 6.1 — Gaze-first ordering: eyes → head → gesture (staggered layer delays).
 */

import type { MotionPlan } from './intentTypes';

/**
 * Attaches relative layer delays on top of `plan.timing.delayMs` (applied in host).
 */
export function applyGazeFirst(plan: MotionPlan): MotionPlan {
  return {
    ...plan,
    layerTimings: {
      gazeDelayMs: 0,
      headDelayMs: 80,
      gestureDelayMs: 180,
    },
  };
}
