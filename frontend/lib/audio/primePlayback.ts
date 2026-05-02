/**
 * Warm HTMLAudio output inside the same synchronous user-gesture stack as Send click.
 * Keeps playback separate from the shared TTS `<audio>` to avoid races with speakWithTTS.
 */

/** Minimal valid WAV — primes MediaElement without conflicting with client TTS blob URLs. */
export const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

/**
 * Call synchronously from pointer/key handlers (e.g. Send). Uses a dedicated `<audio>`
 * instance — never the shared TTS element — so Azure/Web Speech can attach src later safely.
 */
export function primeDedicatedAudioOutput(audioEl: HTMLAudioElement | null): void {
  if (!audioEl || typeof window === 'undefined') return;
  try {
    audioEl.src = SILENT_WAV_DATA_URL;
    audioEl.volume = 0.001;
    const p = audioEl.play();
    if (p !== undefined) {
      void p.then(() => {
        try {
          audioEl.pause();
          audioEl.currentTime = 0;
          audioEl.removeAttribute('src');
          audioEl.volume = 1;
        } catch {
          /* */
        }
      }).catch((e: unknown) => {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('Playback blocked:', e);
        }
      });
    }
  } catch {
    /* */
  }
}
