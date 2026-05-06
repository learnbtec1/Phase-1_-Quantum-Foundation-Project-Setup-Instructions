'use client';

import type { AnticipationHints } from './EmbodiedAnticipationEngine';

export type BehaviorPlan = {
  phases: Array<{ id: string; durationMs: number; emphasis: string }>;
  anticipatoryPriming: AnticipationHints;
};

export function composeBehaviorPlan(
  anticipatoryPriming: AnticipationHints,
  semanticGesture: string,
  speaking: boolean,
): BehaviorPlan {
  const phases: BehaviorPlan['phases'] = [
    { id: 'anticipation', durationMs: speaking ? 220 : 160, emphasis: 'micro_torso_prime' },
    {
      id: 'semantic_projection',
      durationMs: semanticGesture === 'idle' ? 180 : 520,
      emphasis: semanticGesture,
    },
    { id: 'readability_hold', durationMs: 380, emphasis: 'camera_facing_envelope' },
    { id: 'recovery', durationMs: 260, emphasis: 'soft_idle_return' },
  ];
  return { phases, anticipatoryPriming };
}
