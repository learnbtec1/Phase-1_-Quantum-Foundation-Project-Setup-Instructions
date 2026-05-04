/**
 * **Single entry** for turning anatomical (pitch/yaw/roll) micro-deltas into local **YXZ** euler
 * components (radians) per normalized VRM bone, using {@link PROCEDURAL_V2_BONE_AXES}.
 *
 * Downstream pose code must **not** assign `bone.rotation.*` for these motions — it should
 * write only through {@link applyFinalPoseToVrm} / BonePoseMap quaternion deltas.
 */
'use client';

import * as THREE from 'three';
import type { EulerAxis } from './skeletonCoordinateSystem';
import { PROCEDURAL_V2_BONE_AXES } from './skeletonCoordinateSystem';

export type AnatomicalDelta = {
  pitch: number;
  yaw: number;
  roll: number;
};

/**
 * Production API: anatomical deltas → euler (rx, ry, rz) for `THREE.Euler(..., 'YXZ')`.
 */
export function applyCalibratedAnatomicalDelta(
  boneName: string,
  delta: AnatomicalDelta,
  out?: THREE.Vector3,
): THREE.Vector3 {
  const o = out ?? new THREE.Vector3();
  return anatomicalToEulerDeltaInternal(boneName, delta.pitch, delta.yaw, delta.roll, o);
}

function anatomicalToEulerDeltaInternal(
  boneKey: string,
  pitch: number,
  yaw: number,
  roll: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.set(0, 0, 0);
  const spec = PROCEDURAL_V2_BONE_AXES[boneKey];
  if (!spec) return out;
  const p = pitch * spec.inversionMultiplier.pitch;
  const y = yaw * spec.inversionMultiplier.yaw;
  const r = roll * spec.inversionMultiplier.roll;
  const bump = (axis: EulerAxis, val: number) => {
    if (axis === 'x') out.x += val;
    else if (axis === 'y') out.y += val;
    else out.z += val;
  };
  bump(spec.pitchAxis, p);
  bump(spec.yawAxis, y);
  bump(spec.rollAxis, r);
  return out;
}

/** @internal Re-export for modules that must avoid circular imports — prefer {@link applyCalibratedAnatomicalDelta}. */
export function anatomicalToEulerDelta(
  boneKey: string,
  pitch: number,
  yaw: number,
  roll: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return anatomicalToEulerDeltaInternal(boneKey, pitch, yaw, roll, out);
}

/**
 * **Do not** poison `THREE.Object3D.prototype.rotation` — React Three Fiber, controls, and GLTF
 * loaders set rotation on thousands of objects; blocking it hard-crashes the app.
 *
 * Use {@link installVrmHumanoidBypassProbe} (`NEXT_PUBLIC_BYPASS_PROBE=true`) on **humanoid bone**
 * nodes only.
 */
export function assertGlobalRotationGuardNotUsed(): void {
  /* intentional no-op — see JSDoc */
}
