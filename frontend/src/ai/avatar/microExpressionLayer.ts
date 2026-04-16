/**
 * Subtle facial micro-layer (additive on top of agent emotion presets).
 * Driven by reply-class pulses + idle variation; does not replace VRMA or full emotions.
 */
import * as THREE from 'three';
import type { IntentDepthClass, ReplyBehaviorClass } from '@/ai/avatar/responsePersonality';
import { getDerivedAvatarMood, getMoodMotionScale } from '@/ai/avatar/responsePersonality';
import { getPersonality } from '@/ai/avatar/avatarPersonality';

/** Reply-class → baseline micro intensity (before mood scale). */
const REPLY_MICRO_INTENSITY: Record<ReplyBehaviorClass, number> = {
  thinking: 0.32,
  agreeing: 0.52,
  explaining: 0.62,
  neutral: 0.18,
};

/** First-order smoothing time constant (seconds) — ~250–350 ms feel. */
const MICRO_TAU_SEC = 0.3;
const MICRO_DECAY_PER_SEC = 0.85;

let targetHappy = 0;
let targetSurprised = 0;
let targetLookUp = 0;

let smoothHappy = 0;
let smoothSurprised = 0;
let smoothLookUp = 0;

let idleHappyTgt = 0;
let idleSurTgt = 0;
let idleLookTgt = 0;
let idleHappySm = 0;
let idleSurSm = 0;
let idleLookSm = 0;
let idleVarNextMs = 0;

let blinkWander = 1;
let blinkWanderNextMs = 0;

/**
 * Call when a human-paced reply preamble runs — brief additive face cue.
 */
/** Brief face cue when the user takes the floor (barge-in) — subtle, not theatrical. */
export function microExprBargeInPulse(): void {
  const m = getMoodMotionScale();
  targetSurprised = Math.max(targetSurprised, 0.042 * m);
  targetLookUp = Math.max(targetLookUp, 0.028 * m);
  targetHappy *= 0.62;
}

export function microExprPulseFromReplyClass(kind: ReplyBehaviorClass): void {
  const base = REPLY_MICRO_INTENSITY[kind] * getMoodMotionScale();
  switch (kind) {
    case 'agreeing':
      targetHappy = Math.max(targetHappy, 0.06 + base * 0.08);
      break;
    case 'thinking':
      targetLookUp = Math.max(targetLookUp, 0.04 + base * 0.07);
      targetSurprised = Math.max(targetSurprised, 0.035 + base * 0.05);
      break;
    case 'explaining':
      targetHappy = Math.max(targetHappy, 0.035 + base * 0.05);
      targetSurprised = Math.max(targetSurprised, 0.028 + base * 0.04);
      break;
    default:
      targetHappy = Math.max(targetHappy, 0.02 + base * 0.03);
      break;
  }
}

/** Same entry point as reply-class pulse, refined by intent depth + global personality. */
export function microExprPulseFromIntentDepth(
  kind: ReplyBehaviorClass,
  intent: IntentDepthClass | undefined,
): void {
  microExprPulseFromReplyClass(kind);
  if (!intent || intent === 'neutral') return;

  const { expressive, curiosity } = getPersonality();
  const ex = 0.75 + expressive * 0.55;
  const cur = 0.85 + curiosity * 0.35;

  switch (intent) {
    case 'deep_thinking':
      targetLookUp = Math.max(targetLookUp, 0.055 * ex);
      targetSurprised = Math.max(targetSurprised, 0.042 * ex);
      break;
    case 'light_thinking':
      targetLookUp = Math.max(targetLookUp, 0.028 * ex);
      break;
    case 'strong_agree':
      targetHappy = Math.max(targetHappy, 0.07 * ex);
      break;
    case 'soft_agree':
      targetHappy = Math.max(targetHappy, 0.035 * ex);
      targetSurprised = Math.max(targetSurprised, 0.018 * ex);
      break;
    case 'confident_explain':
      targetHappy = Math.max(targetHappy, 0.04 * ex);
      break;
    case 'uncertain_explain':
      targetSurprised = Math.max(targetSurprised, 0.05 * ex * cur);
      targetLookUp = Math.max(targetLookUp, 0.022 * ex);
      break;
    default:
      break;
  }
}

/**
 * Per-frame: decay targets, smooth toward targets, refresh idle micro-drift + blink wander.
 */
export function tickMicroExpressions(deltaSec: number, nowMs: number): {
  happyAdd: number;
  surprisedAdd: number;
  lookUpAdd: number;
  blinkIntervalScale: number;
} {
  const dt = Math.min(0.08, Math.max(0, deltaSec));
  const decay = Math.exp(-dt * MICRO_DECAY_PER_SEC);
  targetHappy *= decay;
  targetSurprised *= decay;
  targetLookUp *= decay;

  const a = 1 - Math.exp(-dt / MICRO_TAU_SEC);
  smoothHappy = THREE.MathUtils.lerp(smoothHappy, targetHappy, a);
  smoothSurprised = THREE.MathUtils.lerp(smoothSurprised, targetSurprised, a);
  smoothLookUp = THREE.MathUtils.lerp(smoothLookUp, targetLookUp, a);

  if (idleVarNextMs === 0 || nowMs >= idleVarNextMs) {
    idleVarNextMs = nowMs + 10_000 + Math.random() * 10_000;
    idleHappyTgt = (Math.random() - 0.5) * 0.034;
    idleSurTgt = (Math.random() - 0.5) * 0.026;
    idleLookTgt = (Math.random() - 0.5) * 0.02;
  }
  const idleSmooth = 1 - Math.exp(-dt / 0.38);
  idleHappySm = THREE.MathUtils.lerp(idleHappySm, idleHappyTgt, idleSmooth);
  idleSurSm = THREE.MathUtils.lerp(idleSurSm, idleSurTgt, idleSmooth);
  idleLookSm = THREE.MathUtils.lerp(idleLookSm, idleLookTgt, idleSmooth);

  if (blinkWanderNextMs === 0 || nowMs >= blinkWanderNextMs) {
    blinkWanderNextMs = nowMs + 4000 + Math.random() * 5000;
    blinkWander = 0.9 + Math.random() * 0.2;
  }
  blinkWander = THREE.MathUtils.lerp(blinkWander, 0.92 + Math.sin(nowMs * 0.0004) * 0.08, dt * 0.35);

  const calmMul = getDerivedAvatarMood() === 'engaged' ? 1.04 : 0.94;

  return {
    happyAdd: THREE.MathUtils.clamp(smoothHappy + idleHappySm * calmMul, 0, 0.22),
    surprisedAdd: THREE.MathUtils.clamp(smoothSurprised + idleSurSm * calmMul, 0, 0.18),
    lookUpAdd: THREE.MathUtils.clamp(smoothLookUp + idleLookSm * calmMul, 0, 0.12),
    blinkIntervalScale: THREE.MathUtils.clamp(blinkWander * (getDerivedAvatarMood() === 'engaged' ? 0.96 : 1.06), 0.82, 1.18),
  };
}

/** Breath sine rate multiplier from mood (engaged slightly faster, calm slower). */
export function getBreathEmotionRateMul(): number {
  return getDerivedAvatarMood() === 'engaged' ? 1.07 : 0.93;
}
