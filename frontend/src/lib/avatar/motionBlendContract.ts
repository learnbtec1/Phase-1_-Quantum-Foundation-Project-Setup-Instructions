/**
 * motion = blend(intentDrivenMotion, personality, urgency)
 */
'use client';

import * as THREE from 'three';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';

export type MotionBlendResult = {
  amplitude: number;
  speed: number;
  intentWeight: number;
};

export function blendMotionLayers(args: {
  intent: BrainStatePayload['intent'];
  urgency: number;
  personality: BrainStatePayload['personality'];
  sessionPhase: number;
}): MotionBlendResult {
  const { urgency, personality, intent } = args;
  const u = THREE.MathUtils.clamp(urgency, 0, 1);
  const expr = THREE.MathUtils.clamp(personality.expressiveness, 0, 1);
  const calm = THREE.MathUtils.clamp(personality.calmness, 0, 1);
  const intentW =
    intent === 'emphasizing' ? 1 :
    intent === 'explaining' ? 0.85 :
    intent === 'thinking' ? 0.65 :
    0.5;
  return {
    amplitude: THREE.MathUtils.clamp(0.35 + intentW * 0.45 + expr * 0.35, 0.2, 1.15) * (0.75 + u * 0.35),
    speed: THREE.MathUtils.clamp(0.85 + (1 - calm) * 0.35 + u * 0.15, 0.55, 1.4),
    intentWeight: intentW,
  };
}
