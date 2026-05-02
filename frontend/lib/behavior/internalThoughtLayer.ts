/**
 * Internal thought — silent cognition window (no gestures, minimal gaze, breath hint).
 * Feeds behavior brain mode; does not replace anticipation or motion gates.
 */

import { useBrainStore } from '@/store/useBrainStore';
import { ANTICIPATION_END_EVENT, ANTICIPATION_START_EVENT } from '@/lib/behavior/anticipationLayer';
import { setBehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import { motionDebug } from '@/lib/avatar/motionDebug';

export const INTERNAL_THOUGHT_START_EVENT = 'avatar:internal-thought:start' as const;
export const INTERNAL_THOUGHT_END_EVENT = 'avatar:internal-thought:end' as const;
/** Motor / idle rhythm bump — AvatarCanvas listens (ref-based). */
export const INTERNAL_THOUGHT_MOTOR_EVENT = 'avatar:internal-thought:motor' as const;

let internalThinking = false;
let endTimer: number | null = null;
let layerInit = false;
let lastWindowStartedAt = 0;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Per attempt, pass probability is uniform in [0.2, 0.35]. */
function rollGateChance(): number {
  return 0.2 + Math.random() * 0.15;
}

function clearEndTimer(): void {
  if (endTimer !== null) {
    clearTimeout(endTimer);
    endTimer = null;
  }
}

function endInternalThought(opts: { transitionToResponding: boolean }): void {
  if (!internalThinking) return;
  internalThinking = false;
  clearEndTimer();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INTERNAL_THOUGHT_END_EVENT, { detail: { at: perfNow() } }));
  }
  motionDebug('INTERNAL THINK END', { transitionToResponding: opts.transitionToResponding });
  if (opts.transitionToResponding) {
    setBehaviorMotionMode('RESPONDING');
  }
}

function applySilentCues(durationMs: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: {
          yaw: 0.01,
          pitch: -0.008,
          durationMs,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(INTERNAL_THOUGHT_MOTOR_EVENT, {
        detail: { mul: 1.06 + Math.random() * 0.04, durationMs },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(INTERNAL_THOUGHT_START_EVENT, { detail: { durationMs, at: perfNow() } }),
    );
  } catch {
    /* */
  }
}

function tryBeginInternalThought(_source: 'post-anticipation' | 'pre-speech'): void {
  if (typeof window === 'undefined') return;
  if (internalThinking) return;
  if (useBrainStore.getState().talking) return;
  const passProb = rollGateChance();
  if (Math.random() > passProb) return;

  const durationMs = 300 + Math.floor(Math.random() * 601);
  internalThinking = true;
  lastWindowStartedAt = perfNow();
  setBehaviorMotionMode('THINKING');
  motionDebug('INTERNAL THINK START', { source: _source, durationMs });
  applySilentCues(durationMs);

  endTimer = window.setTimeout(() => {
    endTimer = null;
    endInternalThought({ transitionToResponding: true });
  }, durationMs);
}

function onAnticipationEnd(): void {
  tryBeginInternalThought('post-anticipation');
}

function onAnticipationStart(): void {
  clearEndTimer();
  endInternalThought({ transitionToResponding: false });
}

function onPreSpeech(e: Event): void {
  const p = (e as CustomEvent<{ phase?: string }>).detail?.phase;
  if (p !== 'pre_speech') return;
  if (perfNow() - lastWindowStartedAt < 120) return;
  tryBeginInternalThought('pre-speech');
}

function onSpeakStart(): void {
  clearEndTimer();
  endInternalThought({ transitionToResponding: false });
}

function onCogniUserSpeaking(): void {
  clearEndTimer();
  endInternalThought({ transitionToResponding: false });
}

export function isInternalThinking(): boolean {
  return internalThinking;
}

export function initInternalThoughtLayer(): void {
  if (typeof window === 'undefined' || layerInit) return;
  layerInit = true;
  window.addEventListener(ANTICIPATION_END_EVENT, onAnticipationEnd as EventListener);
  window.addEventListener(ANTICIPATION_START_EVENT, onAnticipationStart as EventListener);
  window.addEventListener('avatar:behavior:speech', onPreSpeech as EventListener);
  window.addEventListener('avatar:speak:start', onSpeakStart);
  window.addEventListener('cogni:user:speaking', onCogniUserSpeaking);
}
