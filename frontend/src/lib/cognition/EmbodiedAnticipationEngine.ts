'use client';

import type { PredictedFailure } from './types';

export type AnticipationHints = {
  torsoPreShift: number;
  shoulderOpenness: number;
  gestureAuthorityBoost: number;
  gazeSoften: number;
  velocityDamp: number;
  narrative: string[];
};

export function buildAnticipationHints(predictions: PredictedFailure[]): AnticipationHints {
  const nar: string[] = [];
  let torso = 0;
  let shoulder = 0;
  let auth = 0;
  let gaze = 0;
  let damp = 0;

  for (const p of predictions.slice(0, 3)) {
    if (p.id.includes('authority')) {
      auth += 0.09 * p.probability;
      shoulder += 0.06 * p.probability;
      torso += 0.05 * p.probability;
      nar.push('Predicted authority stress → pre-boost gesture channel / shoulder openness.');
    }
    if (p.id.includes('frozen')) {
      damp -= 0.04 * p.probability;
      shoulder += 0.07 * p.probability;
      nar.push('Predicted limb freeze → damp idle reclaim; prime shoulder carriers.');
    }
    if (p.id.includes('semantic')) {
      gaze += 0.05 * p.probability;
      torso += 0.06 * p.probability;
      nar.push('Predicted semantic mismatch → soften gaze inertia; prime torso readability.');
    }
  }

  return {
    torsoPreShift: Math.min(0.22, torso),
    shoulderOpenness: Math.min(0.28, shoulder),
    gestureAuthorityBoost: Math.min(0.35, auth),
    gazeSoften: Math.min(0.18, gaze),
    velocityDamp: Math.max(-0.12, Math.min(0.12, damp)),
    narrative: nar.slice(0, 6),
  };
}
