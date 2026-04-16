/**
 * Avatar root drift vs baseline, motion silence, optional quaternion sanity (dot product).
 */

import * as THREE from 'three';

/** World-space; large intentional moves (e.g. floor nav) rebaseline below */
const DRIFT_WARN_M = 0.14;
/** If avatar root jumps farther than this vs baseline, treat as teleport and reset baseline */
const REBASELINE_JUMP_M = 0.32;
const FREEZE_SILENCE_SEC = 4;

let baseline: THREE.Vector3 | null = null;
const _tmp = new THREE.Vector3();
let lastMotionEventAt = 0;
let lastDriftM = 0;
let lastQuatAnomaly = 0;

export function resetMotionDiagnostics(): void {
  baseline = null;
  lastDriftM = 0;
  lastQuatAnomaly = 0;
  lastMotionEventAt = typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Call ~every 6th frame from R3F */
export function recordAvatarRootWorldPosition(x: number, y: number, z: number): void {
  if (baseline === null) {
    baseline = new THREE.Vector3(x, y, z);
    lastMotionEventAt = performance.now();
    return;
  }
  _tmp.set(x, y, z);
  const dist = _tmp.distanceTo(baseline);
  if (dist > REBASELINE_JUMP_M) {
    baseline.copy(_tmp);
    lastDriftM = 0;
    return;
  }
  lastDriftM = dist;
}

export function getRootDriftM(): number {
  return lastDriftM;
}

export function isRootDriftWarn(): boolean {
  return lastDriftM > DRIFT_WARN_M;
}

export function touchMotionEvent(): void {
  lastMotionEventAt = performance.now();
}

export function getMotionSilentSec(): number {
  return (performance.now() - lastMotionEventAt) / 1000;
}

export function isMotionFreezeSuspect(): boolean {
  return getMotionSilentSec() > FREEZE_SILENCE_SEC;
}

/** |dot| should be ~1 for unit quaternions */
export function recordQuaternionDot(dot: number): void {
  const err = Math.abs(1 - Math.abs(dot));
  if (err > 0.02) lastQuatAnomaly = err;
  else lastQuatAnomaly *= 0.92;
}

export function getLastQuaternionAnomaly(): number {
  return lastQuatAnomaly;
}
