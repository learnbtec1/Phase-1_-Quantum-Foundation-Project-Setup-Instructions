'use client';

/**
 * Client-only failsafe: unlock AudioContext on speech; log autoplay/anomalies to cogniMetrics.
 */

import {
  peekSharedAudioContext,
  resumeSharedAudioContext,
} from '@/lib/audio/avatarAudioContext';
import {
  cogniMetricsMarkTtsFailure,
  cogniMetricsPushFailsafe,
} from '@/lib/observability/cogniMetrics';
import {
  getActiveAudioElement,
  getVisemeCues,
} from '@/lib/avatar/audioTimeline';

let pauseHookCleanup: (() => void) | null = null;

function detachPauseHook(): void {
  pauseHookCleanup?.();
  pauseHookCleanup = null;
}

function attachReactivePlaybackFailsafe(): void {
  detachPauseHook();
  const au = getActiveAudioElement();
  if (!au) return;

  const onPauseEv = (): void => {
    if (!au.paused || au.ended) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void resumeSharedAudioContext();
    const c = peekSharedAudioContext();
    if (c?.state === 'suspended') void c.resume?.();

    cogniMetricsPushFailsafe(
      'audio paused unexpectedly during speech — recovering context +.play() retry',
    );
    const p = au.play();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => {
        cogniMetricsMarkTtsFailure('failsafe_play_retry_rejected_after_pause');
      });
    }
  };

  au.addEventListener('pause', onPauseEv);

  pauseHookCleanup = (): void => {
    au.removeEventListener('pause', onPauseEv);
  };
}

export function installCogniAvatarFailsafe(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __cogniFailsafeInstalled?: boolean };
  if (w.__cogniFailsafeInstalled) return;
  w.__cogniFailsafeInstalled = true;

  const resumeIfSuspended = (): void => {
    try {
      void resumeSharedAudioContext();
      const c = peekSharedAudioContext();
      if (c?.state === 'suspended') void c.resume?.();
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('avatar:speak:start', resumeIfSuspended);

  window.addEventListener('avatar:speak:start', (): void => {
    setTimeout(() => attachReactivePlaybackFailsafe(), 0);
  });

  window.addEventListener('avatar:speak:end', (): void => {
    detachPauseHook();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', (): void => {
      if (document.visibilityState !== 'visible') return;
      resumeIfSuspended();
    });
  }

  window.addEventListener('avatar:speak:start', (): void => {
    setTimeout(() => {
      const cues = getVisemeCues();
      const au = getActiveAudioElement();
      if (au && !au.paused && cues.length === 0) {
        cogniMetricsPushFailsafe(
          'after 380ms cues still empty while audio playing — bindAudioUtterance or viseme_events',
        );
      }
    }, 380);
  });

  window.addEventListener('cogni:autoplay-blocked', (): void => {
    cogniMetricsMarkTtsFailure(
      'autoplay_blocked_hint — audible path may require user gesture',
    );
  });
}
