/**
 * Idle presence layer — when behavior + embodiment are IDLE and motion diagnostics show long stillness,
 * adds smoothed head / gaze / shoulder offsets and refreshes `recordActivity()` so "NO MOTION FOR TOO LONG" does not fire.
 * Runs after microHumanLayer; does not replace intent motor or gesture authority.
 */
'use client';

import * as THREE from 'three';
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import { getBehaviorMotionState } from '@/lib/behavior/behaviorMotionBrain';
import { recordActivity } from '@/lib/avatar/motionDiagnostics';
import { isBodyDrivenByVRMA } from '@/lib/avatar/vrmaBodyDrive';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { applyIntentGestureClipToPose, stepIntentGesturePlayer } from './gesturePlayer';
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

/** Short gate — long values made the avatar look frozen after any micro-action. */
const STILL_MS_BEFORE_IDLE_LIFE = 450;

/** Random spacing between idle pulses (ms). */
const PULSE_MIN_MS = 2000;
const PULSE_MAX_MS = 5000;

/** Effective amplitude band (rad), blended — production idle presence 0.05–0.12. */
const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 0.12;

let nextPulseAt = 0;
let tgt = { headRx: 0, headRy: 0, headRz: 0, neckRx: 0, neckRy: 0, sh: 0 };
let cur = { ...tgt };
let pulseIndex = 0;
let lastRecordAt = 0;

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function pickNewTargets(): void {
  const a = WEIGHT_MIN + Math.random() * (WEIGHT_MAX - WEIGHT_MIN);
  tgt = {
    headRx: (Math.random() - 0.5) * 0.055 * a,
    headRy: (Math.random() - 0.5) * 0.07 * a,
    headRz: (Math.random() - 0.5) * 0.035 * a,
    neckRx: (Math.random() - 0.5) * 0.04 * a,
    neckRy: (Math.random() - 0.5) * 0.045 * a,
    sh: (Math.random() - 0.5) * 0.05 * a,
  };
}

export type IdleMicroOpts = {
  motionSource: 'VRMA' | 'GESTURE' | 'IDLE';
  gestureLayerW: number;
};

/**
 * Additive idle life + optional light gesture-clip nudge (listening, low weight).
 */
export function applyIdleMicroPresence(
  finalPose: BonePoseMap,
  emb: EmbodimentState,
  delta: number,
  opts: IdleMicroOpts,
): void {
  const dt = Math.min(Math.max(delta, 0), 0.08);
  if (!isBodyDrivenByVRMA(opts)) return;
  /**
   * Stabilization: no gesture-weight disable — keep continuous idle life,
   * but scale down by the current intent timing weight so idle stays quiet
   * while a gesture is active.
   */
  // Rebalanced: gesture still wins when active (0.8 reduction) but idle micro-motion
  // is never fully killed — subtle breathing/sway always visible under gestures.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _intentW = Math.min(1, Math.max(0, (globalThis as any).__intentAttenuation ?? 0));
  const gestureAtten = 1 - _intentW * 0.8;

  const brain = getBehaviorMotionState();
  const now = masterClockNowMs();
  if (brain.mode !== 'IDLE' || emb.behaviorMode !== 'IDLE') {
    const k = 1 - Math.exp(-dt * 5);
    cur.headRx = THREE.MathUtils.lerp(cur.headRx, 0, k);
    cur.headRy = THREE.MathUtils.lerp(cur.headRy, 0, k);
    cur.headRz = THREE.MathUtils.lerp(cur.headRz, 0, k);
    cur.neckRx = THREE.MathUtils.lerp(cur.neckRx, 0, k);
    cur.neckRy = THREE.MathUtils.lerp(cur.neckRy, 0, k);
    cur.sh = THREE.MathUtils.lerp(cur.sh, 0, k);
    nextPulseAt = 0;
    return;
  }

  if (brain.lastActionTime > 0 && now - brain.lastActionTime < STILL_MS_BEFORE_IDLE_LIFE) {
    const k = 1 - Math.exp(-dt * 4);
    const u = (now - brain.lastActionTime) / STILL_MS_BEFORE_IDLE_LIFE;
    const damp = 0.35 + 0.65 * u;
    cur.headRx = THREE.MathUtils.lerp(cur.headRx, 0, k * damp);
    cur.headRy = THREE.MathUtils.lerp(cur.headRy, 0, k * damp);
    cur.headRz = THREE.MathUtils.lerp(cur.headRz, 0, k * damp);
    cur.neckRx = THREE.MathUtils.lerp(cur.neckRx, 0, k * damp);
    cur.neckRy = THREE.MathUtils.lerp(cur.neckRy, 0, k * damp);
    cur.sh = THREE.MathUtils.lerp(cur.sh, 0, k * damp);
    if (u < 0.5) return;
  }

  if (nextPulseAt === 0) {
    nextPulseAt = now;
  }
  let pulseTick = false;
  if (now >= nextPulseAt) {
    pickNewTargets();
    nextPulseAt = now + PULSE_MIN_MS + Math.random() * (PULSE_MAX_MS - PULSE_MIN_MS);
    pulseIndex += 1;
    pulseTick = true;
    if (now - lastRecordAt > 1200) {
      recordActivity();
      lastRecordAt = now;
    }
  }

  stepIntentGesturePlayer({
    dt,
    intent: 'listening',
    intentW: 0.11,
    motorScale: 0.1,
    emphasis: 0,
    allowStartNewClip: pulseTick && pulseIndex % 3 === 0,
  });

  const k = Math.min(0.18, 1 - Math.exp(-dt * 4.8));
  cur.headRx = THREE.MathUtils.lerp(cur.headRx, tgt.headRx, k);
  cur.headRy = THREE.MathUtils.lerp(cur.headRy, tgt.headRy, k);
  cur.headRz = THREE.MathUtils.lerp(cur.headRz, tgt.headRz, k);
  cur.neckRx = THREE.MathUtils.lerp(cur.neckRx, tgt.neckRx, k);
  cur.neckRy = THREE.MathUtils.lerp(cur.neckRy, tgt.neckRy, k);
  cur.sh = THREE.MathUtils.lerp(cur.sh, tgt.sh, k);

  mulBoneDeltaEuler(finalPose, 'neck', cur.neckRx * gestureAtten, cur.neckRy * gestureAtten, 0);
  mulBoneDeltaEuler(
    finalPose,
    'head',
    cur.headRx * gestureAtten,
    cur.headRy * gestureAtten,
    cur.headRz * gestureAtten,
  );
  mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, cur.sh * 0.55 * gestureAtten);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -cur.sh * 0.52 * gestureAtten);

  applyIntentGestureClipToPose(finalPose, 0.1 * gestureAtten);
}
