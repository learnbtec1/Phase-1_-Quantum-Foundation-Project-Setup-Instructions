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

  const armOpenness = Math.min(
    1,
    Math.abs(lastArm?.localEulerDeg.yaw ?? 0) / 130 * (params.shell.motion.gestureLayerW + 0.2),
  );

  const elbowFlex = Math.min(1, Math.abs(lastArm?.localEulerDeg.roll ?? 0) / 110);

  const shoulderSpread = Math.min(
    1,
    Math.max(
      0,
      params.shell.embodiment.timelineEnvelope * 0.55 +
        params.shell.motion.gestureLayerW * 0.45 -
        params.shell.motion.idleLayerW * 0.35,
    ),
  );

  const torsoTwist = Math.min(
    1,
    Math.abs(lastChest?.localEulerDeg.yaw ?? 0) / 95 +
      params.shell.embodiment.timelineEnvelope * 0.22,
  );

  const handElev = Math.min(
    1,
    Math.max(0, (lastArm?.forwardVector.y ?? 0) + 0.42 + params.shell.embodiment.timelineEnvelope * 0.2),
  );

  const chestPart = Math.min(
    1,
    Math.max(
      0,
      0.38 + params.shell.embodiment.timelineEnvelope * 0.58 - params.shell.motion.idleLayerW * 0.22,
    ),
  );

  const readability = Math.min(
    1,
    (lastArm?.conversationalReadability ?? 0) * 0.62 +
      (lastChest?.conversationalReadability ?? 0) * 0.28 +
      params.shell.speech.motionEnergyUnified * 0.22,
  );

  const visCone = Math.min(
    1,
    (lastArm?.cameraFacingScore ?? 0) * 0.58 +
      params.shell.motion.gestureLayerW * 0.34 +
      (1 - params.shell.motion.idleLayerW) * 0.22,
  );

  return {
    timestamp: ts,
    armOpenness: n100(armOpenness),
    elbowFlexionProxy: n100(elbowFlex),
    shoulderSpreadProxy: n100(shoulderSpread),
    torsoTwistProxy: n100(torsoTwist),
    handElevationProxy: n100(handElev),
    chestParticipation: n100(chestPart),
    conversationalReadability: n100(readability),
    gestureVisibilityCone: n100(visCone),
  };
}

function n100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}
