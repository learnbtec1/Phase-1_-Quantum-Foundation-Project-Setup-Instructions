'use client';

import type { ActiveFailure } from './types';
import { GESTURE_COLLAPSE_INSPECT_TARGETS } from './EmbodiedDependencyGraph';

export type SpeechBodyCouplingResult = {
  speechBodyCouplingScore: number;
  failures: ActiveFailure[];
};

export function analyzeSpeechBodyCoupling(args: {
  speaking: boolean;
  motionEnergyUnified: number;
  stableMotionEnergy: number;
  gestureLayerW: number;
  idleLayerW: number;
  armDeviationRad: number | null;
  semanticGesture: string;
}): SpeechBodyCouplingResult {
  const failures: ActiveFailure[] = [];
  if (!args.speaking) {
    return { speechBodyCouplingScore: 88, failures };
  }

  let score = 92;
  const bodyMotion =
    Math.max(args.motionEnergyUnified, args.stableMotionEnergy) +
    (args.gestureLayerW > 0.08 ? args.gestureLayerW * 22 : 0) +
    Math.min(18, (args.armDeviationRad ?? 0) * 18);

  if (bodyMotion < 0.08 && args.semanticGesture !== 'idle') {
    failures.push({
      id: 'speech_without_gesture_channel',
      subsystem: 'gesture_intent',
      severity: 'warn',
      summary: 'Semantic gesture intent active while body coupling energy reads flat',
      evidence: [`semanticGesture=${args.semanticGesture}`, `energy=${args.motionEnergyUnified.toFixed(3)}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.58,
    });
    score -= 22;
  }

  if (args.motionEnergyUnified < 0.05 && args.idleLayerW > 0.85) {
    failures.push({
      id: 'speech_without_torso_motion_proxy',
      subsystem: 'motion_authority',
      severity: 'warn',
      summary: 'Speech active but idle dominates motion blend — torso embodiment likely muted',
      evidence: [`idleLayerW=${args.idleLayerW.toFixed(2)}`, `motionEnergy=${args.motionEnergyUnified.toFixed(3)}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.52,
    });
    score -= 15;
  }

  if ((args.armDeviationRad ?? 0) < 0.03 && args.semanticGesture === 'emphasis') {
    failures.push({
      id: 'emphasis_without_arm_reaction',
      subsystem: 'gesture_intent',
      severity: 'info',
      summary: 'Emphasis semantic selected but arm deviation proxy remains minimal',
      evidence: [`armΔ=${(args.armDeviationRad ?? 0).toFixed(3)}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.44,
    });
    score -= 10;
  }

  return { speechBodyCouplingScore: Math.max(5, Math.min(100, score)), failures };
}
