/**
 * Gateway clamps for generative / semantic Euler targets (local YXZ, **radians**).
 * Bounds are defined in `kinematicStandards.ts` (ANATOMICAL_*_RAD).
 */
import * as THREE from 'three';
import {
  ANATOMICAL_LIMITS_CLAVICLE_RAD,
  ANATOMICAL_LIMITS_HEAD_RAD,
  ANATOMICAL_LIMITS_LLA_RAD,
  ANATOMICAL_LIMITS_LUA_RAD,
  ANATOMICAL_LIMITS_NECK_RAD,
  ANATOMICAL_LIMITS_RLA_RAD,
  ANATOMICAL_LIMITS_RUA_RAD,
  ANATOMICAL_LIMITS_TRUNK_RAD,
  ANATOMICAL_LIMITS_WRIST_RAD,
  type AnatomicalEulerLimitBox,
} from '@/app/avatar-agent/kinematicStandards';

function applyBox(x: number, y: number, z: number, b: AnatomicalEulerLimitBox): { x: number; y: number; z: number } {
  return {
    x: THREE.MathUtils.clamp(x, b.minX, b.maxX),
    y: THREE.MathUtils.clamp(y, b.minY, b.maxY),
    z: THREE.MathUtils.clamp(z, b.minZ, b.maxZ),
  };
}

/**
 * Enforces anatomical limits before rotations are stored or dispatched (same math as historical name).
 * Intercept: `THREE.MathUtils.clamp` per axis inside `applyBox` → used from `semanticCommand` and `VRMSkeletonManager` ingest.
 */
export function clampGenerativeEulerYXZ(
  poseKey: string,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const k = poseKey;

  if (k === 'neck') return applyBox(x, y, z, ANATOMICAL_LIMITS_NECK_RAD);
  if (k === 'head') return applyBox(x, y, z, ANATOMICAL_LIMITS_HEAD_RAD);

  if (k === 'rua' || k === 'rightUpperArm') return applyBox(x, y, z, ANATOMICAL_LIMITS_RUA_RAD);
  if (k === 'lua' || k === 'leftUpperArm') return applyBox(x, y, z, ANATOMICAL_LIMITS_LUA_RAD);

  if (k === 'rla' || k === 'rightLowerArm') return applyBox(x, y, z, ANATOMICAL_LIMITS_RLA_RAD);
  if (k === 'lla' || k === 'leftLowerArm') return applyBox(x, y, z, ANATOMICAL_LIMITS_LLA_RAD);

  if (k === 'spine' || k === 'chest' || k === 'hips') return applyBox(x, y, z, ANATOMICAL_LIMITS_TRUNK_RAD);

  if (k === 'leftShoulder' || k === 'rightShoulder') return applyBox(x, y, z, ANATOMICAL_LIMITS_CLAVICLE_RAD);

  if (
    k === 'lh' ||
    k === 'rh' ||
    k === 'leftHand' ||
    k === 'rightHand'
  ) {
    return applyBox(x, y, z, ANATOMICAL_LIMITS_WRIST_RAD);
  }

  if (
    k.includes('Finger') ||
    k.includes('Thumb') ||
    k.includes('Proximal') ||
    k.includes('Intermediate') ||
    k.includes('Distal')
  ) {
    return {
      x: THREE.MathUtils.clamp(x, -2.2, 2.2),
      y: THREE.MathUtils.clamp(y, -1.0, 1.0),
      z: THREE.MathUtils.clamp(z, -1.0, 1.0),
    };
  }

  if (k.includes('Leg') || k.includes('Foot') || k.includes('Toes')) {
    return {
      x: THREE.MathUtils.clamp(x, -1.6, 1.6),
      y: THREE.MathUtils.clamp(y, -0.55, 0.55),
      z: THREE.MathUtils.clamp(z, -1.2, 1.2),
    };
  }

  return {
    x: THREE.MathUtils.clamp(x, -Math.PI, Math.PI),
    y: THREE.MathUtils.clamp(y, -Math.PI, Math.PI),
    z: THREE.MathUtils.clamp(z, -Math.PI, Math.PI),
  };
}

/** Alias — semantic “gateway” name for audits. */
export const enforceAnatomicalLimits = clampGenerativeEulerYXZ;
