/**
 * Continuous presence — subtle life on the final pose (no play(), no authority, no events).
 * Runs while the composed pose is VRMA-driven (`motionSource === 'VRMA'`), aligned with the skeleton blend stack.
 * Motion intent (behavior brain + gesture bumps) modulates amplitudes here — primary “aliveness”.
 */
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { isBodyDrivenByVRMA } from '@/lib/avatar/vrmaBodyDrive';
import {
  getIntentPresenceMod,
  getIntentPresenceModFromSnapshot,
} from '@/lib/avatar/motionIntentContinuity';
import type { MotionIntentState } from '@/lib/avatar/motionIntentContinuity';
import type { BehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import type { BonePoseMap } from './PoseComposer';
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';

const noise3 = createNoise3D(() => Math.random());

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

let presenceEyeNextShiftAt = 0;
let presenceEyeYaw = 0;
let presenceEyePitch = 0;
let presenceEyeYawTgt = 0;
let presenceEyePitchTgt = 0;

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

export type PresenceApplyOpts = {
  motionSource: 'VRMA' | 'GESTURE' | 'IDLE';
  elapsedSec: number;
  delta: number;
  gestureLayerW: number;
  isTalking: boolean;
  /** When set, intent multipliers use this snapshot (EmbodimentState) instead of the global intent store. */
  intentSnapshot?: Readonly<MotionIntentState>;
  /** Behavior brain mode — light coupling on presence amplitudes when provided. */
  behaviorMode?: BehaviorMotionMode;
  /** 0–1 speech energy from embodiment — subtle coupling while talking when provided. */
  speechEnergy?: number;
};

/**
 * In-place quaternion deltas on blended pose (head/neck/spine/chest/shoulders).
 * Gated: VRMA pose layer + light procedural gesture only (not motionAuthority).
 */
export function applyContinuousPresenceToFinalPose(
  finalPose: BonePoseMap,
  opts: PresenceApplyOpts,
): void {
  if (!isBodyDrivenByVRMA(opts)) return;
  if (opts.gestureLayerW > 0.42) return;

  const intent =
    opts.intentSnapshot !== undefined
      ? getIntentPresenceModFromSnapshot(opts.intentSnapshot)
      : getIntentPresenceMod();
  const tBase = opts.elapsedSec;
  const t = tBase * intent.noiseTimeMul;
  const dt = Math.min(Math.max(opts.delta, 0), 0.08);
  let talkMul = opts.isTalking ? 0.38 : 1;
  if (opts.speechEnergy !== undefined && opts.isTalking) {
    const se = Math.min(1, Math.max(0, opts.speechEnergy));
    talkMul *= 0.9 + 0.1 * se;
  }
  const modePresMul =
    opts.behaviorMode === 'LISTENING' ? 0.97
    : opts.behaviorMode === 'THINKING' ? 0.96
    : opts.behaviorMode === 'RESPONDING' ? 1.02
    : opts.behaviorMode === 'ANTICIPATING' ? 1.01
    : 1;

  const n1 = noise3(t * 0.11, 1.7, 0.4);
  const n2 = noise3(0.3, t * 0.12, 0.55);
  const n3 = noise3(t * 0.09, 2.1, 0.8);

  const headYaw =
    (Math.sin(tBase * 0.31) * 0.010 + n1 * 0.012) * talkMul * intent.headYawPitchMul * modePresMul;
  const headPitch =
    (Math.sin(tBase * 0.23 + 0.7) * 0.008 + n2 * 0.010) * talkMul * intent.headYawPitchMul * modePresMul;
  const headRoll = n3 * 0.006 * talkMul * intent.headYawPitchMul * modePresMul;

  const now = masterClockNowMs();
  if (presenceEyeNextShiftAt === 0) {
    presenceEyeNextShiftAt = now + 4000 + Math.random() * 4000;
  }
  if (now >= presenceEyeNextShiftAt) {
    presenceEyeNextShiftAt = now + 4000 + Math.random() * 4000;
    const eyeSpan = intent.eyeJitterMul;
    presenceEyeYawTgt = (Math.random() - 0.5) * 0.028 * eyeSpan;
    presenceEyePitchTgt = (Math.random() - 0.5) * 0.018 * eyeSpan;
  }
  const eyeK = 1 - Math.exp(-dt * 1.15);
  presenceEyeYaw = THREE.MathUtils.lerp(presenceEyeYaw, presenceEyeYawTgt, eyeK);
  presenceEyePitch = THREE.MathUtils.lerp(presenceEyePitch, presenceEyePitchTgt, eyeK);

  mulBoneDeltaEuler(finalPose, 'neck', headYaw * 0.52 + presenceEyeYaw * 0.35, headPitch * 0.42 + presenceEyePitch * 0.32, headRoll * 0.38);
  mulBoneDeltaEuler(finalPose, 'head', headYaw * 0.88 + presenceEyeYaw * 0.55, headPitch * 0.92 + presenceEyePitch * 0.48, headRoll * 0.62);

  const breathPhase = t * (1.05 + 0.07 * Math.sin(t * 0.19));
  const breathSpine =
    (Math.sin(breathPhase) + n1 * 0.35) * 0.013 * talkMul * intent.shoulderMul * modePresMul;
  const breathChest =
    (Math.sin(breathPhase - 0.13) + n2 * 0.32) * 0.012 * talkMul * intent.shoulderMul * modePresMul;
  mulBoneDeltaEuler(finalPose, 'spine', breathSpine * 0.48, 0, breathSpine * 0.2);
  mulBoneDeltaEuler(finalPose, 'chest', breathChest * 0.42, 0, breathChest * 0.16);
  const sh = breathSpine * 0.5 * intent.shoulderMul * modePresMul;
  mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, sh);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -sh);
}

/** Core presence options — embodiment-derived fields are injected by {@link applyPresenceFromEmbodiment}. */
export type PresenceApplyOptsCore = Omit<
  PresenceApplyOpts,
  'intentSnapshot' | 'behaviorMode' | 'speechEnergy'
>;

/**
 * Presence reads the same embodiment snapshot as intent motor — no change to presence internals beyond opts.
 */
export function applyPresenceFromEmbodiment(
  finalPose: BonePoseMap,
  emb: Readonly<EmbodimentState>,
  opts: PresenceApplyOptsCore,
): void {
  applyContinuousPresenceToFinalPose(finalPose, {
    ...opts,
    intentSnapshot: emb.intent,
    behaviorMode: emb.behaviorMode,
    speechEnergy: emb.speech.energy,
  });
}
