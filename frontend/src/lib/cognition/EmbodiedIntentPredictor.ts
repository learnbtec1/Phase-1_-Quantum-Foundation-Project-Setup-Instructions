'use client';

import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';

import type { PredictedFailure } from './types';

export function predictEmbodiedFailures(snaps: RuntimeTimelineSnapshot[]): PredictedFailure[] {
  const out: PredictedFailure[] = [];
  if (snaps.length < 5) return out;

  const tail = snaps.slice(-12);
  let idleSpeak = 0;
  let armFrozen = 0;
  let collapseRisk = 0;
  for (const s of tail) {
    if (s.speaking && s.idleLayerW > 0.82) idleSpeak++;
    if (s.embodimentState.armFrozen) armFrozen++;
    if (s.embodimentState.gestureCollapseRisk) collapseRisk++;
  }
  const n = tail.length;

  const pIdle = idleSpeak / n;
  if (pIdle > 0.28) {
    out.push({
      id: 'gesture_authority_collapse_rising',
      probability: Math.min(0.92, 0.35 + pIdle * 0.55),
      horizonMs: 600,
      narrative: 'Gesture authority collapse probability rising — idle weight dominates during speech.',
    });
  }

  const pFrozen = armFrozen / n;
  if (pFrozen > 0.15) {
    out.push({
      id: 'frozen_arm_visibility_loss',
      probability: Math.min(0.9, 0.28 + pFrozen * 0.65),
      horizonMs: 1200,
      narrative: 'Upper-limb visibility expected to degrade — envelope/delta divergence recurring.',
    });
  }

  const pCol = collapseRisk / n;
  if (pCol > 0.18) {
    out.push({
      id: 'semantic_embodiment_degradation',
      probability: Math.min(0.88, 0.32 + pCol * 0.58),
      horizonMs: 800,
      narrative: 'Semantic embodiment degradation predicted — semantic gesture vs motion authority mismatch.',
    });
  }

  const yawStress = tail.reduce((a, s) => a + Math.abs(s.finalArmMagnitude), 0) / n;
  if (yawStress > 1.05) {
    out.push({
      id: 'backward_arm_visibility_camera_cone',
      probability: Math.min(0.82, 0.22 + yawStress * 0.18),
      horizonMs: 450,
      narrative: 'Arm deviation magnitude extreme — backward conversational collapse risk in camera cone.',
    });
  }

  out.sort((a, b) => b.probability - a.probability);
  return out.slice(0, 6);
}
