'use client';

/**
 * Dev-only duplex / avatar speak-floor transition monitor — counters for half-duplex VAD regressions.
 * Enable `NEXT_PUBLIC_DEBUG_AVATAR` or `NEXT_PUBLIC_DEBUG_COGNI`; then `window.__cogniAvatarDiag?.()`
 */
import { cogniDuplexTryInit } from '@/lib/audio/cogniDuplexGate';
import { getMotionPipelineDiagnostics } from '@/lib/debug/motionPipelineDiag';

function isDiagEnabled(): boolean {
  return (
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_DEBUG_AVATAR === 'true' ||
      process.env.NEXT_PUBLIC_DEBUG_COGNI === 'true')
  );
}

export type CogniAvatarStateDiagSnap = {
  speakStartCount: number;
  speakEndCount: number;
  duplexPauseMicCount: number;
  /** True if speak:end count noticeably lags speak:start — possible orphaned TTS playing flag */
  orphanSuspectForMissingEnd: boolean;
  lastSpeakStartWallMs: number;
  lastSpeakEndWallMs: number;
  /** Present when NEXT_PUBLIC_DEBUG_AVATAR=true — intent motor transition counters */
  motionPipeline?: ReturnType<typeof getMotionPipelineDiagnostics>;
};

const snap: CogniAvatarStateDiagSnap = {
  speakStartCount: 0,
  speakEndCount: 0,
  duplexPauseMicCount: 0,
  orphanSuspectForMissingEnd: false,
  lastSpeakStartWallMs: 0,
  lastSpeakEndWallMs: 0,
};

let installed = false;

export function getCogniAvatarStateDiagSnap(): CogniAvatarStateDiagSnap {
  cogniDuplexTryInit();
  const copy: CogniAvatarStateDiagSnap = {
    ...snap,
    orphanSuspectForMissingEnd: snap.speakStartCount > snap.speakEndCount + 1,
  };
  if (
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_DEBUG_AVATAR === 'true' ||
      process.env.NEXT_PUBLIC_DEBUG_MOTION_PIPELINE === 'true')
  ) {
    copy.motionPipeline = getMotionPipelineDiagnostics();
  }
  return copy;
}

export function installCogniAvatarStateDiag(): void {
  if (typeof window === 'undefined') return;
  if (installed || !isDiagEnabled()) return;
  installed = true;

  window.addEventListener('avatar:speak:start', () => {
    snap.speakStartCount += 1;
    snap.lastSpeakStartWallMs = Date.now();
  });
  window.addEventListener('avatar:speak:end', () => {
    snap.speakEndCount += 1;
    snap.lastSpeakEndWallMs = Date.now();
  });

  window.addEventListener('cogni:duplex:pause_mic', () => {
    snap.duplexPauseMicCount += 1;
  });

  const win = window as Window & {
    __cogniAvatarDiag?: typeof getCogniAvatarStateDiagSnap;
  };
  win.__cogniAvatarDiag = getCogniAvatarStateDiagSnap;
}
