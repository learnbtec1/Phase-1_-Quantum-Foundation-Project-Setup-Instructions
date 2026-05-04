/**
 * Phase 20 — Procedural “life” layered on final pose while VRMA is active.
 * Decoupled from TTS: keeps spine / chest / shoulders breathing so the figure never reads as frozen.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { vrmaMicroBreathEuler } from '@/app/avatar-agent/proceduralLife';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

function mulBoneEuler(
  finalPose: BonePoseMap,
  key: string,
  rx: number,
  ry: number,
  rz: number,
): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

export type ProceduralVrmaLifeOpts = {
  /** Multiplies spine/chest/shoulder micro motion (default 1). */
  intensityMul?: number;
  /** Slow neck/head roll so the figure reads alive during VRMA + speech. */
  neckSway?: boolean;
};

export function applyProceduralVrmaLifeOverlay(
  finalPose: BonePoseMap,
  t: number,
  _delta: number,
  opts?: ProceduralVrmaLifeOpts,
): void {
  const mul = Math.max(0.5, Math.min(2.4, opts?.intensityMul ?? 1));
  const { spineX, chestX, shoulderRoll } = vrmaMicroBreathEuler(t);
  mulBoneEuler(finalPose, 'spine', spineX * mul, 0, 0);
  mulBoneEuler(finalPose, 'chest', chestX * 0.88 * mul, 0, 0);
  mulBoneEuler(finalPose, 'leftShoulder', 0, 0, shoulderRoll * mul);
  mulBoneEuler(finalPose, 'rightShoulder', 0, 0, -shoulderRoll * 0.94 * mul);

  if (opts?.neckSway) {
    const ny = Math.sin(t * 0.71) * 0.0042 * mul;
    const nx = Math.sin(t * 0.53 + 0.2) * 0.0036 * mul;
    mulBoneEuler(finalPose, 'neck', nx, ny, 0);
    mulBoneEuler(finalPose, 'head', nx * 0.55, ny * 0.62, 0);
  }
}
