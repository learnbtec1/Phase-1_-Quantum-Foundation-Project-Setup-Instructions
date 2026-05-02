/**
 * Additive realism micro-layer: camera-biased gaze, subtle facial motion, paced blinks during speech.
 * Composes **on top of** AnimationController + humanization — never replaces their events.
 */
'use client';

import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import type { Camera } from 'three';

const VEC_A = new THREE.Vector3();
const VEC_B = new THREE.Vector3();
const VEC_C = new THREE.Vector3();
const VEC_FLAT = new THREE.Vector3();

export function isRealismEngineEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  return process.env.NEXT_PUBLIC_AVATAR_REALISM_ENGINE !== 'false';
}

let neckYawAdd = 0;
let neckPitchAdd = 0;
let realismLogged = false;

const BROW_KEYS = ['BrowInnerUp', 'browInnerUp', 'Brows up', 'Frown'];
const CHEEK_KEYS = ['CheekPuff', 'cheekPuff', 'Cheek Squint Left', 'Cheek Squint Right'];
function emotionMul(em: string, speaking: number): number {
  const base = speaking > 0.5 ? 1.08 : 0.94;
  if (em === 'happy') return base * 1.1;
  if (em === 'concerned' || em === 'serious') return base * 1.06;
  return base;
}

function exprGet(em: VRM['expressionManager'], name: string): number {
  if (!em) return 0;
  try {
    const g = (em as { getValue?: (n: string) => number }).getValue;
    if (typeof g === 'function') return g.call(em, name) ?? 0;
  } catch {
    /* */
  }
  return 0;
}

function exprSet(em: NonNullable<VRM['expressionManager']>, name: string, v: number): void {
  try {
    em.setValue(name as never, v);
  } catch {
    /* */
  }
}

function clamp01(x: number): number {
  return THREE.MathUtils.clamp(x, 0, 1);
}

function lerpExpr(
  em: NonNullable<VRM['expressionManager']>,
  keys: readonly string[],
  targetAdd: number,
  rate: number,
): void {
  for (const k of keys) {
    try {
      const cur = exprGet(em, k);
      const tgt = clamp01(cur + targetAdd);
      exprSet(em, k, THREE.MathUtils.lerp(cur, tgt, Math.min(1, rate)));
      break;
    } catch {
      /* try next alias */
    }
  }
}

export type RealismTickInput = {
  camera: Camera;
  vrm: VRM;
  speaking: boolean;
  emotion: string;
  deltaSec: number;
  /** Normalized [-1,1] pointer on canvas — optional subtle eye-follow */
  pointerNdc?: { x: number; y: number } | null;
};

/**
 * Advances internal gaze + blink schedule; additive neck biases consumed by skeleton manager.
 */
export function tickRealismEngine(input: RealismTickInput): void {
  if (!isRealismEngineEnabled()) {
    neckYawAdd = THREE.MathUtils.lerp(neckYawAdd, 0, Math.min(1, input.deltaSec * 8));
    neckPitchAdd = THREE.MathUtils.lerp(neckPitchAdd, 0, Math.min(1, input.deltaSec * 8));
    return;
  }

  const head = input.vrm.humanoid?.getNormalizedBoneNode('head') ?? input.vrm.scene;

  input.camera.getWorldPosition(VEC_A);
  head.updateWorldMatrix(true, false);
  head.getWorldPosition(VEC_B);
  VEC_C.subVectors(VEC_A, VEC_B).normalize();

  const dir = VEC_C;

  /** Local-ish yaw toward camera — tiny neck bias only */
  input.vrm.scene.updateWorldMatrix(true, false);
  const fwdFlat = input.vrm.scene.getWorldDirection(VEC_A);
  fwdFlat.y = 0;
  let yawToward = 0;
  let pitchToward =
    THREE.MathUtils.clamp(
      Math.atan2(-dir.y, Math.hypot(dir.x, dir.z)),
      -0.16,
      0.22,
    ) * 0.35;

  if (fwdFlat.lengthSq() > 1e-6) {
    fwdFlat.normalize();
    VEC_FLAT.set(dir.x, 0, dir.z);
    if (VEC_FLAT.lengthSq() > 1e-6) {
      VEC_FLAT.normalize();
      yawToward = Math.atan2(
        fwdFlat.z * VEC_FLAT.x - fwdFlat.x * VEC_FLAT.z,
        fwdFlat.x * VEC_FLAT.x + fwdFlat.z * VEC_FLAT.z,
      );
      yawToward = THREE.MathUtils.clamp(yawToward, -0.22, 0.22);
    }
  }

  if (input.pointerNdc && Number.isFinite(input.pointerNdc.x)) {
    const px = THREE.MathUtils.clamp(input.pointerNdc.x * 0.6, -0.12, 0.12);
    const py = THREE.MathUtils.clamp(-input.pointerNdc.y * 0.45, -0.08, 0.08);
    yawToward = THREE.MathUtils.lerp(yawToward, yawToward + px, 0.22);
    pitchToward = THREE.MathUtils.lerp(pitchToward, pitchToward + py, 0.18);
  }

  const spd = Math.min(1, input.deltaSec * 5);
  neckYawAdd = THREE.MathUtils.lerp(neckYawAdd, yawToward * 0.11, spd);
  neckPitchAdd = THREE.MathUtils.lerp(neckPitchAdd, pitchToward * 0.09, spd);

  if (!realismLogged && typeof console !== 'undefined') {
    realismLogged = true;
    // eslint-disable-next-line no-console
    console.log('[REALISM ACTIVE]');
  }
}

export function getRealismNeckBiasesRadians(): { yaw: number; pitch: number } {
  return { yaw: neckYawAdd, pitch: neckPitchAdd };
}

export function applyRealismMicroExpressions(
  vrm: VRM,
  args: { speaking: boolean; emotion: string; deltaSec: number },
): void {
  if (!isRealismEngineEnabled()) return;
  const em = vrm.expressionManager;
  if (!em) return;

  const t =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() * 0.001
      : Date.now() * 0.001;

  const sp = args.speaking ? 1 : 0;
  const emMul = emotionMul(args.emotion, sp);
  const rt = Math.min(1, args.deltaSec * 12);

  const brow = Math.sin(t * (1.65 + emMul * 0.4)) * (0.022 * emMul + sp * 0.01);
  const cheek = Math.sin(t * (2.03 + Math.sin(t * 0.71) * 0.1)) * (0.028 * emMul + sp * 0.012);

  lerpExpr(em, BROW_KEYS, brow, rt);
  lerpExpr(em, CHEEK_KEYS, cheek, rt * 0.85);

  /** Very subtle jaw envelope — only nudge if key exists */
  const jaw = Math.sin(t * 3.1) * (0.009 + sp * 0.014) * emMul;
  lerpExpr(em, ['jawForward', 'JawFront', 'jaw_open'], jaw * 0.5, rt * 0.6);
}
