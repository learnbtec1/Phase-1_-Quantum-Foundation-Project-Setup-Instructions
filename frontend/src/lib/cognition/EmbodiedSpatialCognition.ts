'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { SpatialCognitionReportPayload } from './types';

import type { BoneTelemetrySample } from './types';

export function analyzeSpatialCognition(params: {
  shell: DiagnosticsWindowSurface | null;
  armRight: BoneTelemetrySample[] | undefined;
  armLeft: BoneTelemetrySample[] | undefined;
}): SpatialCognitionReportPayload {
  const ts = new Date().toISOString();
  const narratives: string[] = [];
  if (!params.shell) {
    return {
      timestamp: ts,
      hiddenGestureRisk: 0,
      avatarCameraMisalignmentRisk: 0,
      backwardGestureRisk: 0,
      framingCollapseRisk: 0,
      narratives,
    };
  }

  const rLast = params.armRight?.[params.armRight.length - 1];
  const lLast = params.armLeft?.[params.armLeft.length - 1];

  const hidden =
    (rLast?.cameraFacingScore ?? 1) < 0.18 || (lLast?.cameraFacingScore ?? 1) < 0.18
      ? 0.72
      : Math.max(0, 0.55 - (rLast?.cameraFacingScore ?? 0)) * 1.1;

  const backward =
    Math.min(
      1,
      (Math.abs(rLast?.localEulerDeg.yaw ?? 0) > 110 ? 0.55 : 0) +
        (Math.abs(lLast?.localEulerDeg.yaw ?? 0) > 110 ? 0.55 : 0),
    );

  const misalign =
    params.shell.motion.motionSource === 'GESTURE' && params.shell.motion.idleLayerW > 0.78 ? 0.62 : 0.22;

  const framing =
    params.shell.motion.idleDominatesGesture && params.shell.speech.speaking ? 0.74 : 0.28;

  if (hidden > 0.5) narratives.push('Gesture visibility risk — limbs oriented away from conversational camera cone.');
  if (backward > 0.45) narratives.push('Backward conversational arm posture relative to proxy yaw envelope.');
  if (misalign > 0.45) narratives.push('Authority misalignment — gesture motion source with idle weight dominance.');
  if (framing > 0.55) narratives.push('Conversational framing collapse — idle reclaim during speech.');

  return {
    timestamp: ts,
    hiddenGestureRisk: hidden,
    avatarCameraMisalignmentRisk: misalign,
    backwardGestureRisk: backward,
    framingCollapseRisk: framing,
    narratives,
  };
}
