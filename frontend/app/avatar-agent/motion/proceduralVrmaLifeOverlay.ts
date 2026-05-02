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

export function applyProceduralVrmaLifeOverlay(
  finalPose: BonePoseMap,
  t: number,
  _delta: number,
): void {
  const { spineX, chestX, shoulderRoll } = vrmaMicroBreathEuler(t);
  mulBoneEuler(finalPose, 'spine', spineX, 0, 0);
  mulBoneEuler(finalPose, 'chest', chestX * 0.88, 0, 0);
  mulBoneEuler(finalPose, 'leftShoulder', 0, 0, shoulderRoll);
  mulBoneEuler(finalPose, 'rightShoulder', 0, 0, -shoulderRoll * 0.94);
}
