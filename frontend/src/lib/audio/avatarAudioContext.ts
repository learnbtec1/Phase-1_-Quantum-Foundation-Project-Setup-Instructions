/**
 * Single shared AudioContext for avatar TTS + analyser graph.
 * Do not construct additional AudioContexts for playback — reuse this instance.
 */
'use client';

let _shared: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_shared) {
    try {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) _shared = new Ctor();
    } catch {
      return null;
    }
  }
  return _shared;
}

/** Must be awaited before starting playback so the graph is not suspended (autoplay policy). */
export async function resumeSharedAudioContext(): Promise<AudioContext | null> {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  const wasSuspended = ctx.state === 'suspended';
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[avatarAudio] AudioContext.resume() failed — playback may be silent until user gesture:', err);
      }
    }
  }
  const stateAfterResume = ctx.state;
  if (
    wasSuspended &&
    stateAfterResume === 'running' &&
    typeof process !== 'undefined' &&
    process.env.NODE_ENV === 'development'
  ) {
    // eslint-disable-next-line no-console
    console.log('[Audio] unlocked — AudioContext running (browser autoplay policy)');
  }
  return ctx;
}

let _userGestureUnlockInstalled = false;

/**
 * Browser autoplay policy: resume AudioContext on first user gesture.
 * Covers tap (pointer/touch), full click activation (mobile Safari quirks), and keyboard.
 * Idempotent — safe to call from AvatarAgentClient layout and LipSyncManager mount.
 */
export function installUserGestureAudioUnlock(): void {
  if (typeof window === 'undefined' || _userGestureUnlockInstalled) return;
  _userGestureUnlockInstalled = true;
  const unlock = (): void => {
    void resumeSharedAudioContext();
  };
  /** `capture` so unlock still runs when inner handlers call stopPropagation on bubble phase. */
  const cap = true;
  window.addEventListener('pointerdown', unlock, { passive: true, capture: cap });
  window.addEventListener('touchstart', unlock, { passive: true, capture: cap });
  window.addEventListener('click', unlock, { capture: cap });
  window.addEventListener('keydown', unlock, { capture: cap });
}
