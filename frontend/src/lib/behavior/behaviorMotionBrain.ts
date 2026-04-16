/**
 * Behavior motion brain — decides WHEN full-body / VRMA-scale motion may run (not HOW).
 * VRMAPlayer stays unchanged; this layer gates `UnifiedGestureEngine.play()` only.
 */

import { PRIORITY, type PriorityValue } from '@/constants/gestures';
import {
  ANTICIPATION_END_EVENT,
  ANTICIPATION_START_EVENT,
} from '@/lib/behavior/anticipationLayer';
import { motionDebug } from '@/lib/avatar/motionDebug';
import { motionDiagIncrBlock } from '@/lib/avatar/motionDiagnosticsStore';
import { automaticGestureInjectorsDisabled } from '@/lib/avatar/automaticGestureInjectors';

export type BehaviorMotionMode =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'RESPONDING'
  | 'ANTICIPATING';

export type BehaviorMotionState = {
  mode: BehaviorMotionMode;
  lastActionTime: number;
  attentionLevel: number;
};

const behaviorState: BehaviorMotionState = {
  mode: 'IDLE',
  lastActionTime: 0,
  attentionLevel: 0.5,
};

let listenersAttached = false;
let lastMicroFallbackAt = 0;
/** Set once when listeners attach — used for failsafe and session-relative timing. */
let behaviorBrainStartedAt = 0;
/**
 * True after at least one successful body motion completion was recorded via `recordBehaviorMotionAction`.
 * Until then, min-silence gating is skipped; a failsafe unblocks `shouldAct` if nothing completes.
 */
let hasRecordedBehaviorMotionCompletion = false;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function minSilenceMs(): number {
  return 1200 + Math.random() * 1800;
}

function isBrainDisabled(): boolean {
  if (typeof process === 'undefined') return false;
  const v = (process.env.NEXT_PUBLIC_BEHAVIOR_MOTION_BRAIN ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off';
}

/** Subtle / posture cues allowed while listening or thinking without full VRMA. */
function isSubtleGestureKey(key: string): boolean {
  return /think|listening|process|idle|curious|look|relax|nod/i.test(key);
}

function emitMicro(kind: 'nod' | 'question_tilt', durationMs: number): void {
  if (typeof window === 'undefined') return;
  const now = perfNow();
  if (now - lastMicroFallbackAt < 2800) return;
  lastMicroFallbackAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent('avatar:micro:gesture', { detail: { kind, durationMs } }),
    );
  } catch {
    /* */
  }
}

function emitGazeDrift(): void {
  if (typeof window === 'undefined') return;
  const now = perfNow();
  if (now - lastMicroFallbackAt < 2200) return;
  lastMicroFallbackAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: {
          yaw: (Math.random() > 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.08),
          pitch: -0.04 - Math.random() * 0.05,
          durationMs: 900 + Math.floor(Math.random() * 500),
        },
      }),
    );
  } catch {
    /* */
  }
}

function emitMinimalHeadNod(): void {
  if (typeof window === 'undefined') return;
  const now = perfNow();
  if (now - lastMicroFallbackAt < 2400) return;
  lastMicroFallbackAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent('avatar:headpose', {
        detail: { yaw: 0.04, pitch: 0.02, durationMs: 380 + Math.floor(Math.random() * 120) },
      }),
    );
  } catch {
    /* */
  }
}

/**
 * Minimum silence + random passivity (humans often do nothing).
 * Session baseline: `lastActionTime` is primed on brain init so diagnostics are not stuck at null delta;
 * min-silence only applies after a real completion (`hasRecordedBehaviorMotionCompletion`).
 */
export function shouldAct(): boolean {
  if (isBrainDisabled()) return true;
  if (automaticGestureInjectorsDisabled()) return true;
  const now = perfNow();
  if (
    !hasRecordedBehaviorMotionCompletion
    && behaviorBrainStartedAt > 0
    && now - behaviorBrainStartedAt > 2000
  ) {
    motionDebug('FAILSAFE shouldAct: no completion recorded within 2s of brain start');
    return true;
  }
  if (
    hasRecordedBehaviorMotionCompletion
    && behaviorState.lastActionTime > 0
    && now - behaviorState.lastActionTime < minSilenceMs()
  ) {
    return false;
  }
  if (Math.random() < 0.4) {
    return false;
  }
  return true;
}

export function recordBehaviorMotionAction(): void {
  const t = perfNow();
  behaviorState.lastActionTime = t;
  hasRecordedBehaviorMotionCompletion = true;
  behaviorState.attentionLevel = Math.min(1, behaviorState.attentionLevel + 0.04);
  motionDebug(`ACTION RECORDED at ${t.toFixed(1)}`);
}

/** Continuous procedural motion (intent motor, etc.) — refreshes idle timer only; not a discrete gesture completion. */
export function recordContinuousMotionActivity(): void {
  behaviorState.lastActionTime = perfNow();
}

export function getBehaviorMotionState(): Readonly<BehaviorMotionState> {
  return { ...behaviorState };
}

export function setBehaviorMotionMode(mode: BehaviorMotionMode): void {
  if (behaviorState.mode !== mode) {
    motionDebug('BEHAVIOR MODE:', mode);
  }
  behaviorState.mode = mode;
}

function onListening(e: Event): void {
  const d = (e as CustomEvent<{ active?: boolean }>).detail;
  if (d?.active) {
    setBehaviorMotionMode('LISTENING');
    behaviorState.attentionLevel = Math.min(1, behaviorState.attentionLevel + 0.06);
  } else if (behaviorState.mode === 'LISTENING') {
    setBehaviorMotionMode('IDLE');
  }
}

function onSpeech(e: Event): void {
  const d = (e as CustomEvent<{ phase?: string }>).detail;
  const phase = d?.phase;
  if (phase === 'user_start') {
    setBehaviorMotionMode('LISTENING');
  } else if (phase === 'user_end') {
    if (behaviorState.mode === 'LISTENING') setBehaviorMotionMode('IDLE');
  } else if (phase === 'pre_speech') {
    setBehaviorMotionMode('THINKING');
  } else if (phase === 'agent_start') {
    setBehaviorMotionMode('RESPONDING');
  } else if (phase === 'agent_end') {
    setBehaviorMotionMode('IDLE');
  }
}

/** TTS / director path when Level-6 speech bridge is off — still marks reply window. */
function onAvatarSpeakStart(): void {
  setBehaviorMotionMode('RESPONDING');
}

function onAvatarSpeakEnd(): void {
  setBehaviorMotionMode('IDLE');
}

function onAnticipationStart(): void {
  setBehaviorMotionMode('ANTICIPATING');
  behaviorState.attentionLevel = Math.min(1, behaviorState.attentionLevel + 0.1);
}

function onAnticipationEnd(e: Event): void {
  const listening = (e as CustomEvent<{ listening?: boolean }>).detail?.listening;
  if (behaviorState.mode === 'ANTICIPATING') {
    setBehaviorMotionMode(listening ? 'LISTENING' : 'IDLE');
  }
}

/** Idempotent — attach DOM listeners once (browser only). */
export function initBehaviorMotionBrainListeners(): void {
  if (typeof window === 'undefined' || listenersAttached) return;
  listenersAttached = true;
  const t0 = perfNow();
  behaviorBrainStartedAt = t0;
  /** Baseline only — real completions still call `recordBehaviorMotionAction` (sets `hasRecordedBehaviorMotionCompletion`). */
  if (behaviorState.lastActionTime <= 0) {
    behaviorState.lastActionTime = t0;
  }
  window.addEventListener('avatar:listening', onListening as EventListener);
  window.addEventListener('avatar:behavior:speech', onSpeech as EventListener);
  window.addEventListener('avatar:speak:start', onAvatarSpeakStart);
  window.addEventListener('avatar:speak:end', onAvatarSpeakEnd);
  window.addEventListener(ANTICIPATION_START_EVENT, onAnticipationStart);
  window.addEventListener(ANTICIPATION_END_EVENT, onAnticipationEnd as EventListener);
}

export type BehaviorMotionBrainGateParams = {
  normalised: string;
  priority: PriorityValue;
  humanPad: boolean;
};

/**
 * Returns whether a full `play()` pipeline may proceed. Does not touch VRMA.
 * Applies mode-based micro-fallbacks (gaze / nod) instead of heavy motion when appropriate.
 */
export async function behaviorMotionBrainGatePlay(
  params: BehaviorMotionBrainGateParams,
): Promise<boolean> {
  if (isBrainDisabled()) return true;
  if (automaticGestureInjectorsDisabled()) return true;

  const { normalised, priority, humanPad } = params;
  const key = normalised.toLowerCase().replace(/\s+/g, '');
  const now = perfNow();
  const lastDelta = behaviorState.lastActionTime > 0 ? now - behaviorState.lastActionTime : null;
  motionDebug('BEHAVIOR GATE:', {
    mode: behaviorState.mode,
    gesture: normalised,
    lastActionDelta: lastDelta !== null ? Math.round(lastDelta) : null,
  });

  if (behaviorState.mode === 'LISTENING' || behaviorState.mode === 'ANTICIPATING') {
    if (priority <= PRIORITY.NORMAL && !isSubtleGestureKey(key)) {
      if (Math.random() < 0.55) emitMinimalHeadNod();
      else emitMicro('nod', 260 + Math.floor(Math.random() * 80));
      motionDiagIncrBlock('behavior');
      motionDebug('BRAIN BLOCK:', 'listening/anticipating-micro-fallback', key);
      return false;
    }
  }

  if (behaviorState.mode === 'THINKING') {
    if (priority <= PRIORITY.NORMAL && !isSubtleGestureKey(key)) {
      if (Math.random() < 0.5) emitGazeDrift();
      else emitMicro('question_tilt', 420 + Math.floor(Math.random() * 140));
      motionDiagIncrBlock('behavior');
      motionDebug('BRAIN BLOCK:', 'thinking-micro-fallback', key);
      return false;
    }
  }

  if (!humanPad) {
    return true;
  }

  const shouldActResult = shouldAct();
  motionDebug('SHOULD ACT:', shouldActResult, 'LAST ACTION DELTA:', lastDelta !== null ? Math.round(lastDelta) : null);
  if (!shouldActResult) {
    motionDiagIncrBlock('behavior');
    motionDebug('BRAIN BLOCK:', 'shouldAct-false');
    return false;
  }

  await new Promise<void>((r) => {
    window.setTimeout(r, 200 + Math.floor(Math.random() * 601));
  });

  if (Math.random() < 0.15) {
    await new Promise<void>((r) => {
      window.setTimeout(r, 120 + Math.floor(Math.random() * 281));
    });
  }

  return true;
}
