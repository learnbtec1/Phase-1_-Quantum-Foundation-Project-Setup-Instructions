/**
 * Phase 1 — intent-driven upper-body pose targets (vs VRMA composite), blended per bone with slerp.
 * Requires bind pose to build absolute quaternions (bind × local euler offset).
 */
import * as THREE from 'three';
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import type { BonePoseMap } from './PoseComposer';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _qSlerp = new THREE.Quaternion();

const UPPER_KEYS = [
  'spine',
  'chest',
  'neck',
  'lua',
  'rua',
  'lla',
  'rla',
] as const;

function setBindEulerOffset(
  out: BonePoseMap,
  bind: BonePoseMap,
  key: string,
  rx: number,
  ry: number,
  rz: number,
): void {
  const b = bind.get(key);
  if (!b) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(b).multiply(_qDelta);
  out.set(key, _qOut.clone());
}

/**
 * Absolute normalized-bone quaternions for upper-body “intent posture” (bind × small euler).
 * Two-arg form returns an empty map; pass `bindPose` (same ref as `blendPoseLayers` `bind`) for targets.
 */
export function generateIntentPose(emb: Readonly<EmbodimentState>, t: number): BonePoseMap;
export function generateIntentPose(emb: Readonly<EmbodimentState>, t: number, bindPose: BonePoseMap): BonePoseMap;
export function generateIntentPose(
  emb: Readonly<EmbodimentState>,
  t: number,
  bindPose?: BonePoseMap,
): BonePoseMap {
  const out: BonePoseMap = new Map();
  const intent = emb.intent.activeIntent;
  const iw = Math.min(1, Math.max(0, emb.intent.intensity));
  if (!intent || iw < 0.04 || !bindPose || bindPose.size === 0) {
    return out;
  }

  const sp = emb.speech;
  const e = sp.active ? Math.min(1, Math.max(0, sp.energy)) : 0;
  const osc = Math.sin(t * 0.88) * iw;
  const osc2 = Math.cos(t * 0.62 + 0.3) * iw;

  if (intent === 'explaining') {
    const lean = 0.055 * iw + 0.012 * osc * (0.35 + 0.65 * e);
    const armOpen = 0.09 * iw + 0.018 * osc2;
    setBindEulerOffset(out, bindPose, 'spine', lean, 0.012 * osc * iw, 0.006 * osc2 * iw);
    setBindEulerOffset(out, bindPose, 'chest', lean * 0.82, 0.01 * osc * iw, 0.005 * osc2 * iw);
    setBindEulerOffset(out, bindPose, 'neck', 0.012 * osc * iw, 0.015 * osc2 * iw, 0.008 * osc * iw);
    setBindEulerOffset(out, bindPose, 'lua', 0.02 * osc * iw, armOpen, -0.04 * iw - 0.01 * osc2);
    setBindEulerOffset(out, bindPose, 'rua', 0.02 * osc * iw, -armOpen, 0.04 * iw + 0.01 * osc2);
    setBindEulerOffset(out, bindPose, 'lla', 0.015 * osc2 * iw, 0.06 * iw, 0.04 * iw + 0.012 * osc);
    setBindEulerOffset(out, bindPose, 'rla', 0.015 * osc2 * iw, -0.06 * iw, -0.04 * iw - 0.012 * osc);
    return out;
  }

  if (intent === 'thinking') {
    const tilt = -0.07 * iw;
    const asym = 0.05 * iw * Math.sin(t * 0.31);
    setBindEulerOffset(out, bindPose, 'spine', 0.018 * iw * Math.sin(t * 0.24), 0.022 * iw * Math.cos(t * 0.19), 0.012 * asym);
    setBindEulerOffset(out, bindPose, 'chest', 0.014 * iw * Math.sin(t * 0.21), 0.016 * iw * Math.cos(t * 0.17), 0.01 * asym);
    setBindEulerOffset(out, bindPose, 'neck', tilt + 0.01 * osc * iw, 0.04 * iw * Math.sin(t * 0.27), 0.035 * iw * Math.sin(t * 0.33));
    setBindEulerOffset(out, bindPose, 'lua', asym, 0.02 * iw, -0.025 * iw);
    setBindEulerOffset(out, bindPose, 'rua', -asym * 0.85, -0.018 * iw, 0.028 * iw);
    setBindEulerOffset(out, bindPose, 'lla', 0.04 * iw * Math.sin(t * 0.41), 0.05 * iw, 0.03 * iw * Math.cos(t * 0.38));
    setBindEulerOffset(out, bindPose, 'rla', -0.04 * iw * Math.sin(t * 0.41), -0.05 * iw, -0.03 * iw * Math.cos(t * 0.38));
    return out;
  }

  if (intent === 'listening') {
    const lean = 0.028 * iw;
    setBindEulerOffset(out, bindPose, 'spine', lean, 0, 0);
    setBindEulerOffset(out, bindPose, 'chest', lean * 0.9, 0, 0);
    setBindEulerOffset(out, bindPose, 'neck', 0.012 * iw, 0.01 * iw * Math.sin(t * 0.2), 0);
    setBindEulerOffset(out, bindPose, 'lua', 0, 0.015 * iw, -0.012 * iw);
    setBindEulerOffset(out, bindPose, 'rua', 0, -0.015 * iw, 0.012 * iw);
    setBindEulerOffset(out, bindPose, 'lla', 0.02 * iw, 0.03 * iw, 0.02 * iw);
    setBindEulerOffset(out, bindPose, 'rla', 0.02 * iw, -0.03 * iw, -0.02 * iw);
    return out;
  }

  return out;
}

/** In-place: each key in `targetPose` → `basePose.set(k, slerp(base, target, weight))`. */
export function blendPoseInto(basePose: BonePoseMap, targetPose: BonePoseMap, weight: number): void {
  const u = THREE.MathUtils.clamp(weight, 0, 1);
  if (u < 1e-6) return;
  for (const key of UPPER_KEYS) {
    const qTgt = targetPose.get(key);
    if (!qTgt) continue;
    const qBase = basePose.get(key);
    if (!qBase) continue;
    _qSlerp.copy(qBase).slerp(qTgt, u);
    basePose.set(key, _qSlerp.clone());
  }
}
