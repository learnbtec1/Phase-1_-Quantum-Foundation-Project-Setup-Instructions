/**
 * Additive humanization on final pose (quaternion multiply). Does not replace base/VRMA pose.
 *
 * Trunk / neck / head / shoulder / upper-arm **breath & micro posture** use `proceduralV2`
 * (axis-correct YXZ composition). Attention-seeking overlay stays in this file.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { deterministicAttentionSeekingNudge } from '@/lib/avatar/deterministicNoiseController';
import type { HumanizationSnapshot } from '@/lib/avatar/humanizationController';
import {
  applyLayeredProceduralStack,
} from '@/app/avatar-agent/motion/proceduralV2/motionComposition';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

function mulBone(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

export function applyHumanizationLayer(
  finalPose: BonePoseMap,
  safeDelta: number,
  snap: HumanizationSnapshot,
): void {
  applyLayeredProceduralStack(
    finalPose,
    {
      tSec:                     snap.tSec,
      breathAmp01:              snap.breathAmpMul,
      breathFreqHz:             snap.breathFreqHz,
      motionSpeedMul:           snap.motionSpeedMul,
      breathingMode:            snap.breathingMode,
      headGazeYawRad:           snap.saccadeYaw + snap.fixationYaw + snap.stabilizeDriftYaw,
      headGazePitchRad:
        snap.saccadePitch + snap.fixationPitch + snap.stabilizeDriftPitch,
      neckPitchBiasRad:         snap.anticipationNeckTilt + snap.freezeHealNeckTilt,
      shoulderFreezeHealPitchRad: snap.freezeHealShoulder,
    },
    safeDelta,
  );
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
