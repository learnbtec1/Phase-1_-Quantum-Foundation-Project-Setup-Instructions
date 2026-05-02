/**
 * Universal semantic / generative bone commands — local YXZ Euler on normalized VRM bones.
 * Right-arm primary reach: −X, up: −Z (`armGestureReference` / empirical). Left limbs: mirrored X.
 *
 * Dispatches `avatar:generative:gesture`. Locks persist until `resetGenerativeGestureLocks`.
 */

'use client';

import * as THREE from 'three';
import type { GenerativeGestureDetail } from '@/app/avatar-agent/GenerativeGestureManager';
import {
  ARM_IDLE,
  LUA_FORWARD_SIGN,
  RUA_FORWARD_SIGN,
  RUA_UP_SIGN,
} from '@/app/avatar-agent/armGestureReference';
import { normalizeGenerativeBoneKey } from '@/app/avatar-agent/generativeBoneNormalize';
import { clampGenerativeEulerYXZ } from '@/app/avatar-agent/motion/jointEulerLimits';

const _qAxis = new THREE.Quaternion();
const _eAxis = new THREE.Euler(0, 0, 0, 'YXZ');

export type SemanticBoneAxis = 'X' | 'Y' | 'Z';

export type SemanticUpperArmBone =
  | 'rightUpperArm'
  | 'leftUpperArm'
  | 'rua'
  | 'lua';

export type SemanticArmMotion = 'forward' | 'backward' | 'up' | 'down';

export type SendSemanticOptions = {
  durationMs?: number;
  blend?: number;
  replaceAll?: boolean;
  /** If true, Euler components and single-axis values are degrees (converted in VRMSkeletonManager). */
  assumeEulerDegrees?: boolean;
};

export type UniversalBoneCommand = {
  /** Any VRM humanoid name or alias (see `generativeBoneNormalize`). */
  bone: string;
  /** Absolute Euler in local YXZ radians (preferred with `euler`). */
  euler?: { x: number; y: number; z: number };
  /** Single-axis absolute value (YXZ component). */
  axis?: SemanticBoneAxis;
  value?: number;
  /** Unit axis + rotation (radians); converted to Euler via quaternion in YXZ. */
  axisAngle?: { x: number; y: number; z: number; radians: number };
  blend?: number;
  replaceAll?: boolean;
  /** Reserved for future priority arbitration. */
  priority?: number;
  /** Reserved; all generative targets use persistent lock until reset. */
  lock?: boolean;
  assumeEulerDegrees?: boolean;
};

function boneToGenerativeKey(bone: SemanticUpperArmBone): 'rightUpperArm' | 'leftUpperArm' {
  const b = bone.replace(/\s+/g, '').toLowerCase();
  if (b === 'rua' || b === 'rightupperarm') return 'rightUpperArm';
  return 'leftUpperArm';
}

function dispatch(detail: GenerativeGestureDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:generative:gesture', {
      detail,
    }),
  );
}

/**
 * Single entry point for procedural bone targets (fingers, head, legs, spine, arms, …).
 * Uses canonical pose keys internally (`normalizeGenerativeBoneKey`).
 */
export function sendUniversalBoneCommand(cmd: UniversalBoneCommand): void {
  if (typeof window === 'undefined') return;
  const pk = normalizeGenerativeBoneKey(cmd.bone);
  if (!pk) return;

  let x = 0;
  let y = 0;
  let z = 0;

  if (cmd.euler) {
    x = cmd.euler.x;
    y = cmd.euler.y;
    z = cmd.euler.z;
  } else if (cmd.axis != null && cmd.value != null && Number.isFinite(cmd.value)) {
    const ax = cmd.axis.toUpperCase();
    if (ax === 'X') x = cmd.value;
    else if (ax === 'Y') y = cmd.value;
    else z = cmd.value;
  } else if (
    cmd.axisAngle &&
    Number.isFinite(cmd.axisAngle.radians) &&
    Number.isFinite(cmd.axisAngle.x) &&
    Number.isFinite(cmd.axisAngle.y) &&
    Number.isFinite(cmd.axisAngle.z)
  ) {
    const { x: ax, y: ay, z: az, radians } = cmd.axisAngle;
    const len = Math.hypot(ax, ay, az);
    if (len < 1e-8) return;
    _qAxis.setFromAxisAngle(new THREE.Vector3(ax / len, ay / len, az / len), radians);
    _eAxis.setFromQuaternion(_qAxis, 'YXZ');
    x = _eAxis.x;
    y = _eAxis.y;
    z = _eAxis.z;
  } else {
    return;
  }

  if (cmd.assumeEulerDegrees) {
    x = THREE.MathUtils.degToRad(x);
    y = THREE.MathUtils.degToRad(y);
    z = THREE.MathUtils.degToRad(z);
  }
  const cl = clampGenerativeEulerYXZ(pk, x, y, z);

  dispatch({
    bones: { [pk]: { x: cl.x, y: cl.y, z: cl.z } },
    blend: cmd.blend ?? 0.92,
    replaceAll: cmd.replaceAll,
    source: 'semanticCommand:universal',
    assumeEulerDegrees: false,
  });
}

/**
 * @param motion — when set, `magnitude` applies along empirical forward/up for upper arms only.
 */
export function sendSemanticUpperArmToAvatar(
  cmd: {
    bone: SemanticUpperArmBone;
    axis?: SemanticBoneAxis;
    value?: number;
    motion?: SemanticArmMotion;
    magnitude?: number;
  } & SendSemanticOptions,
): void {
  if (typeof window === 'undefined') return;

  const key = boneToGenerativeKey(cmd.bone);
  const idle = ARM_IDLE;
  const isRight = key === 'rightUpperArm';

  let x = isRight ? idle.ruaX : idle.luaX;
  let y = isRight ? idle.ruaY : idle.luaY;
  let z = isRight ? idle.ruaZ : idle.luaZ;

  const mag =
    typeof cmd.magnitude === 'number' && Number.isFinite(cmd.magnitude)
      ? Math.abs(cmd.magnitude)
      : cmd.motion === 'up' || cmd.motion === 'down'
        ? 0.5
        : 1.2;

  if (cmd.motion) {
    const m = cmd.motion;
    if (isRight) {
      if (m === 'forward') x = idle.ruaX + RUA_FORWARD_SIGN * mag;
      else if (m === 'backward') x = idle.ruaX - RUA_FORWARD_SIGN * mag;
      else if (m === 'up') z = idle.ruaZ + RUA_UP_SIGN * mag;
      else if (m === 'down') z = idle.ruaZ - RUA_UP_SIGN * mag;
    } else {
      if (m === 'forward') x = idle.luaX + LUA_FORWARD_SIGN * mag;
      else if (m === 'backward') x = idle.luaX - LUA_FORWARD_SIGN * mag;
      else if (m === 'up') z = idle.luaZ + mag;
      else if (m === 'down') z = idle.luaZ - mag;
    }
  } else if (cmd.axis != null && typeof cmd.value === 'number' && Number.isFinite(cmd.value)) {
    const ax = cmd.axis.toUpperCase();
    if (ax === 'X') x = cmd.value;
    else if (ax === 'Y') y = cmd.value;
    else z = cmd.value;
  } else {
    return;
  }

  const pkArm = normalizeGenerativeBoneKey(key);
  if (!pkArm) return;
  let ax = x;
  let ay = y;
  let az = z;
  if (cmd.assumeEulerDegrees) {
    ax = THREE.MathUtils.degToRad(ax);
    ay = THREE.MathUtils.degToRad(ay);
    az = THREE.MathUtils.degToRad(az);
  }
  const clArm = clampGenerativeEulerYXZ(pkArm, ax, ay, az);

  dispatch({
    bones: { [pkArm]: { x: clArm.x, y: clArm.y, z: clArm.z } },
    blend: cmd.blend ?? 0.92,
    durationMs: cmd.durationMs ?? 3200,
    replaceAll: cmd.replaceAll,
    source: 'semanticArmCommand',
    assumeEulerDegrees: false,
  });
}

export function sendArmForward(
  bone: SemanticUpperArmBone,
  amount = 1.2,
  opts?: SendSemanticOptions,
): void {
  sendSemanticUpperArmToAvatar({
    bone,
    motion: 'forward',
    magnitude: amount,
    ...opts,
  });
}

export function sendToAvatarSemanticArm(
  cmd: Parameters<typeof sendSemanticUpperArmToAvatar>[0],
): void {
  sendSemanticUpperArmToAvatar(cmd);
}

/** `avatar:generative:reset` — omit `bones` to clear all locks. */
export function resetGenerativeGestureLocks(bones?: string[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:generative:reset', {
      detail: bones?.length ? { bones } : {},
    }),
  );
}
