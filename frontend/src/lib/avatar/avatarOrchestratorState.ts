/**
 * Single source of truth for avatar speech × motion orchestration (browser-only).
 * Updated from `avatar:speak:*` — use for scheduler / guards without importing TTS internals.
 */
'use client';
import { getCogniTeachingStance } from '@/lib/avatar/cogniPersonaStance';

export type AvatarMotionSource = 'IDLE' | 'TTS' | 'VRMA';

let speaking = false;
let motionSource: AvatarMotionSource = 'IDLE';

let listenersAttached = false;

export function getAvatarOrchestratorState(): {
  speaking: boolean;
  motionSource: AvatarMotionSource;
  /** Cogni performance mode (emotion-driven). */
  teachingStance: ReturnType<typeof getCogniTeachingStance>;
} {
  return { speaking, motionSource, teachingStance: getCogniTeachingStance() };
}

/** True while TTS or manual UI considers the avatar “in utterance”. */
export function isAvatarOrchestratorSpeaking(): boolean {
  return speaking;
}

function logState(where: string): void {
  // eslint-disable-next-line no-console -- required integration diagnostics
  console.log('[STATE]', where, {
    speaking,
    motionSource,
    teachingStance: getCogniTeachingStance(),
  });
}

export function initAvatarOrchestratorListeners(): void {
  if (typeof window === 'undefined' || listenersAttached) return;
  listenersAttached = true;

  window.addEventListener('avatar:speak:start', () => {
    speaking = true;
    motionSource = 'TTS';
    logState('speak:start → TTS');
  });

  window.addEventListener('avatar:speak:end', () => {
    speaking = false;
    motionSource = 'IDLE';
    logState('speak:end → IDLE');
  });

  window.addEventListener('avatar:vrma:play', () => {
    if (speaking) return;
    motionSource = 'VRMA';
    logState('vrma:play → VRMA');
  });
}
