/**
 * Ultra-subtle cinematic micro-motion: smooth sin composition (no random jumps).
 * Head / neck use current time; shoulders +40 ms; upper arms +100 ms — avoids perfect sync.
 * Ease-in-out shaping on slow envelope; extra lift while speaking + micro pitch from syllable proxy.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { getCinematicMicroNoiseScale } from '@/ai/avatar/avatarPersonality';
import { logCinematicMicroProbe } from '@/app/avatar-agent/motion/motionPipelineDebug';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

/** Seconds — shoulder chain lags head; hands/upper arms lag more (natural whip). */
const SHOULDER_LAG_SEC = 0.04;
const UPPER_ARM_LAG_SEC = 0.1;

function easeInOut01(u: number): number {
  const x = THREE.MathUtils.clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function mulFirstPresent(
  finalPose: BonePoseMap,
  keys: readonly string[],
  rx: number,
  ry: number,
  rz: number,
): void {
  for (const key of keys) {
    if (!finalPose.has(key) || isPoseKeyProcedurallySuppressed(key)) continue;
    mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
    return;
  }
}

export type CinematicMicroOpts = {
  /** Agent is in TTS / lip-sync window */
  speaking?: boolean;
  /** 0–1 smoothed RMS */
  energy?: number;
  /** 0–1 decaying spike — micro nod proxy */
  syllablePulse?: number;
};

export function applyCinematicMicroLayer(
  finalPose: BonePoseMap,
  _delta: number,
  elapsedSec: number,
  opts?: CinematicMicroOpts,
): void {
  const s0 = getCinematicMicroNoiseScale();
  const speaking = !!opts?.speaking;
  const enRaw = typeof opts?.energy === 'number' ? THREE.MathUtils.clamp(opts.energy, 0, 1) : 0;
  const sp = typeof opts?.syllablePulse === 'number' ? THREE.MathUtils.clamp(opts.syllablePulse, 0, 1) : 0;

  /** Idle baseline from caller (e.g. speechDrive) — keeps non-speech micro visible. */
  const en = speaking ? enRaw : Math.max(0.15, enRaw);
  /** Speaking branch slightly reduced so layered procedural expression stays visible. */
  const speakMul = speaking ? 1 + 0.04 + en * 0.07 : 1 + 0.05 + en * 0.14;
  /** Raw coefficients ~1e-4 rad — too subtle alone; amplify when not speaking. */
  const idleAmplify = speaking ? 1 : 6.2;
  const s = s0 * speakMul * idleAmplify;

  const tH = elapsedSec;
  const tS = elapsedSec - SHOULDER_LAG_SEC;
  const tA = elapsedSec - UPPER_ARM_LAG_SEC;

  /** Slow amplitude / timing wobble — breaks repetition */
  const vW = 0.96 + 0.04 * Math.sin(tH * 0.041 + 0.7);
  const vP = 0.96 + 0.04 * Math.sin(tH * 0.053 + 2.1);

  /** Ease-in-out envelope on a very slow sinusoid — softens perceived starts/stops */
  const env = easeInOut01((Math.sin(tH * 0.23) + 1) * 0.5);
  const envMul = 0.91 + 0.09 * env;

  // "Eye" micro feel via neck + head — immediate (tH)
  const headYaw =
    (Math.sin(tH * 0.62 + 0.2) * 0.55 + Math.sin(tH * 1.07 + 0.9) * 0.35)
    * 0.00045
    * s
    * vW
    * envMul;
  const headPitch =
    (Math.sin(tH * 0.71 + 1.1) * 0.5 + Math.sin(tH * 0.89 + 0.15) * 0.5)
    * 0.00038
    * s
    * vP
    * envMul;
  const headRoll =
    (Math.sin(tH * 0.54 + 2.0) * 0.45 + Math.sin(tH * 1.12 + 0.4) * 0.35)
    * 0.00032
    * s
    * envMul;

  /** Syllable-linked micro pitch — reduced so expression/sequencer head motion reads clearly */
  const syllNod = sp * 0.00026 * s;

  mulBoneDeltaEuler(finalPose, 'neck', headYaw * 0.42, headPitch * 0.4 + syllNod * 0.35, headRoll * 0.35);
  mulBoneDeltaEuler(finalPose, 'head', headYaw * 0.88, headPitch * 0.82 + syllNod, headRoll * 0.62);

  // Shoulders follow delayed time tS
  const sh =
    (Math.sin(tS * 0.48 + 0.3) * 0.5 + Math.sin(tS * 0.76 + 1.4) * 0.5) * 0.00035 * s * envMul;
  mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, sh);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -sh * 0.94);

  // Upper arms: smallest delayed ripple (non-sync with head)
  const armRoll =
    (Math.sin(tA * 0.51 + 0.4) * 0.5 + Math.sin(tA * 0.67 + 1.0) * 0.5) *
    0.00011 *
    s *
    (speaking ? 1.06 : 1.25);
  mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], 0, 0, armRoll);
  mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], 0, 0, -armRoll * 0.92);

  logCinematicMicroProbe({
    speaking,
    energy: enRaw,
    syllablePulse: sp,
    headYawRad: headYaw,
    headPitchRad: headPitch,
    scaleS: s,
  });
}
