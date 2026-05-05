'use client';

import * as THREE from 'three';

/**
 * Post–orientation calibration for procedural **upper-arm** gesture quaternions only
 * (`slerpArmEuler` → `gesturePose` keys `rua` / `lua` in VRMSkeletonManager).
 *
 * - **Does not** rotate `AvatarRoot` or change bind/rest poses.
 * - Default **identity**: cogni.vrm reach (−ruaX / +luaX in local YXZ) already tracks
 *   torso-forward (+Z world) when root yaw is 0.
 *
 * If capture shows reach drifting along ±X world, assign a **small** corrective quaternion
 * here (never use π hacks on the avatar root).
 */
export const GESTURE_UPPER_ARM_CALIB_QUAT = new THREE.Quaternion(0, 0, 0, 1);

const _EPS = 1e-8;

/** True when {@link GESTURE_UPPER_ARM_CALIB_QUAT} is not identity. */
export function isGestureUpperArmCalibActive(): boolean {
  const q = GESTURE_UPPER_ARM_CALIB_QUAT;
  return Math.abs(q.w - 1) > _EPS || Math.abs(q.x) > _EPS || Math.abs(q.y) > _EPS || Math.abs(q.z) > _EPS;
}

/**
 * Applies calibration to quaternion built from Euler targets **before** writing to pose map.
 * Order: `q ← q_calib * q` (premultiply — correction in normalized shoulder frame).
 */
export function applyUpperArmGestureCalib(q: THREE.Quaternion): void {
  if (!isGestureUpperArmCalibActive()) return;
  q.premultiply(GESTURE_UPPER_ARM_CALIB_QUAT);
}
