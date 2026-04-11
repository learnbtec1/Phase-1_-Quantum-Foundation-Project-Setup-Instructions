/**
 * Level 7.1 — Cognitive noise, micro-conflict hesitation, frame oscillation (mind-time driven).
 */

import type { GlobalMindFrame } from './GlobalMindFrame';
import type { IntentType } from './intentTypes';
import type { InstabilityBudget } from './InstabilityBudget';
import { defaultBudget } from './InstabilityBudget';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function frac01(x: number): number {
  return x - Math.floor(x);
}

/**
 * Attention noise ~±0.05, small arousal / load oscillation — “mind breathes”.
 * Optional {@link InstabilityBudget} scales amplitudes (Level 7.2 governance).
 */
export function perturbMindFrame(
  frame: GlobalMindFrame,
  mindTimeMs: number,
  budget?: InstabilityBudget,
): GlobalMindFrame {
  const nMul = budget ? budget.noise / defaultBudget.noise : 1;
  const dMul = budget ? budget.drift / defaultBudget.drift : 1;
  const w = mindTimeMs * 0.001;
  const noiseAtt =
    (Math.sin(w * 3.17) * 0.52 + Math.cos(w * 2.71) * 0.48) * 0.05 * nMul;
  const arousalOsc = Math.sin(w * 1.93) * 0.045 * dMul;
  const loadOsc = Math.sin(w * 2.31) * 0.055 * dMul;

  return {
    ...frame,
    attention: clamp01(frame.attention + noiseAtt),
    arousal: clamp01(frame.arousal + arousalOsc),
    cognitiveLoad: clamp01(frame.cognitiveLoad + loadOsc * 0.45),
    emotion: {
      ...frame.emotion,
      intensity: clamp01(frame.emotion.intensity + arousalOsc * 0.35),
    },
  };
}

/**
 * When the merged stream still “remembers” a different intent class, add real hesitation.
 */
export function microConflictHesitationMs(
  mindTimeMs: number,
  primary: IntentType,
  mergedOther: IntentType | null | undefined,
  conflictWeight = 1,
): number {
  if (!mergedOther || mergedOther === primary) return 0;
  const g = frac01(mindTimeMs * 0.00073);
  if (g < 0.68) return 0;
  const w = Math.max(0, Math.min(1.25, conflictWeight));
  return (70 + frac01(mindTimeMs * 0.00109) * 160) * w;
}
