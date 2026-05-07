'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { CameraSpaceProjectionPayload, SpatialVerifiedFailure } from './types';
import type { FinalSpatialBoneForensicsPayload } from './types';

const CONF = 0.55;

export function analyzeCameraSpaceProjection(params: {
  shell: DiagnosticsWindowSurface | null;
  forensics: FinalSpatialBoneForensicsPayload;
}): CameraSpaceProjectionPayload {
  const ts = new Date().toISOString();
  const arms = params.forensics.bones.filter((b) => /UpperArm|LowerArm|Hand/i.test(b.bone));
  const meanCam =
    arms.length === 0
      ? params.forensics.aggregatedCameraVisibility / 100
      : arms.reduce((s, b) => s + b.cameraVisibility, 0) / arms.length;

  const hiddenGestureRisk = Math.min(1, Math.max(0, 1 - meanCam * 1.08));

  const verifiedFailures: SpatialVerifiedFailure[] = [];
  if (meanCam < 0.28 && (params.shell?.motion.gestureLayerW ?? 0) > 0.18) {
    verifiedFailures.push({
      id: 'camera_projection_gesture_crushed',
      subsystem: 'camera_room',
      summary: 'Gesture weights imply motion but camera-space visibility reads collapsed',
      confidence: 0.61,
      evidence: [`meanArmCamera=${meanCam.toFixed(3)}`, `gestureLayerW=${(params.shell?.motion.gestureLayerW ?? 0).toFixed(2)}`],
    });
  }

  return {
    timestamp: ts,
    meanCameraVisibility: Math.round(meanCam * 1000) / 1000,
    hiddenGestureRisk: Math.round(hiddenGestureRisk * 1000) / 1000,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
  };
}
