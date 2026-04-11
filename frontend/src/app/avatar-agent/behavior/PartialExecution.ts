/**
 * Level 7.1 — Sometimes drop / soften channels.
 * Level 7.2 — Drop probability scales with `budget.partial * (1 - coherence)` (contextual, bounded).
 */

import type { GlobalMindFrame } from './GlobalMindFrame';
import type { InstabilityBudget } from './InstabilityBudget';
import type { MotionPlan } from './intentTypes';

function frac01(x: number): number {
  return x - Math.floor(x);
}

export type PartialExecutionRoll = {
  dropMicro: boolean;
  dropSaccade: boolean;
  motorBreathScale: number;
  gestureIntensityScale: number;
  delayGestureExtraMs: number;
  /** Rare: skip procedural gesture burst (head/gaze/emotion still run). */
  dropGesture: boolean;
};

function contextualPartialWeight(
  budget: InstabilityBudget | undefined,
  coherence: number | undefined,
): number | null {
  if (budget === undefined || coherence === undefined) return null;
  return Math.min(0.92, budget.partial * (1 - coherence));
}

/**
 * Contextual gesture suppression — failure scales with incoherence × partial budget.
 */
export function governedPartialExecution(
  plan: MotionPlan,
  budget: InstabilityBudget,
  coherence: number,
  mindTimeMs: number,
): MotionPlan {
  const dropChance = Math.min(0.55, budget.partial * (1 - coherence));
  if (
    frac01(mindTimeMs * 0.00067) < dropChance &&
    plan.gesture &&
    plan.gesture !== 'idle'
  ) {
    return { ...plan, gesture: undefined };
  }
  return plan;
}

/**
 * Deterministic-from-mindTime rolls so QA stays reproducible for a given TimeCore offset.
 * With `budget` + `coherence`, thresholds follow the instability budget (Level 7.2).
 */
export function evaluatePartialExecution(
  mindTimeMs: number,
  frame: GlobalMindFrame | null,
  budget?: InstabilityBudget,
  coherence?: number,
): PartialExecutionRoll {
  const r0 = frac01(mindTimeMs * 0.00087);
  const r1 = frac01(mindTimeMs * 0.00131);
  const r2 = frac01(mindTimeMs * 0.00103);
  const r3 = frac01(mindTimeMs * 0.00119);
  const load = frame?.cognitiveLoad ?? 0.35;
  const ctx = contextualPartialWeight(budget, coherence);

  if (ctx !== null) {
    const dropMicro = r0 < 0.045 + ctx * 0.16 && load < 0.54;
    const dropSaccade = r1 < 0.04 + ctx * 0.14 && load < 0.5;
    const motorBreathScale = 0.88 + r2 * 0.14 * (1 - ctx * 0.35);
    const gestureIntensityScale = 0.82 + r3 * 0.18 * (1 - ctx * 0.28);
    const delayGestureExtraMs =
      r2 < 0.09 + ctx * 0.12 ? Math.floor(30 + frac01(mindTimeMs * 0.0022) * 90) : 0;
    const dropGesture =
      r3 < 0.035 + ctx * 0.22 &&
      load < 0.42 + ctx * 0.08 &&
      frame?.intent.type !== 'speaking';

    return {
      dropMicro,
      dropSaccade,
      motorBreathScale,
      gestureIntensityScale,
      delayGestureExtraMs,
      dropGesture,
    };
  }

  const dropMicro = r0 < 0.07 && load < 0.52;
  const dropSaccade = r1 < 0.06 && load < 0.48;
  const motorBreathScale = 0.88 + r2 * 0.14;
  const gestureIntensityScale = 0.82 + r3 * 0.18;
  const delayGestureExtraMs = r2 < 0.11 ? Math.floor(30 + frac01(mindTimeMs * 0.0022) * 90) : 0;
  const dropGesture = r3 < 0.04 && load < 0.4 && frame?.intent.type !== 'speaking';

  return {
    dropMicro,
    dropSaccade,
    motorBreathScale,
    gestureIntensityScale,
    delayGestureExtraMs,
    dropGesture,
  };
}
