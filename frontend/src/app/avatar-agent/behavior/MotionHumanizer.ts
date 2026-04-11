/**
 * Level 6.1 — Micro-variation on motion timing (anti-mechanical repetition).
 */

import type { MotionPlan } from './intentTypes';

/**
 * Adds small random offsets to delays / durations (and layer offsets if present).
 */
export function humanize(plan: MotionPlan): MotionPlan {
  const delayJitter = Math.random() * 60;
  const durationJitter = Math.random() * 120;

  const next: MotionPlan = {
    ...plan,
    timing: {
      delayMs: plan.timing.delayMs + delayJitter,
      durationMs: plan.timing.durationMs + durationJitter,
    },
  };

  if (next.layerTimings) {
    const lt = next.layerTimings;
    next.layerTimings = {
      gazeDelayMs: lt.gazeDelayMs + delayJitter * 0.15,
      headDelayMs: lt.headDelayMs + delayJitter * 0.35,
      gestureDelayMs: lt.gestureDelayMs + delayJitter * 0.45,
    };
  }

  return next;
}
