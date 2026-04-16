/**
 * Continuous subtle breathing — additive on final pose only (no root / hips).
 * Frequency ~0.18–0.28 Hz; shoulders trail chest by ~40 ms, upper arms by ~100 ms (phase delay).
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { getBreathingAmplitudeFactor } from '@/ai/avatar/avatarPersonality';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

/** Center of 0.18–0.28 Hz band */
const BREATH_FREQ_HZ = 0.23;
const SHOULDER_LAG_SEC = 0.04;
const ARM_LAG_SEC = 0.1;

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
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
    if (finalPose.has(key)) {
      mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
      return;
    }
  }
}

export function applyBreathingLayer(
  finalPose: BonePoseMap,
  _delta: number,
  elapsedSec: number,
  opts?: { amplitudeMul?: number },
): void {
  const w = Math.PI * 2 * BREATH_FREQ_HZ;
  const breath = Math.sin(elapsedSec * w);
  const breathShoulder = Math.sin((elapsedSec - SHOULDER_LAG_SEC) * w);
  const breathArm = Math.sin((elapsedSec - ARM_LAG_SEC) * w);

  const mul = Math.min(1.45, Math.max(0.75, opts?.amplitudeMul ?? 1));
  /** Slow drift so breath depth is never perfectly periodic */
  const ampWobble = 1 + 0.045 * Math.sin(elapsedSec * 0.062 + 0.3);
  const amp = 0.009 * getBreathingAmplitudeFactor() * mul * ampWobble;
  // Slight chest expansion (forward / pitch-up of upper torso)
  mulBoneDeltaEuler(finalPose, 'chest', breath * amp * -0.85, 0, 0);
  mulBoneDeltaEuler(finalPose, 'spine', breath * amp * -0.45, 0, 0);
  // Minimal shoulder rise (out-of-phase amplitude)
  const sh = breathShoulder * amp * 0.42;
  mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, sh);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -sh * 0.96);
  // Trace into upper arms (delayed)
  const arm = breathArm * amp * 0.28;
  mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], arm * 0.35, 0, arm * 0.4);
  mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], -arm * 0.32, 0, -arm * 0.38);
}
