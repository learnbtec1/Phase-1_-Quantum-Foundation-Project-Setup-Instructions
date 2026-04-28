/**
 * Additive humanization on final pose (quaternion multiply). Does not replace base/VRMA pose.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import {
  deterministicNoiseSpineChest,
  deterministicAttentionSeekingNudge,
} from '@/lib/avatar/deterministicNoiseController';
import type { HumanizationSnapshot } from '@/lib/avatar/humanizationController';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

const SHOULDER_LAG_SEC = 0.04;
const HEAD_LAG_SEC = 0.08;

function mulBone(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function mulFirst(
  finalPose: BonePoseMap,
  keys: readonly string[],
  rx: number,
  ry: number,
  rz: number,
): void {
  for (const key of keys) {
    if (!finalPose.has(key) || isPoseKeyProcedurallySuppressed(key)) continue;
    mulBone(finalPose, key, rx, ry, rz);
    return;
  }
}

const HUMANIZATION_NOISE_CAP_RAD = 0.004;

export function applyHumanizationLayer(
  finalPose: BonePoseMap,
  safeDelta: number,
  snap: HumanizationSnapshot,
): void {
  const t = snap.tSec;
  const noiseAmp = Math.min(HUMANIZATION_NOISE_CAP_RAD, snap.noiseAmpRad);
  const w = Math.PI * 2 * snap.breathFreqHz;
  let chestPhase = Math.sin(t * w) * snap.breathAmpMul;
  if (snap.breathingMode === 'thinking') {
    chestPhase +=
      0.35 * Math.sin(t * w * 1.618 + 0.7) * snap.breathAmpMul;
  }
  const shoulderPhase = Math.sin((t - SHOULDER_LAG_SEC) * w) * snap.breathAmpMul;
  const headPhase = Math.sin((t - HEAD_LAG_SEC) * w) * snap.breathAmpMul * 0.22;

  const amp = 0.009 * snap.breathAmpMul * snap.motionSpeedMul;
  mulBone(finalPose, 'chest', chestPhase * amp * -0.85, 0, 0);
  mulBone(finalPose, 'spine', chestPhase * amp * -0.45, 0, 0);
  const sh = shoulderPhase * amp * 0.42;
  mulBone(finalPose, 'leftShoulder', 0, 0, sh);
  mulBone(finalPose, 'rightShoulder', 0, 0, -sh * 0.96);
  mulBone(finalPose, 'neck', headPhase * 0.4 + snap.anticipationNeckTilt + snap.freezeHealNeckTilt, 0, 0);
  mulBone(
    finalPose,
    'head',
    headPhase * 0.35 + snap.saccadePitch + snap.fixationPitch + snap.stabilizeDriftPitch,
    snap.saccadeYaw + snap.fixationYaw + snap.stabilizeDriftYaw,
    0,
  );

  const n = deterministicNoiseSpineChest(t, noiseAmp);
  mulBone(finalPose, 'spine', n.spineRx, 0, n.spineRz);
  mulBone(finalPose, 'chest', n.chestRx, 0, 0);
  mulBone(finalPose, 'leftShoulder', 0, n.shoulderY, 0);
  mulBone(finalPose, 'rightShoulder', 0, -n.shoulderY * 0.96, 0);

  if (snap.freezeHealShoulder > 1e-6) {
    const fh = snap.freezeHealShoulder;
    mulBone(finalPose, 'leftShoulder', fh, 0, 0);
    mulBone(finalPose, 'rightShoulder', -fh * 0.9, 0, 0);
  }

  mulFirst(finalPose, ['lua', 'leftUpperArm'], shoulderPhase * amp * 0.1, 0, shoulderPhase * amp * 0.12);
  mulFirst(finalPose, ['rua', 'rightUpperArm'], -shoulderPhase * amp * 0.09, 0, -shoulderPhase * amp * 0.11);

  void safeDelta;
}

/** Phase 6: forward lean + head tilt when engagement is low (strength 0–1). */
export function applyAttentionSeekingLayer(
  finalPose: BonePoseMap,
  tSec: number,
  strength: number,
): void {
  if (strength <= 1e-6) return;
  const k = THREE.MathUtils.clamp(strength, 0, 1);
  const n = deterministicAttentionSeekingNudge(tSec);
  mulBone(finalPose, 'spine', n.forwardLean * k, 0, n.tiltZ * k * 0.6);
  mulBone(finalPose, 'chest', n.forwardLean * k * 0.45, 0, 0);
  mulBone(finalPose, 'neck', 0, n.tiltZ * k * 0.55, 0);
  mulBone(
    finalPose,
    'head',
    n.forwardLean * k * 0.35,
    n.tiltZ * k * 0.4,
    0,
  );
}
