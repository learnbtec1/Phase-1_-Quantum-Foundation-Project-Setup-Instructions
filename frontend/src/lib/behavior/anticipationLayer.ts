/**
 * Anticipation layer — pre-reaction micro-behavior before events fully resolve.
 * Feeds the behavior motion brain via `avatar:anticipation:*` (does not replace it).
 */

import { useBrainStore } from '@/store/useBrainStore';
import { motionDebug } from '@/lib/avatar/motionDebug';

export const ANTICIPATION_START_EVENT = 'avatar:anticipation:start' as const;
export const ANTICIPATION_END_EVENT = 'avatar:anticipation:end' as const;

export type AnticipationReason = 'speech-gap' | 'vad-silent-gap' | 'typing-pause';

export type AnticipationSignals = {
  userHesitation: boolean;
  speechGapMs: number;
  typingPause: boolean;
};

const signals: AnticipationSignals = {
  userHesitation: false,
  speechGapMs: 0,
  typingPause: false,
};

let anticipationActive = false;
/** Stable multiplier for current anticipation window (reaction delay scaling). */
let anticipationDelayMul = 1;
let lastSpeechTickAt = 0;
let speechGapDeadline = 0;
let gapTimer: number | null = null;
let vadSilentTimer: number | null = null;
let typingTimer: number | null = null;
let lastTypingAt = 0;
let layerInit = false;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function dispatchStart(reason: AnticipationReason): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(ANTICIPATION_START_EVENT, { detail: { reason, at: perfNow() } }),
  );
}

function dispatchEnd(): void {
  if (typeof window === 'undefined') return;
  const listening = useBrainStore.getState().physical.isListening;
  window.dispatchEvent(
    new CustomEvent(ANTICIPATION_END_EVENT, { detail: { at: perfNow(), listening } }),
  );
}

function clearGapTimer(): void {
  if (gapTimer !== null) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

function clearVadSilentTimer(): void {
  if (vadSilentTimer !== null) {
    clearTimeout(vadSilentTimer);
    vadSilentTimer = null;
  }
}

function clearTypingTimer(): void {
  if (typingTimer !== null) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
}

function canAnticipate(): boolean {
  const s = useBrainStore.getState();
  if (s.talking) return false;
  return true;
}

function applyAnticipationMicro(reason: AnticipationReason): void {
  if (typeof window === 'undefined') return;
  try {
    const tilt = reason === 'typing-pause' ? 0.05 : 0.07;
    window.dispatchEvent(
      new CustomEvent('avatar:headpose', {
        detail: {
          yaw: (Math.random() > 0.5 ? 1 : -1) * tilt,
          pitch: -0.03 - Math.random() * 0.04,
          durationMs: 520 + Math.floor(Math.random() * 220),
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('avatar:gaze', {
        detail: {
          yaw: (Math.random() > 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.06),
          pitch: -0.02,
          durationMs: 640 + Math.floor(Math.random() * 280),
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('avatar:micro:gesture', {
        detail: { kind: 'question_tilt', durationMs: 340 + Math.floor(Math.random() * 120) },
      }),
    );
  } catch {
    /* */
  }
}

function enterAnticipation(reason: AnticipationReason): void {
  if (anticipationActive || !canAnticipate()) return;
  const s = useBrainStore.getState();
  if (reason !== 'typing-pause' && !s.physical.isListening) return;

  anticipationActive = true;
  anticipationDelayMul = 0.78 + Math.random() * 0.09;
  signals.userHesitation = reason === 'speech-gap' || reason === 'vad-silent-gap';
  signals.speechGapMs = reason === 'typing-pause' ? 0 : Math.round(perfNow() - lastSpeechTickAt);
  signals.typingPause = reason === 'typing-pause';
  applyAnticipationMicro(reason);
  dispatchStart(reason);
  motionDebug('ANTICIPATION START', reason);
  motionDebug('ANTICIPATION ACTIVE', { reason, signals: { ...signals } });
}

export function cancelAnticipation(reason = 'unspecified'): void {
  if (!anticipationActive) return;
  anticipationActive = false;
  anticipationDelayMul = 1;
  signals.userHesitation = false;
  signals.speechGapMs = 0;
  signals.typingPause = false;
  motionDebug('ANTICIPATION CANCEL:', reason);
  dispatchEnd();
}

function scheduleSpeechGapCheck(): void {
  clearGapTimer();
  speechGapDeadline = lastSpeechTickAt;
  const delay = 200 + Math.floor(Math.random() * 301);
  gapTimer = window.setTimeout(() => {
    gapTimer = null;
    if (anticipationActive) return;
    if (!useBrainStore.getState().physical.isListening) return;
    if (lastSpeechTickAt !== speechGapDeadline) return;
    if (!canAnticipate()) return;
    enterAnticipation('speech-gap');
  }, delay);
}

function onSpeechTick(): void {
  lastSpeechTickAt = perfNow();
  if (anticipationActive) {
    cancelAnticipation('speech-tick');
  }
  scheduleSpeechGapCheck();
}

function onCogniUserSpeaking(): void {
  clearVadSilentTimer();
  if (anticipationActive) cancelAnticipation('cogni-user-speaking');
}

function onCogniUserSilent(): void {
  clearVadSilentTimer();
  vadSilentTimer = window.setTimeout(() => {
    vadSilentTimer = null;
    if (!useBrainStore.getState().physical.isListening) return;
    if (!canAnticipate()) return;
    if (anticipationActive) return;
    enterAnticipation('vad-silent-gap');
  }, 220 + Math.floor(Math.random() * 201));
}

function onSpeakStart(): void {
  clearVadSilentTimer();
  clearGapTimer();
  cancelAnticipation('avatar-speak-start');
}

function onSpeakEnd(): void {
  clearVadSilentTimer();
}

/** Call from text field onChange — schedules typing-pause micro-anticipation. */
export function recordTypingActivity(): void {
  if (typeof window === 'undefined') return;
  lastTypingAt = perfNow();
  signals.typingPause = false;
  clearTypingTimer();
  typingTimer = window.setTimeout(() => {
    typingTimer = null;
    if (!canAnticipate()) return;
    if (useBrainStore.getState().talking) return;
    if (perfNow() - lastTypingAt < 380) return;
    enterAnticipation('typing-pause');
  }, 420 + Math.floor(Math.random() * 481));
}

/** Fires after each live transcript chunk while user may still be speaking. */
export function emitUserSpeechTickForAnticipation(): void {
  if (typeof window === 'undefined') return;
  onSpeechTick();
}

/** Multiplier on reaction delay (slightly snappier when avatar is already leaning in). */
export function getAnticipationReactionDelayMul(): number {
  return anticipationDelayMul;
}

export function isAnticipationActive(): boolean {
  return anticipationActive;
}

export function getAnticipationSignals(): Readonly<AnticipationSignals> {
  return { ...signals };
}

function onBehaviorSpeech(e: Event): void {
  const p = (e as CustomEvent<{ phase?: string }>).detail?.phase;
  if (p === 'agent_start' || p === 'pre_speech') cancelAnticipation(`behavior-speech:${p}`);
}

function onListeningMic(e: Event): void {
  const active = (e as CustomEvent<{ active?: boolean }>).detail?.active;
  if (active) {
    clearGapTimer();
    cancelAnticipation('listening-mic-on');
  } else {
    cancelAnticipation('listening-mic-off');
  }
}

function onUserAttentionInput(): void {
  if (typeof window === 'undefined') return;
  try {
    useBrainStore.getState().pulseIntentAnticipation();
  } catch {
    /* */
  }
}

export function initAnticipationLayer(): void {
  if (typeof window === 'undefined' || layerInit) return;
  layerInit = true;
  window.addEventListener('cogni:user:speaking', onCogniUserSpeaking);
  window.addEventListener('cogni:user:silent', onCogniUserSilent);
  window.addEventListener('cogni:user:attention', onUserAttentionInput);
  window.addEventListener('avatar:speak:start', onSpeakStart);
  window.addEventListener('avatar:speak:end', onSpeakEnd);
  window.addEventListener('avatar:behavior:speech', onBehaviorSpeech as EventListener);
  window.addEventListener('avatar:listening', onListeningMic as EventListener);
}
