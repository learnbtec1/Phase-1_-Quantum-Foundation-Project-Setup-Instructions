/**
 * Dev-only detection: patches `Euler.set` on **normalized VRM humanoid bones** so any code path
 * that sets `bone.rotation.set(...)` on those nodes logs `[BYPASS DETECTED]`.
 *
 * - Enable: `NEXT_PUBLIC_BYPASS_PROBE=true`
 * - Does **not** patch `THREE.Euler.prototype` or `Object3D.prototype` (would false-positive
 *   every mesh / light / helper and break typical stack traces).
 * - Pose pipeline should apply motion via {@link applyFinalPoseToVrm} (`quaternion.copy`),
 *   not `rotation.set` on humanoid bones.
 */
'use client';

import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';
import * as THREE from 'three';

const NORMALIZED_PROBE_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
] as const;

export function installVrmHumanoidBypassProbe(vrm: VRM): () => void {
  const restores: Array<() => void> = [];
  if (typeof window === 'undefined') return () => {};
  if (process.env.NEXT_PUBLIC_BYPASS_PROBE !== 'true') return () => {};

  const humanoid = vrm.humanoid;
  if (!humanoid) return () => {};

  const patchRotationSet = (node: Object3D, label: string) => {
    const euler = node.rotation;
    const origSet = euler.set.bind(euler);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (euler as any).set = function patchedRotationSet(
      x: number,
      y: number,
      z: number,
      order?: THREE.EulerOrder,
    ) {
      // eslint-disable-next-line no-console -- explicit audit hook
      console.warn('[BYPASS DETECTED]', label, 'rotation.set', { x, y, z, order });
      return origSet(x, y, z, order);
    };
    restores.push(() => {
      euler.set = origSet;
    });
  };

  for (const name of NORMALIZED_PROBE_BONES) {
    const node = humanoid.getNormalizedBoneNode(name as never);
    if (node) patchRotationSet(node, name);
  }

  return () => {
    for (const r of restores) r();
  };
}
