'use client';

import { getResolvedCogniPersonality } from '@/lib/avatar/resolveCogniPersonality';

import type { Contradiction } from './types';

export type PersonalityAnalysis = {
  personalityMismatch: boolean;
  contradictions: Contradiction[];
  profileSummary: string;
};

export function analyzePersonalityEmbodiment(args: {
  gestureVarianceProxy: number;
  idleLayerW: number;
  motionFluidityProxy: number;
}): PersonalityAnalysis {
  const p = getResolvedCogniPersonality();
  const contradictions: Contradiction[] = [];

  const profileSummary = `${p.activePersona}:${p.activeStance}; expr=${p.expressiveness.toFixed(
    2,
  )}; calm=${p.calmness.toFixed(2)}`;

  let mismatch = false;

  if (p.expressiveness > 0.62 && args.gestureVarianceProxy < 0.06 && args.idleLayerW > 0.82) {
    mismatch = true;
    contradictions.push({
      id: 'personality_dissonance_high_expr_idle_dom',
      a: 'configured expressiveness high',
      b: 'motion stack dominated by idle / low gesture variance',
      confidence: 0.61,
    });
  }

  if (p.calmness > 0.7 && args.motionFluidityProxy > 0.92) {
    contradictions.push({
      id: 'personality_dissonance_calm_hyperfluid',
      a: 'calm_teacher personality bias',
      b: 'motion fluidity reads unusually volatile',
      confidence: 0.42,
    });
  }

  return {
    personalityMismatch: mismatch,
    contradictions,
    profileSummary,
  };
}
