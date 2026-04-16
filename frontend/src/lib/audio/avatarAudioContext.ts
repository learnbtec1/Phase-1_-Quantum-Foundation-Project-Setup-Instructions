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
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[avatarAudio] AudioContext.resume() failed — playback may be silent until user gesture:', err);
      }
    }
  }
  return ctx;
}

let _userGestureUnlockInstalled = false;

/**
 * Browser autoplay policy: resume AudioContext on first user gesture.
 * Idempotent — safe to call from LipSyncManager / AvatarCanvas mount.
 */
export function installUserGestureAudioUnlock(): void {
  if (typeof window === 'undefined' || _userGestureUnlockInstalled) return;
  _userGestureUnlockInstalled = true;
  const unlock = (): void => {
    void resumeSharedAudioContext();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}
