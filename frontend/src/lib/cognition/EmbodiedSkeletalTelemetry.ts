'use client';

/**
 * Incremental skeletal telemetry — fed only from throttled diagnostics flush (~≤4 Hz),
 * not from useFrame. Ring buffers are preallocated per tracked bone.
 */

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { BoneTelemetrySample, SkeletalTelemetryReportPayload } from './types';

const CAP = 32;

export const TRACKED_BONES = [
  'head',
  'neck',
  'chest',
  'spine',
  'hips',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
] as const;

export type TrackedBone = (typeof TRACKED_BONES)[number];

type Slot = BoneTelemetrySample;

function emptySlot(bone: string): Slot {
  return {
    bone,
    timestamp: 0,
    localEulerDeg: { pitch: 0, yaw: 0, roll: 0 },
    forwardVector: { x: 0, y: 1, z: 0 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: 0,
    conversationalReadability: 0,
    biomechanicalStatus: 'OK',
  };
}

const _rings = new Map<string, Slot[]>();
const _cursors = new Map<string, number>();
const _prevYaw = new Map<string, number>();
const _prevVel = new Map<string, number>();
const _prevTs = new Map<string, number>();

function ringFor(bone: string): Slot[] {
  let r = _rings.get(bone);
  if (!r) {
    r = Array.from({ length: CAP }, () => emptySlot(bone));
    _rings.set(bone, r);
    _cursors.set(bone, 0);
  }
  return r;
}

function pushSample(bone: string, sample: Slot): void {
  const ring = ringFor(bone);
  const c = (_cursors.get(bone) ?? 0) % CAP;
  ring[c] = sample;
  _cursors.set(bone, c + 1);
}

function biomechStatus(args: {
  yawDeg: number;
  motionSource: string;
  gestureW: number;
  idleW: number;
}): string {
  if (args.idleW > 0.88 && args.gestureW < 0.12 && args.motionSource === 'GESTURE')
    return 'AUTHORITY_STRADDLE';
  if (Math.abs(args.yawDeg) > 125) return 'BACKWARD_CONVERSATIONAL_COLLAPSE';
  if (Math.abs(args.yawDeg) > 85) return 'CONVERSATIONAL_RANGE_STRESS';
  return 'OK';
}

/**
 * Proxy ingestion from diagnostics shell — extends later with true FK / bone matrices.
 */
export function ingestDiagnosticsFlushProxy(shell: DiagnosticsWindowSurface): void {
  const ts = Date.now();
  const armRad = shell.motion.armDeviationLuaRad ?? 0;
  const armDeg = armRad * (180 / Math.PI);
  const env = shell.embodiment.timelineEnvelope;
  const g = shell.motion.gestureLayerW;
  const idle = shell.motion.idleLayerW;
  const prevFrameTs = _prevTs.get('_frame') ?? ts;
  const deltaMs = Math.max(16, ts - prevFrameTs);
  _prevTs.set('_frame', ts);

  const speak = shell.speech.speaking;
  /** Global idle weight stays ~1 even when speech energy drives motion — subtract less while speaking and lift from audio-derived energy so camera-facing proxy matches embodied speech (avoids flat facing=0 false negatives). */
  const speechEnergyLift = speak
    ? Math.min(
        0.45,
        (shell.speech.stableMotionEnergy ?? 0) * 0.38 +
          (shell.speech.motionEnergyUnified ?? 0) * 0.14,
      )
    : 0;
  const idlePenalty = speak ? 0.32 : 0.55;
  const facing = Math.min(
    1,
    Math.max(0, g * 1.15 + env * 0.85 - idle * idlePenalty + (speak ? 0.06 : 0) + speechEnergyLift),
  );
  const readability = Math.min(
    1,
    facing * 0.62 + env * 0.48 + Math.min(1, Math.abs(armRad) * 1.4) * 0.22,
  );

  const forwardZ = Math.cos(armRad * 0.85);
  const forwardX = Math.sin(armRad * 0.65) * -0.45;

  const writeArm = (bone: TrackedBone, yawDeg: number): void => {
    const prevY = _prevYaw.get(bone) ?? yawDeg;
    const prevV = _prevVel.get(bone) ?? 0;
    const dt = deltaMs / 1000;
    const vel = dt > 1e-4 ? ((yawDeg - prevY) * (Math.PI / 180)) / dt : 0;
    const accel = dt > 1e-4 ? (vel - prevV) / dt : 0;
    _prevYaw.set(bone, yawDeg);
    _prevVel.set(bone, vel);

    const status = biomechStatus({
      yawDeg,
      motionSource: shell.motion.motionSource,
      gestureW: g,
      idleW: idle,
    });

    pushSample(bone, {
      bone,
      timestamp: ts,
      localEulerDeg: {
        pitch: env * 10 - 5 + idle * 4,
        yaw: yawDeg,
        roll: env * 6 - 3,
      },
      forwardVector: {
        x: forwardX * (bone.includes('right') ? -1 : 1),
        y: 0.06 + env * 0.08,
        z: forwardZ,
      },
      angularVelocityRadS: vel,
      angularAccelRadS2: accel,
      cameraFacingScore: facing,
      conversationalReadability: readability,
      biomechanicalStatus: status,
    });
  };

  writeArm('rightUpperArm', -armDeg * 0.72);
  writeArm('leftUpperArm', armDeg * 0.68);

  const torsoYaw = idle * 12 - g * 14;
  pushSample('chest', {
    bone: 'chest',
    timestamp: ts,
    localEulerDeg: { pitch: env * 9 - 4, yaw: torsoYaw, roll: env * 5 },
    forwardVector: { x: 0, y: 0.12, z: 0.96 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: idle > 0.85 && shell.speech.speaking ? 'LOW_CHEST_PARTICIPATION' : 'OK',
  });

  pushSample('neck', {
    bone: 'neck',
    timestamp: ts,
    localEulerDeg: { pitch: -env * 4, yaw: torsoYaw * 0.35, roll: 0 },
    forwardVector: { x: 0, y: 0.18, z: 0.98 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing * 0.95,
    conversationalReadability: readability * 0.92,
    biomechanicalStatus: 'OK',
  });

  pushSample('head', {
    bone: 'head',
    timestamp: ts,
    localEulerDeg: { pitch: -env * 6, yaw: torsoYaw * 0.22, roll: env * 2 },
    forwardVector: { x: 0, y: 0.22, z: 0.97 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: readability < 0.22 && shell.speech.speaking ? 'LOW_HEAD_READABILITY' : 'OK',
  });

  const hipRoll = (shell.motion.motionSource === 'IDLE' ? idle : g) * 4;
  pushSample('hips', {
    bone: 'hips',
    timestamp: ts,
    localEulerDeg: { pitch: 0, yaw: torsoYaw * 0.12, roll: hipRoll },
    forwardVector: { x: 0, y: 1, z: 0 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing * 0.85,
    conversationalReadability: readability * 0.88,
    biomechanicalStatus: hipRoll < 1 && shell.speech.speaking ? 'RIGID_TORSO_PROXY' : 'OK',
  });

  pushSample('spine', {
    bone: 'spine',
    timestamp: ts,
    localEulerDeg: { pitch: env * 5, yaw: torsoYaw * 0.55, roll: env * 3 },
    forwardVector: { x: 0, y: 0.08, z: 0.98 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: 'OK',
  });

  const shr = env * 11 * (g > 0.08 ? 1 : 0.35);
  pushSample('leftShoulder', {
    bone: 'leftShoulder',
    timestamp: ts,
    localEulerDeg: { pitch: shr * 0.4, yaw: armDeg * 0.25, roll: shr },
    forwardVector: { x: 0.15, y: 0.55, z: 0.82 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: shr < 3 && g > 0.15 ? 'FROZEN_SHOULDERS_PROXY' : 'OK',
  });
  pushSample('rightShoulder', {
    bone: 'rightShoulder',
    timestamp: ts,
    localEulerDeg: { pitch: shr * 0.42, yaw: -armDeg * 0.27, roll: shr },
    forwardVector: { x: -0.15, y: 0.55, z: 0.82 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: shr < 3 && g > 0.15 ? 'FROZEN_SHOULDERS_PROXY' : 'OK',
  });

  const elbow = Math.min(110, 42 + Math.abs(armDeg) * 0.35 + idle * 22);
  pushSample('leftLowerArm', {
    bone: 'leftLowerArm',
    timestamp: ts,
    localEulerDeg: { pitch: elbow * 0.08, yaw: armDeg * 0.45, roll: elbow },
    forwardVector: { x: 0.2, y: -0.22, z: 0.92 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing * 0.92,
    conversationalReadability: readability,
    biomechanicalStatus: elbow > 95 && g > 0.1 ? 'ELBOW_FLEXION_STRESS' : 'OK',
  });
  pushSample('rightLowerArm', {
    bone: 'rightLowerArm',
    timestamp: ts,
    localEulerDeg: { pitch: elbow * 0.09, yaw: -armDeg * 0.46, roll: elbow },
    forwardVector: { x: -0.2, y: -0.22, z: 0.92 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing * 0.92,
    conversationalReadability: readability,
    biomechanicalStatus: elbow > 95 && g > 0.1 ? 'ELBOW_FLEXION_STRESS' : 'OK',
  });

  pushSample('leftHand', {
    bone: 'leftHand',
    timestamp: ts,
    localEulerDeg: { pitch: env * 3, yaw: armDeg * 0.12, roll: env * -4 },
    forwardVector: { x: 0.08, y: -0.35, z: 0.92 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: 'OK',
  });
  pushSample('rightHand', {
    bone: 'rightHand',
    timestamp: ts,
    localEulerDeg: { pitch: env * 3.2, yaw: -armDeg * 0.13, roll: env * -4 },
    forwardVector: { x: -0.08, y: -0.35, z: 0.92 },
    angularVelocityRadS: 0,
    angularAccelRadS2: 0,
    cameraFacingScore: facing,
    conversationalReadability: readability,
    biomechanicalStatus: 'OK',
  });
}

export function exportSkeletalTelemetryReport(): SkeletalTelemetryReportPayload {
  const bones: Record<string, BoneTelemetrySample[]> = {};
  const ts = new Date().toISOString();
  for (const bone of TRACKED_BONES) {
    const ring = _rings.get(bone);
    const cur = _cursors.get(bone) ?? 0;
    if (!ring) continue;
    const out: BoneTelemetrySample[] = [];
    const take = Math.min(12, CAP);
    for (let k = 1; k <= take; k++) {
      const idx = (cur - k + CAP * 100) % CAP;
      const s = ring[idx];
      if (s.timestamp <= 0) continue;
      out.push({ ...s });
    }
    bones[bone] = out.reverse();
  }
  return {
    timestamp: ts,
    bones,
    notes: [
      'Euler/forward vectors are proxy-derived from diagnostics flush until full FK bridge lands.',
      'Angular velocity uses yaw delta across flush intervals (~≤280ms).',
    ],
  };
}
