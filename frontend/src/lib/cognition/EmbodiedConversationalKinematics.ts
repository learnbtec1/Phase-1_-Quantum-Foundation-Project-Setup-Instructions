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
  const zeroVisibility = (): ConversationalKinematicsReportPayload => ({
    timestamp: ts,
    armOpenness: 0,
    elbowFlexionProxy: 0,
    shoulderSpreadProxy: 0,
    torsoTwistProxy: 0,
    handElevationProxy: 0,
    chestParticipation: 0,
    conversationalReadability: 0,
    gestureVisibilityCone: 0,
    opennessScore: 0,
    gestureProjectionScore: 0,
    conversationalSpread: 0,
    cameraReadability: 0,
    torsoParticipation: 0,
    shoulderVisibility: 0,
    gesturePersistence: 0,
    conversationalEnergy: 0,
    silhouetteClarity: 0,
  });

  if (!params.shell) {
    return zeroVisibility();
  }

  const lastArm = params.armSamples[params.armSamples.length - 1];
  const lastChest = params.chestSamples[params.chestSamples.length - 1];

  const sh = params.shell;
  const speakLift = Math.min(1, sh.speech.motionEnergyUnified * 0.26 + sh.speech.stableMotionEnergy * 0.18);

  const armOpenness = Math.min(
    1,
    Math.abs(lastArm?.localEulerDeg.yaw ?? 0) / 118 *
      (sh.motion.gestureLayerW + 0.38 + speakLift),
  );

  const elbowFlex = Math.min(1, Math.abs(lastArm?.localEulerDeg.roll ?? 0) / 115);

  const shoulderSpread = Math.min(
    1,
    Math.max(
      0,
      sh.embodiment.timelineEnvelope * 0.64 +
        sh.motion.gestureLayerW * 0.52 -
        sh.motion.idleLayerW * 0.26,
    ),
  );

  const torsoTwist = Math.min(
    1,
    Math.abs(lastChest?.localEulerDeg.yaw ?? 0) / 92 +
      sh.embodiment.timelineEnvelope * 0.28 +
      speakLift * 0.08,
  );

  const handElev = Math.min(
    1,
    Math.max(
      0,
      (lastArm?.forwardVector.y ?? 0) + 0.44 + sh.embodiment.timelineEnvelope * 0.26 + speakLift * 0.12,
    ),
  );

  const chestPart = Math.min(
    1,
    Math.max(
      0,
      0.42 + sh.embodiment.timelineEnvelope * 0.62 - sh.motion.idleLayerW * 0.18 + speakLift * 0.06,
    ),
  );

  const readability = Math.min(
    1,
    (lastArm?.conversationalReadability ?? 0) * 0.68 +
      (lastChest?.conversationalReadability ?? 0) * 0.32 +
      sh.speech.motionEnergyUnified * 0.28 +
      sh.embodiment.timelineEnvelope * 0.14,
  );

  const visCone = Math.min(
    1,
    (lastArm?.cameraFacingScore ?? 0) * 0.68 +
      sh.motion.gestureLayerW * 0.42 +
      (1 - sh.motion.idleLayerW) * 0.28 +
      Math.min(1, sh.speech.stableMotionEnergy * 0.2),
  );

  const opennessScoreRaw = armOpenness * 0.36 + shoulderSpread * 0.38 + handElev * 0.26;
  const gestureProjRaw = handElev * 0.52 + visCone * 0.48;
  const spreadRaw = shoulderSpread * 0.55 + armOpenness * 0.45;
  const torsoPartRaw = torsoTwist * 0.44 + chestPart * 0.56;
  const shoulderVisRaw = shoulderSpread * 0.68 + handElev * 0.32;
  const cameraReadRaw = visCone * 0.54 + readability * 0.46;
  const silhouetteRaw = readability * 0.34 + visCone * 0.42 + armOpenness * 0.24;

  const gesturePersistenceRaw = Math.max(
    0,
    Math.min(
      1,
      sh.embodiment.timelineEnvelope * 0.54 +
        sh.motion.gestureLayerW * 0.42 +
        (sh.speech.speaking ? 0.06 : 0) -
        (sh.motion.idleDominatesGesture ? 0.14 : 0),
    ),
  );

  const conversationalEnergyRaw = Math.min(
    1,
    Math.min(1, sh.speech.motionEnergyUnified * 1.28) * 0.52 +
      Math.min(1, sh.speech.stableMotionEnergy * 1.18) * 0.48,
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
    opennessScore: n100(opennessScoreRaw),
    gestureProjectionScore: n100(gestureProjRaw),
    conversationalSpread: n100(spreadRaw),
    cameraReadability: n100(cameraReadRaw),
    torsoParticipation: n100(torsoPartRaw),
    shoulderVisibility: n100(shoulderVisRaw),
    gesturePersistence: n100(gesturePersistenceRaw),
    conversationalEnergy: n100(conversationalEnergyRaw),
    silhouetteClarity: n100(silhouetteRaw),
  };
}

function n100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}
