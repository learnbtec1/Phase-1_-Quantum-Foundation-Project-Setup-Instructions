'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { ConversationalKinematicsReportPayload } from './types';

import type { BoneTelemetrySample } from './types';

export function analyzeConversationalKinematics(params: {
  shell: DiagnosticsWindowSurface | null;
  armSamples: BoneTelemetrySample[];
  chestSamples: BoneTelemetrySample[];
}): ConversationalKinematicsReportPayload {
  const ts = new Date().toISOString();
  if (!params.shell) {
    return {
      timestamp: ts,
      armOpenness: 0,
      elbowFlexionProxy: 0,
      shoulderSpreadProxy: 0,
      torsoTwistProxy: 0,
      handElevationProxy: 0,
      chestParticipation: 0,
      conversationalReadability: 0,
      gestureVisibilityCone: 0,
    };
  }

  const lastArm = params.armSamples[params.armSamples.length - 1];
  const lastChest = params.chestSamples[params.chestSamples.length - 1];

  const armOpenness =
    Math.min(1, Math.abs(lastArm?.localEulerDeg.yaw ?? 0) / 130) * (params.shell.motion.gestureLayerW + 0.15);

  const elbowFlex = Math.min(1, (Math.abs(lastArm?.localEulerDeg.roll ?? 40) - 35) / 75);

  const shoulderSpread =
    params.shell.embodiment.timelineEnvelope * 0.55 +
    params.shell.motion.gestureLayerW * 0.45 -
    params.shell.motion.idleLayerW * 0.35;

  const torsoTwist =
    Math.abs(lastChest?.localEulerDeg.yaw ?? 0) / 110 +
    params.shell.embodiment.timelineEnvelope * 0.25;

  const handElev =
    Math.min(1, (lastArm?.forwardVector.y ?? 0) + 0.38 + params.shell.embodiment.timelineEnvelope * 0.28);

  const chestPart =
    Math.min(1, Math.max(0, 0.42 + params.shell.embodiment.timelineEnvelope * 0.5 - params.shell.motion.idleLayerW * 0.25));

  const readability =
    (lastArm?.conversationalReadability ?? 0) * 0.62 +
    (lastChest?.conversationalReadability ?? 0) * 0.28 +
    params.shell.speech.motionEnergyUnified * 0.18;

  const visCone =
    (lastArm?.cameraFacingScore ?? 0) * 0.58 +
    params.shell.motion.gestureLayerW * 0.34 +
    (1 - params.shell.motion.idleLayerW) * 0.22;

  return {
    timestamp: ts,
    armOpenness: clamp100(armOpenness),
    elbowFlexionProxy: clamp100(elbowFlex),
    shoulderSpreadProxy: clamp100(shoulderSpread),
    torsoTwistProxy: clamp100(torsoTwist),
    handElevationProxy: clamp100(handElev),
    chestParticipation: clamp100(chestPart),
    conversationalReadability: clamp100(readability),
    gestureVisibilityCone: clamp100(visCone),
  };
}

function clamp100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}
