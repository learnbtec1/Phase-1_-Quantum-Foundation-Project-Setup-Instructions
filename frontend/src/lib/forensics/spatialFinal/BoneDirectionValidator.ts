'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { SkeletalTelemetryReportPayload } from '@/lib/cognition/types';
import { TRACKED_BONES } from '@/lib/cognition/EmbodiedSkeletalTelemetry';

import type { BoneDirectionValidationPayload, SpatialVerifiedFailure } from './types';
import { latestBoneSample } from './boneSampleUtils';

const CONF = 0.55;

export function validateBoneDirections(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
}): BoneDirectionValidationPayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];
  const perBoneFlags: Array<{ bone: string; flags: string[] }> = [];

  const motionSrc = params.shell?.motion.motionSource ?? '';
  const g = params.shell?.motion.gestureLayerW ?? 0;
  const idle = params.shell?.motion.idleLayerW ?? 0;

  for (const bone of TRACKED_BONES) {
    const s = latestBoneSample(params.skeletal.bones[bone]);
    if (!s) continue;
    const flags: string[] = [];
    if (/BACKWARD/i.test(s.biomechanicalStatus)) {
      flags.push('backward_conversational_axis');
      if (bone === 'rightUpperArm' || bone === 'leftUpperArm') {
        verifiedFailures.push({
          id: `direction_backward_${bone}`,
          bone,
          subsystem: 'spatial',
          summary: 'Upper-arm yaw suggests backward conversational collapse',
          confidence: 0.72,
          evidence: [`status=${s.biomechanicalStatus}`, `yawDeg=${s.localEulerDeg.yaw.toFixed(1)}`],
        });
      }
    }
    if (s.biomechanicalStatus === 'AUTHORITY_STRADDLE') {
      flags.push('idle_gesture_authority_straddle');
      if (bone === 'rightUpperArm') {
        verifiedFailures.push({
          id: 'direction_straddle_global',
          bone,
          subsystem: 'motion_authority',
          summary: 'Idle weight dominates while motionSource claims gesture authority',
          confidence: 0.58,
          evidence: [`motionSource=${motionSrc}`, `gestureW=${g.toFixed(2)}`, `idleW=${idle.toFixed(2)}`],
        });
      }
    }
    if (/ELBOW_FLEXION_STRESS/i.test(s.biomechanicalStatus)) {
      flags.push('elbow_inversion_risk');
    }
    if (/FROZEN_SHOULDERS/i.test(s.biomechanicalStatus) && g > 0.12) {
      flags.push('shoulder_compression');
      verifiedFailures.push({
        id: `direction_frozen_shoulder_${bone}`,
        bone,
        subsystem: 'spatial',
        summary: 'Shoulder spread proxy collapsed during active gesture channel',
        confidence: 0.56,
        evidence: [`status=${s.biomechanicalStatus}`, `gestureW=${g.toFixed(2)}`],
      });
    }
    if (flags.length) perBoneFlags.push({ bone, flags });
  }

  const merged = new Map<string, SpatialVerifiedFailure>();
  for (const f of verifiedFailures) {
    if (f.confidence < CONF) continue;
    merged.set(f.id, f);
  }

  return {
    timestamp: ts,
    verifiedFailures: [...merged.values()],
    perBoneFlags,
  };
}
