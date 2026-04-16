/**
 * Gaze from BrainState payload — IK-style offsets (fed to neck refs / LookAt).
 */
'use client';

import * as THREE from 'three';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import { deterministicNoiseVector3 } from '@/lib/avatar/deterministicNoiseController';
import { getGazeLockStrength } from '@/store/usePerceptionStore';

const _v = new THREE.Vector3();

export function computeGazeOffsetEuler(payload: BrainStatePayload): { yaw: number; pitch: number; roll: number } {
  _v.set(payload.gazeTarget[0], payload.gazeTarget[1], payload.gazeTarget[2]);
  if (_v.lengthSq() < 1e-8) _v.set(0, 1.5, 1.2);
  _v.normalize();

  let yaw = Math.atan2(_v.x, _v.z);
  let pitch = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));

  if (payload.gazeMode === 'thinking') {
    yaw += 0.12;
    pitch += 0.1;
  } else if (payload.gazeMode === 'scanning') {
    const t = payload.timestampMs * 0.001;
    yaw += Math.sin(t * 0.7) * 0.08;
    pitch += Math.cos(t * 0.5) * 0.05;
  }

  return { yaw, pitch, roll: 0 };
}

export function computeGazeOffsetEulerWithAttention(
  payload: BrainStatePayload,
  engagement: number,
  tSec: number,
): { yaw: number; pitch: number; roll: number } {
  const base = computeGazeOffsetEuler(payload);
  const s = 1 - THREE.MathUtils.clamp(engagement, 0, 1);
  const n = deterministicNoiseVector3(tSec, 0.012);
  const driftYaw = n.x * s * 0.12;
  const driftPitch = n.y * s * 0.1;
  const lock = getGazeLockStrength();
  const a = THREE.MathUtils.clamp(lock, 0, 1);
  return {
    yaw: THREE.MathUtils.lerp(base.yaw + driftYaw, base.yaw, a),
    pitch: THREE.MathUtils.lerp(base.pitch + driftPitch, base.pitch, a),
    roll: base.roll,
  };
}
