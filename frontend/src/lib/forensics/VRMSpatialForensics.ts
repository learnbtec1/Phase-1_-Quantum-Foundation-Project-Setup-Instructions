'use client';

import type { ActiveFailure } from './types';
import { GESTURE_COLLAPSE_INSPECT_TARGETS } from './EmbodiedDependencyGraph';

export function analyzeVRMSpatialIntegrity(args: {
  invalidQuatSamplesSinceFlush: number;
  nullBoneSamplesSinceFlush: number;
  armDeviationLuaRad: number | null;
  humanoidPresent: boolean;
}): ActiveFailure[] {
  const out: ActiveFailure[] = [];

  if (!args.humanoidPresent) {
    out.push({
      id: 'vrm_humanoid_missing',
      subsystem: 'vrm_skeleton',
      severity: 'critical',
      summary: 'Humanoid bone map absent — spatial embodiment unsafe',
      evidence: ['humanoidPresent=false'],
      inspectTargets: ['frontend/src/app/avatar-agent/VRMSkeletonManager.tsx'],
      confidence: 0.95,
    });
    return out;
  }

  if (args.invalidQuatSamplesSinceFlush > 0) {
    out.push({
      id: 'quaternion_composition_mismatch',
      subsystem: 'spatial',
      severity: 'warn',
      summary: 'Invalid quaternion samples detected since last diagnostics flush',
      evidence: [`invalidQuatΔ=${args.invalidQuatSamplesSinceFlush}`],
      inspectTargets: [...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.68,
    });
  }

  if (args.armDeviationLuaRad != null && Math.abs(args.armDeviationLuaRad) > 2.6) {
    out.push({
      id: 'arm_reversal_extreme_deviation',
      subsystem: 'spatial',
      severity: 'warn',
      summary: 'Arm deviation magnitude unusually large — possible axis reversal / bind regression',
      evidence: [`armDeviationLuaRad=${args.armDeviationLuaRad.toFixed(3)}`],
      inspectTargets: [
        'frontend/src/app/avatar-agent/motion/biomechanicalCorrectionLayer.ts',
        'frontend/src/app/avatar-agent/VRMSkeletonManager.tsx',
      ],
      confidence: 0.54,
    });
  }

  if (args.nullBoneSamplesSinceFlush > 2) {
    out.push({
      id: 'bind_space_corruption_risk',
      subsystem: 'vrm_skeleton',
      severity: 'warn',
      summary: 'Repeated null bone writes — bind-space or humanoid mapping instability',
      evidence: [`nullBoneWritesΔ=${args.nullBoneSamplesSinceFlush}`],
      inspectTargets: ['frontend/src/app/avatar-agent/VRMSkeletonManager.tsx'],
      confidence: 0.57,
    });
  }

  return out;
}
