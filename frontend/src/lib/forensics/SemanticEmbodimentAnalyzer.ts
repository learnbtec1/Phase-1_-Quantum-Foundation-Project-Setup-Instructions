'use client';

import type { ActiveFailure, Contradiction } from './types';
import { GESTURE_COLLAPSE_INSPECT_TARGETS } from './EmbodiedDependencyGraph';

function gestureExpectation(intent: string): string | null {
  if (intent === 'questioning') return 'explain_or_point';
  if (intent === 'thinking') return 'think_posture';
  if (intent === 'explaining') return 'explain_wave';
  if (intent === 'greeting') return 'welcome_wave';
  if (intent === 'emphasizing') return 'emphasis_point';
  return null;
}

export function analyzeSemanticEmbodiment(args: {
  activeIntent: string;
  semanticGesture: string;
  gestureState: string;
  gestureLayerW: number;
  motionSource: string;
}): { failures: ActiveFailure[]; contradictions: Contradiction[] } {
  const failures: ActiveFailure[] = [];
  const contradictions: Contradiction[] = [];

  const exp = gestureExpectation(args.activeIntent);
  if (!exp) return { failures, contradictions };

  const gest =
    args.semanticGesture !== 'idle'
      ? args.semanticGesture
      : args.gestureState !== 'idle'
        ? args.gestureState
        : 'idle';

  let satisfied = true;
  if (exp === 'explain_or_point' && gest === 'idle' && args.gestureLayerW < 0.08) {
    satisfied = false;
  }
  if (exp === 'think_posture' && gest === 'idle' && args.motionSource === 'IDLE') {
    satisfied = false;
  }
  if (exp === 'welcome_wave' && gest !== 'welcome' && gest !== 'wave' && args.gestureLayerW < 0.1) {
    satisfied = false;
  }

  if (!satisfied) {
    contradictions.push({
      id: `semantic_contradiction_${args.activeIntent}`,
      a: `intent=${args.activeIntent}`,
      b: `visible motion=${args.motionSource}/${gest}`,
      confidence: 0.55,
    });
    failures.push({
      id: 'semantic_embodiment_mismatch',
      subsystem: 'semantic_bridge',
      severity: 'warn',
      summary: 'Intent signature does not match visible gesture channel',
      evidence: [`intent=${args.activeIntent}`, `semantic=${args.semanticGesture}`, `motion=${args.motionSource}`],
      inspectTargets: [
        'frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts',
        ...GESTURE_COLLAPSE_INSPECT_TARGETS,
      ],
      confidence: 0.58,
    });
  }

  return { failures, contradictions };
}
