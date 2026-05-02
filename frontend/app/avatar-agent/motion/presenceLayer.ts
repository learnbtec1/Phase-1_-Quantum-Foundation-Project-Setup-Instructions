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
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { sampleJointIdleNoise } from '@/app/avatar-agent/motion/jointIdleNoise';

const noise3 = createNoise3D(() => Math.random());

/** Presence pulse / leak debug (throttled) — enable with `NEXT_PUBLIC_MOTION_PATH_LEAK_DEBUG=true`. */
const MOTION_PATH_LEAK_DEBUG =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_MOTION_PATH_LEAK_DEBUG === 'true';
let motionPathLeakDbgFrame = 0;
let motionPathLeakDbgLastLogMs = 0;

/** Temporary ×6 on sway/breath simplex coeffs when same flag ON (+wrist/hip idle noise via jointIdleNoise). */
const PRESENCE_DIAG_MUL =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_MOTION_PATH_LEAK_DEBUG === 'true'
    ? 6
    : 1;

/** Digital Human: slightly stronger baseline chest/spine breath (independent of speech cadence). */
const ENHANCED_BASELINE_BREATH =
  typeof process === 'undefined' ||
  (process.env.NEXT_PUBLIC_AVATAR_ENHANCED_BREATHING !== 'false' &&
    process.env.NEXT_PUBLIC_AVATAR_ENHANCED_BREATHING !== '0');
const BREATH_AMP_BOOST = ENHANCED_BASELINE_BREATH ? 1.22 : 1;

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

let presenceEyeNextShiftAt = 0;
let presenceEyeYaw = 0;
let presenceEyePitch = 0;
let presenceEyeYawTgt = 0;
let presenceEyePitchTgt = 0;
/** Low-pass shoulder follow of head/eye sway — avoids instantaneous lockstep with neck. */
let shoulderInertiaYaw = 0;
let shoulderInertiaPitch = 0;

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
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
  if (MOTION_PATH_LEAK_DEBUG && typeof performance !== 'undefined') {
    motionPathLeakDbgFrame += 1;
    const now = performance.now();
    if (now - motionPathLeakDbgLastLogMs >= 500) {
      motionPathLeakDbgLastLogMs = now;
      // eslint-disable-next-line no-console -- intentional motion-path diagnostic
      console.log('[presenceLayer] pulse', {
        frame: motionPathLeakDbgFrame,
        motionSource: opts.motionSource,
        isTalking: opts.isTalking,
        gestureLayerW: +opts.gestureLayerW.toFixed(4),
      });
    }
  }

  if (!isBodyDrivenByVRMA(opts)) return;
  /**
   * Strong procedural gestures (wave/point/…) still suppress idle head sway to avoid fighting the pose.
   * Torso breath (spine/chest/shoulders) always runs — without it + frozen VRMA the body reads “dead”.
   * When VRMA is globally frozen, soften the head gate so thinking/listening keep micro life.
   */
  const headPresenceGate = isVrmaPlaybackGloballyDisabled() ? 0.72 : 0.42;
  const suppressIdleHeadPresence = opts.gestureLayerW > headPresenceGate;

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
    : opts.behaviorMode === 'THINKING' ? 1.07
    : opts.behaviorMode === 'RESPONDING' ? 1.02
    : opts.behaviorMode === 'ANTICIPATING' ? 1.01
    : 1;

  const n1 = noise3(t * 0.11, 1.7, 0.4);
  const n2 = noise3(0.3, t * 0.12, 0.55);
  const n3 = noise3(t * 0.09, 2.1, 0.8);

  const headYaw =
    (Math.sin(tBase * 0.31) * 0.010 + n1 * 0.012) *
    talkMul *
    intent.headYawPitchMul *
    modePresMul *
    PRESENCE_DIAG_MUL;
  const headPitch =
    (Math.sin(tBase * 0.23 + 0.7) * 0.008 + n2 * 0.010) *
    talkMul *
    intent.headYawPitchMul *
    modePresMul *
    PRESENCE_DIAG_MUL;
  const headRoll = n3 * 0.006 * talkMul * intent.headYawPitchMul * modePresMul * PRESENCE_DIAG_MUL;

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

  const neckWeightSway =
    (Math.sin(tBase * 0.18 + 0.4) * 0.0018 + n2 * 0.0014) *
    talkMul *
    intent.headYawPitchMul *
    modePresMul *
    PRESENCE_DIAG_MUL;

  const inertiaK = 1 - Math.exp(-dt * 5.1);
  shoulderInertiaYaw = THREE.MathUtils.lerp(
    shoulderInertiaYaw,
    headYaw * 0.34 + presenceEyeYaw * 0.2 + neckWeightSway * 0.45,
    inertiaK,
  );
  shoulderInertiaPitch = THREE.MathUtils.lerp(
    shoulderInertiaPitch,
    headPitch * 0.28 + presenceEyePitch * 0.18,
    inertiaK * 0.88,
  );

  if (!suppressIdleHeadPresence) {
    mulBoneDeltaEuler(
      finalPose,
      'neck',
      headYaw * 0.52 + presenceEyeYaw * 0.35,
      headPitch * 0.42 + presenceEyePitch * 0.32,
      headRoll * 0.38 + neckWeightSway * 0.5,
    );
    mulBoneDeltaEuler(
      finalPose,
      'head',
      headYaw * 0.88 + presenceEyeYaw * 0.55,
      headPitch * 0.92 + presenceEyePitch * 0.48,
      headRoll * 0.62 + neckWeightSway * 0.62,
    );
  }

  const breathPhase = t * (1.05 + 0.07 * Math.sin(t * 0.19));
  const breathSpine =
    (Math.sin(breathPhase) + n1 * 0.35) *
    0.013 *
    BREATH_AMP_BOOST *
    talkMul *
    intent.shoulderMul *
    modePresMul *
    PRESENCE_DIAG_MUL;
  const breathChest =
    (Math.sin(breathPhase - 0.13) + n2 * 0.32) *
    0.012 *
    BREATH_AMP_BOOST *
    talkMul *
    intent.shoulderMul *
    modePresMul *
    PRESENCE_DIAG_MUL;
  const breathScale = suppressIdleHeadPresence
    ? (isVrmaPlaybackGloballyDisabled() ? 0.82 : 0.62)
    : 1;
  const weightShiftY =
    (Math.sin(tBase * 0.21) * 0.0031 + n1 * 0.0026) *
    talkMul *
    intent.headYawPitchMul *
    modePresMul *
    breathScale *
    PRESENCE_DIAG_MUL;
  const weightShiftZ =
    (Math.sin(tBase * 0.154 + 1.1) * 0.0024 + n3 * 0.002) *
    talkMul *
    intent.shoulderMul *
    modePresMul *
    breathScale *
    PRESENCE_DIAG_MUL;
  mulBoneDeltaEuler(
    finalPose,
    'spine',
    breathSpine * 0.48 * breathScale,
    weightShiftY,
    breathSpine * 0.2 * breathScale + weightShiftZ,
  );
  mulBoneDeltaEuler(
    finalPose,
    'chest',
    breathChest * 0.42 * breathScale,
    weightShiftY * 0.72,
    breathChest * 0.16 * breathScale + weightShiftZ * 0.65,
  );
  const sh = breathSpine * 0.5 * intent.shoulderMul * modePresMul * breathScale;
  const shYawL = shoulderInertiaYaw * intent.shoulderMul * modePresMul * breathScale;
  const shPtL = shoulderInertiaPitch * intent.shoulderMul * modePresMul * breathScale;
  mulBoneDeltaEuler(finalPose, 'leftShoulder', shPtL * 0.2, shYawL * 0.16, sh);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', shPtL * 0.18, -shYawL * 0.14, -sh);

  /** Wrists + hips: slow simplex (different scales than spine) with natural lag vs torso. */
  const wristLag = 0.085;
  const hipLag = 0.055;
  const wRh = sampleJointIdleNoise(tBase - wristLag, 'rh');
  const wLh = sampleJointIdleNoise(tBase - wristLag * 1.07, 'lh');
  const wHip = sampleJointIdleNoise(tBase - hipLag, 'hips');
  const limbMul = 0.92 * modePresMul * breathScale * intent.shoulderMul;
  mulBoneDeltaEuler(finalPose, 'rh', wRh.rx * limbMul, wRh.ry * limbMul, wRh.rz * limbMul);
  mulBoneDeltaEuler(finalPose, 'lh', wLh.rx * limbMul, wLh.ry * limbMul, wLh.rz * limbMul);
  const hipMul = 1.05 * modePresMul * breathScale;
  mulBoneDeltaEuler(finalPose, 'hips', wHip.rx * hipMul, wHip.ry * hipMul * 0.65, wHip.rz * hipMul);
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
