/**
 * Intent continuity — internal motion intent driven by behavior brain + gesture cues.
 * Presence layer reads this; VRMA / UnifiedGestureEngine stay unchanged (accent + layers).
 *
 * Phase 21 — mentor check-in: after prolonged user silence, `useAgentAgent` may call
 * {@link fireMentorSilenceCheckInMotion} (Encouraging / Agreeing VRMA) alongside the WS check-in prompt.
 */
import { AVATAR_BEHAVIOR_SINGLE_CONTROLLER, PROACTIVE_QUESTION_MS } from '@/config/avatar';
import { PRIORITY } from '@/constants/gestures';
import { getBehaviorMotionState, type BehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';

export type MotionIntentKind = 'explaining' | 'listening' | 'thinking' | null;

export type MotionIntentState = {
  activeIntent: MotionIntentKind;
  /** 0–1; decays every frame, reinforced by brain mode and gesture play(). */
  intensity: number;
  /** performance.now() when activeIntent last changed. */
  startTime: number;
};

const intentState: MotionIntentState = {
  activeIntent: null,
  intensity: 0.5,
  startTime: 0,
};

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function mapBrainModeToIntent(mode: BehaviorMotionMode): MotionIntentKind {
  switch (mode) {
    case 'RESPONDING':
      return 'explaining';
    case 'LISTENING':
      return 'listening';
    case 'THINKING':
    case 'ANTICIPATING':
      return 'thinking';
    case 'IDLE':
      // Without a non-null intent, `intentMotorLayer` exits every frame (dead zone). A soft
      // "listening" presence keeps subtle head/arm micro-motion between utterances — independent of TTS vendor.
      return 'listening';
    default:
      return null;
  }
}

/** Public read — for diagnostics / HUD. */
export function getMotionIntentState(): Readonly<MotionIntentState> {
  return { ...intentState };
}

/**
 * Direct intent set (e.g. future: replace discrete play() with intent-only paths).
 * Does not enqueue VRMA.
 */
export function setMotionIntent(intent: MotionIntentKind, intensity?: number): void {
  const now = perfNow();
  if (intent !== intentState.activeIntent) {
    intentState.activeIntent = intent;
    intentState.startTime = now;
  }
  if (intent === null) {
    intentState.intensity = 0;
    intentState.startTime = 0;
    return;
  }
  if (typeof intensity === 'number') {
    intentState.intensity = Math.min(1, Math.max(0, intensity));
  } else {
    intentState.intensity = Math.min(1, intentState.intensity + 0.2);
  }
}

/** Called every frame from VRMSkeletonManager — brain is primary when mode is non-IDLE. */
export function updateIntentFromBehaviorBrain(delta: number): void {
  if (AVATAR_BEHAVIOR_SINGLE_CONTROLLER) return;
  const bs = getBehaviorMotionState();
  const mode = bs.mode;
  const targetIntent = mapBrainModeToIntent(mode);

  const dt = Math.min(Math.max(delta, 0), 0.1);
  const decayPerSec = 0.98;
  const decay = Math.pow(decayPerSec, dt * 60);

  if (targetIntent !== null) {
    if (intentState.activeIntent !== targetIntent) {
      intentState.activeIntent = targetIntent;
      intentState.startTime = perfNow();
      const idleCap = mode === 'IDLE' ? 0.24 : 1;
      intentState.intensity = Math.min(idleCap, intentState.intensity + 0.18);
    } else {
      const targetI = 0.42 + bs.attentionLevel * 0.48;
      const cappedTarget = mode === 'IDLE' ? Math.min(targetI, 0.26) : targetI;
      intentState.intensity += (cappedTarget - intentState.intensity) * Math.min(1, dt * 2.8);
      intentState.intensity = Math.min(1, intentState.intensity);
    }
    intentState.intensity *= Math.pow(0.995, dt * 60);
    const floorI = mode === 'IDLE' ? 0.06 : 0.04;
    intentState.intensity = Math.min(1, Math.max(floorI, intentState.intensity));
  } else {
    intentState.intensity *= decay;
    if (intentState.intensity < 0.055) {
      intentState.activeIntent = null;
      intentState.intensity = 0;
      intentState.startTime = 0;
    }
  }
}

function resolveIntentFromGestureKey(k: string): MotionIntentKind {
  if (
    /^(listening|listen|process|processing)$/.test(k)
    || k.includes('listen')
    || k === 'process'
    || k === 'processing'
  ) {
    return 'listening';
  }
  if (/think|thinking|tilt|curious|look-around|lookaround/.test(k)) {
    return 'thinking';
  }
  if (
    /explain|point|agree|agreeing|openhand|beat|typing|nod|greet/.test(k)
    || /^idle[1-4]$|^relax$|^idle$/.test(k)
  ) {
    return 'explaining';
  }
  return null;
}

/**
 * Secondary driver: discrete `play()` bumps the same intent channel so VRMA feels motivated,
 * without removing the gesture engine.
 */
export function bumpIntentFromGesturePlayName(normalised: string): void {
  const k = normalised.trim().toLowerCase().replace(/\s+/g, '');
  const next = resolveIntentFromGestureKey(k);
  if (next === null) return;

  const now = perfNow();
  if (intentState.activeIntent !== next) {
    intentState.activeIntent = next;
    intentState.startTime = now;
  }
  intentState.intensity = Math.min(1, intentState.intensity + 0.1);
}

/**
 * Intent-only path for `play({ motionIntentOnly: true })` — no VRMA queue when the name maps to an intent.
 * Returns whether the gesture was handled by intent alone.
 */
export function tryMotionIntentOnlyFromPlayName(normalised: string): boolean {
  const k = normalised.trim().toLowerCase().replace(/\s+/g, '');
  const next = resolveIntentFromGestureKey(k);
  if (next === null) return false;
  if (intentState.activeIntent !== next) {
    intentState.activeIntent = next;
    intentState.startTime = perfNow();
    intentState.intensity = Math.min(1, Math.max(intentState.intensity, 0.58));
  } else {
    intentState.intensity = Math.min(1, intentState.intensity + 0.16);
  }
  return true;
}

export type IntentPresenceMod = {
  /** Multiplier on head / neck delta amplitudes. */
  headYawPitchMul: number;
  /** Multiplier on shoulder roll from breath. */
  shoulderMul: number;
  /** Multiplier on simplex noise time → slower drift when < 1. */
  noiseTimeMul: number;
  /** Lower = eyes settle toward target (more “focus”). */
  eyeJitterMul: number;
};

/** Intent modulation for presence — from a snapshot (EmbodimentState) or live store. */
export function getIntentPresenceModFromSnapshot(snapshot: Readonly<MotionIntentState>): IntentPresenceMod {
  const { activeIntent, intensity } = snapshot;
  const w = Math.min(1, Math.max(0, intensity));

  let headYawPitchMul = 1;
  let shoulderMul = 1;
  let noiseTimeMul = 1;
  let eyeJitterMul = 1;

  if (activeIntent === 'explaining') {
    headYawPitchMul += 0.02 * w * 6;
    shoulderMul += 0.015 * w * 8;
  } else if (activeIntent === 'thinking') {
    noiseTimeMul *= 1 - 0.3 * w;
    eyeJitterMul *= 1 - 0.2 * w;
  } else if (activeIntent === 'listening') {
    headYawPitchMul += 0.012 * w * 5;
    shoulderMul += 0.01 * w * 6;
    noiseTimeMul *= 1 - 0.08 * w;
  }

  return { headYawPitchMul, shoulderMul, noiseTimeMul, eyeJitterMul };
}

/** Used by presenceLayer — cheap snapshot from current intent + intensity. */
export function getIntentPresenceMod(): IntentPresenceMod {
  return getIntentPresenceModFromSnapshot(intentState);
}

/** Silence threshold (ms) before proactive mentor check-in — single source: `avatar.ts`. */
export const MENTOR_CHECK_IN_SILENCE_MS = PROACTIVE_QUESTION_MS;

/**
 * Light encouraging VRMA when the mentor check-in fires (does not speak; speech is WS-driven).
 * Best-effort: uses `window.__cogniGestureEngine` when present, else dispatches `avatar:vrma:play`.
 */
export function fireMentorSilenceCheckInMotion(): void {
  if (typeof window === 'undefined' || AVATAR_BEHAVIOR_SINGLE_CONTROLLER) return;
  if (isVrmaPlaybackGloballyDisabled()) return;
  type Eng = { play: (n: string, o?: Record<string, unknown>) => Promise<void> };
  const eng = (window as Window & { __cogniGestureEngine?: Eng }).__cogniGestureEngine;
  if (eng?.play) {
    void eng.play('Agreeing', {
      priority: PRIORITY.BACKGROUND,
      intensity: 0.58,
      durationMs: 2200,
      humanTiming: false,
      behaviorBrain: false,
    });
    return;
  }
  window.dispatchEvent(
    new CustomEvent('avatar:vrma:play', {
      detail: { name: 'Agreeing', durationMs: 2200, intensity: 0.55 },
    }),
  );
}
