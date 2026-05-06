'use client';

import type { ActiveFailure } from './types';
import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';
import { GESTURE_COLLAPSE_INSPECT_TARGETS } from './EmbodiedDependencyGraph';

export function analyzeAuthorityCollapse(args: {
  timelineSnapshot: RuntimeTimelineSnapshot | null;
  idleDominatesGestureFlag: boolean;
  schedulerBlocksSinceFlush: number;
  semanticCooldownHitsSinceFlush: number;
}): ActiveFailure[] {
  const out: ActiveFailure[] = [];
  const snap = args.timelineSnapshot;

  if (snap?.embodimentState.idleDominating && snap.speaking) {
    out.push({
      id: 'idle_overwriting_gesture_authority',
      subsystem: 'motion_authority',
      severity: 'critical',
      summary: 'Idle layer dominates during speech — gesture authority likely collapsed',
      evidence: [`idleW=${snap.idleLayerW.toFixed(2)}`, `gestureW=${snap.gestureLayerW.toFixed(2)}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.76,
    });
  }

  if (snap?.embodimentState.armFrozen) {
    out.push({
      id: 'arm_frozen_embodiment',
      subsystem: 'motion_authority',
      severity: 'critical',
      summary: 'Temporal recorder flagged frozen arms despite gesture envelope',
      evidence: [`envelope=${snap.gestureEnvelope.toFixed(2)}`, `armΔ=${snap.finalArmMagnitude.toFixed(3)}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.73,
    });
  }

  if (args.idleDominatesGestureFlag && !snap?.speaking) {
    out.push({
      id: 'idle_domination_heuristic',
      subsystem: 'motion_authority',
      severity: 'warn',
      summary: 'Diagnostics idleDominatesGesture heuristic active',
      evidence: ['idleDominatesGesture=true'],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.5,
    });
  }

  if (args.schedulerBlocksSinceFlush > 4) {
    out.push({
      id: 'scheduler_starvation_burst',
      subsystem: 'scheduler',
      severity: 'warn',
      summary: 'Scheduler produced repeated blocks since flush',
      evidence: [`blocksΔ=${args.schedulerBlocksSinceFlush}`],
      inspectTargets: ['frontend/src/app/avatar-agent/motion/motionScheduler.ts'],
      confidence: 0.55,
    });
  }

  if (args.semanticCooldownHitsSinceFlush > 3) {
    out.push({
      id: 'semantic_bridge_starvation',
      subsystem: 'semantic_bridge',
      severity: 'warn',
      summary: 'Semantic cooldown starvation counts elevated',
      evidence: [`SEMANTIC_COOLDOWN_STARVE Δ=${args.semanticCooldownHitsSinceFlush}`],
      inspectTargets: ['frontend/src/app/avatar-agent/motion/semanticGestureBridge.ts'],
      confidence: 0.52,
    });
  }

  if (
    snap &&
    snap.semanticGesture !== 'idle' &&
    snap.motionSource === 'IDLE' &&
    snap.gestureLayerW < 0.1
  ) {
    out.push({
      id: 'invisible_gesture_channel',
      subsystem: 'motion_authority',
      severity: 'warn',
      summary: 'Semantic gesture selected but motion authority reads IDLE with crushed gesture weights',
      evidence: [`semantic=${snap.semanticGesture}`, `motion=${snap.motionSource}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.64,
    });
  }

  return out;
}
