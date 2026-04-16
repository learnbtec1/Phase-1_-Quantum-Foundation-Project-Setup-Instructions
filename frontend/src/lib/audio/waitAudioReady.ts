/** HAVE_CURRENT_DATA — enough loaded to treat currentTime as meaningful for sync */
const HAVE_ENOUGH_DATA = 2;

/**
 * Resolve when `audio.readyState >= HAVE_ENOUGH_DATA` or timeout (safety).
 * Use after setting src / before relying on lip-sync playhead.
 */
export function waitAudioReady(audio: HTMLAudioElement, timeoutMs = 2800): Promise<void> {
  if (audio.readyState >= HAVE_ENOUGH_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      audio.removeEventListener('canplay', done);
      audio.removeEventListener('loadeddata', done);
      clearTimeout(tid);
      resolve();
    };
    audio.addEventListener('canplay', done, { once: true });
    audio.addEventListener('loadeddata', done, { once: true });
    const tid = window.setTimeout(done, timeoutMs);
  });
}
