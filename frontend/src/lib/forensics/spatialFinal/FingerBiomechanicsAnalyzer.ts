'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { SkeletalTelemetryReportPayload } from '@/lib/cognition/types';

import type { FingerBiomechanicsPayload, SpatialVerifiedFailure } from './types';
import { latestBoneSample } from './boneSampleUtils';

const CONF = 0.55;

function handProxies(bone: string, s: ReturnType<typeof latestBoneSample>): FingerBiomechanicsPayload['leftHand'] {
  if (!s) return { curlProxy: 0, wristFlexProxy: 0, palmOpennessProxy: 0 };
  const { pitch, roll } = s.localEulerDeg;
  const curl = Math.min(1, (Math.abs(roll) + Math.abs(pitch) * 0.35) / 95);
  const wristFlex = Math.min(1, Math.abs(pitch) / 85);
  const palmOpen = Math.min(1, Math.max(0, s.cameraFacingScore * 0.62 + (1 - curl) * 0.38));
  return {
    curlProxy: Math.round(curl * 1000) / 1000,
    wristFlexProxy: Math.round(wristFlex * 1000) / 1000,
    palmOpennessProxy: Math.round(palmOpen * 1000) / 1000,
  };
}

export function analyzeFingerBiomechanics(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
}): FingerBiomechanicsPayload {
  const ts = new Date().toISOString();
  const verifiedFailures: SpatialVerifiedFailure[] = [];
  const lh = latestBoneSample(params.skeletal.bones.leftHand);
  const rh = latestBoneSample(params.skeletal.bones.rightHand);
  const leftHand = handProxies('leftHand', lh);
  const rightHand = handProxies('rightHand', rh);

  const g = params.shell?.motion.gestureLayerW ?? 0;
  const frozen =
    g > 0.24 &&
    leftHand.curlProxy < 0.04 &&
    rightHand.curlProxy < 0.04 &&
    leftHand.wristFlexProxy < 0.05 &&
    rightHand.wristFlexProxy < 0.05;

  if (frozen) {
    verifiedFailures.push({
      id: 'finger_frozen_while_gesture',
      subsystem: 'spatial',
      summary: 'Hands/wrists frozen flat while gesture weights imply articulation — robotic closure risk',
      confidence: 0.59,
      evidence: [`gestureW=${g.toFixed(2)}`, `Lcurl=${leftHand.curlProxy}`, `Rcurl=${rightHand.curlProxy}`],
    });
  }

  if (
    (lh && /BACKWARD|CORRUPTION/i.test(lh.biomechanicalStatus)) ||
    (rh && /BACKWARD|CORRUPTION/i.test(rh.biomechanicalStatus))
  ) {
    verifiedFailures.push({
      id: 'finger_hand_orientation_invalid',
      subsystem: 'spatial',
      summary: 'Hand chain biomechanical flags indicate inversion or corruption along conversational axis',
      confidence: 0.62,
      evidence: [`left=${lh?.biomechanicalStatus ?? 'n/a'}`, `right=${rh?.biomechanicalStatus ?? 'n/a'}`],
    });
  }

  return {
    timestamp: ts,
    leftHand,
    rightHand,
    verifiedFailures: verifiedFailures.filter((f) => f.confidence >= CONF),
  };
}
