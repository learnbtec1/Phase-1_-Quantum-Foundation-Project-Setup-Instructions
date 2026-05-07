'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { HumanoidPropagationForensicsPayload, SpatialVerifiedFailure } from './types';

const CONF = 0.55;

export function inspectHumanoidPropagation(shell: DiagnosticsWindowSurface | null): HumanoidPropagationForensicsPayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];

  if (!shell) {
    return {
      timestamp: ts,
      executionOrderCorrect: false,
      stages: {},
      invalidQuatSinceFlush: 0,
      nullBoneSinceFlush: 0,
      verifiedFailures: [],
      narrative: 'No diagnostics shell — cannot evaluate humanoid propagation ordering.',
    };
  }

  const ex = shell.execution;
  const vrm = shell.vrm;
  const stages = { ...ex.stages };

  let narrative =
    ex.orderCorrect
      ? 'Execution stages recorded in canonical order for this flush.'
      : 'Execution pipeline ordering flag reports anomaly — inspect diagnosticsReporterFlush sequencing.';

  if (!ex.stages.biomechanical) {
    verifiedFailures.push({
      id: 'humanoid_biomech_stage_skipped',
      subsystem: 'vrm_skeleton',
      summary: 'Biomechanical stage not marked executed — final clamp layer may be skipped',
      confidence: 0.62,
      evidence: ['execution.stages.biomechanical=false'],
    });
  }
  if (!ex.stages.applyFinalPose) {
    verifiedFailures.push({
      id: 'humanoid_final_pose_skipped',
      subsystem: 'vrm_skeleton',
      summary: 'applyFinalPose stage false — bind propagation may diverge from composed pose',
      confidence: 0.68,
      evidence: ['execution.stages.applyFinalPose=false'],
    });
  }

  if (vrm.invalidQuatSamplesSinceFlush > 0) {
    verifiedFailures.push({
      id: 'humanoid_invalid_quaternion_writes',
      subsystem: 'spatial',
      summary: 'Invalid quaternion samples observed since flush — late propagation corruption risk',
      confidence: 0.66,
      evidence: [`invalidQuatΔ=${vrm.invalidQuatSamplesSinceFlush}`],
    });
  }
  if (vrm.nullBoneSamplesSinceFlush > 2) {
    verifiedFailures.push({
      id: 'humanoid_null_bone_writes',
      subsystem: 'vrm_skeleton',
      summary: 'Repeated null bone reads/writes — bind map or humanoid node resolution instability',
      confidence: 0.57,
      evidence: [`nullBoneΔ=${vrm.nullBoneSamplesSinceFlush}`],
    });
  }

  return {
    timestamp: ts,
    executionOrderCorrect: ex.orderCorrect,
    stages,
    invalidQuatSinceFlush: vrm.invalidQuatSamplesSinceFlush,
    nullBoneSinceFlush: vrm.nullBoneSamplesSinceFlush,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
    narrative,
  };
}
