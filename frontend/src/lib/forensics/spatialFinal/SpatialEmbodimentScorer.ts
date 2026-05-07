'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { SkeletalTelemetryReportPayload } from '@/lib/cognition/types';

import type { SpatialEmbodimentScorePayload, SpatialVerifiedFailure } from './types';
import { latestBoneSample } from './boneSampleUtils';

const CONF = 0.55;

export function scoreSpatialEmbodiment(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
}): SpatialEmbodimentScorePayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];

  const hips = latestBoneSample(params.skeletal.bones.hips);
  const spine = latestBoneSample(params.skeletal.bones.spine);
  const chest = latestBoneSample(params.skeletal.bones.chest);

  const yawH = hips?.localEulerDeg.yaw ?? 0;
  const yawS = spine?.localEulerDeg.yaw ?? 0;
  const yawC = chest?.localEulerDeg.yaw ?? 0;
  const chainSpread = Math.max(Math.abs(yawH - yawS), Math.abs(yawS - yawC), Math.abs(yawH - yawC));

  const upperLowerCoherence = Math.max(0, Math.min(100, 100 - chainSpread * 0.65));

  const hipsPitch = Math.abs(hips?.localEulerDeg.pitch ?? 0);
  const groundingProxy = Math.max(0, Math.min(100, 94 - hipsPitch * 1.1));

  const balanceProxy = Math.max(
    0,
    Math.min(
      100,
      88 -
        Math.abs(hips?.localEulerDeg.roll ?? 0) * 0.55 -
        Math.abs(spine?.localEulerDeg.roll ?? 0) * 0.35,
    ),
  );

  const env = params.shell?.embodiment.timelineEnvelope ?? 0;
  const leaningProxy = Math.round(Math.min(100, env * 72 + Math.abs(yawC) * 0.35));

  const spatialEmbodimentScore = Math.round(
    groundingProxy * 0.28 + balanceProxy * 0.28 + upperLowerCoherence * 0.34 + leaningProxy * 0.1,
  );

  const disconnected = chainSpread > 62 && (params.shell?.motion.gestureLayerW ?? 0) > 0.18;
  if (disconnected) {
    verifiedFailures.push({
      id: 'spatial_torso_pelvis_disconnect',
      subsystem: 'spatial',
      summary: 'Large yaw divergence across hips/spine/chest during gesture activity — floating/disconnected torso feel',
      confidence: 0.61,
      evidence: [`chainSpreadDeg=${chainSpread.toFixed(1)}`, `gestureW=${(params.shell?.motion.gestureLayerW ?? 0).toFixed(2)}`],
    });
  }

  if (groundingProxy < 38 && (params.shell?.motion.idleLayerW ?? 1) < 0.92) {
    verifiedFailures.push({
      id: 'spatial_weak_grounding',
      subsystem: 'spatial',
      summary: 'Pelvis pitch proxy suggests unstable vertical grounding vs motion blend',
      confidence: 0.56,
      evidence: [`groundingProxy=${groundingProxy.toFixed(1)}`, `hipsPitch=${hipsPitch.toFixed(1)}`],
    });
  }

  return {
    timestamp: ts,
    balanceProxy,
    groundingProxy,
    upperLowerCoherence,
    leaningProxy,
    spatialEmbodimentScore,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
  };
}
