/**
 * audio-pool.ts — HMR-resilient, serialising TTS audio queue.
 *
 * Module-level (not React state) state survives Next.js Fast Refresh: when a
 * component hot-reloads, the module identity is preserved so any in-progress
 * audio keeps playing without interruption and the queue is not lost.
 *
 * Guarantees:
 *   - Only one audio element plays at a time (serialised queue).
 *   - Duplicate IDs: a pending item is replaced by a newer one with the same id.
 *   - stopAllAudio() cancels the current element AND flushes the pending queue.
 *   - isAudioPlaying() is synchronous, safe to call from render paths.
 */

export interface AudioPoolItem {
  /** Stable identifier — used for deduplication. */
  id:       string;
  /** Pre-created HTMLAudioElement (caller sets src / blob URL before enqueue). */
  audio:    HTMLAudioElement;
  /** Blob URL created by caller — revoked automatically after playback. */
  blobUrl?: string;
  /** Plain-text content, used externally if a Web Speech fallback is needed. */
  text?:    string;
  /** Called once when item finishes (naturally, on error, or via stopAllAudio). */
  onEnd?:   () => void;
}

// ── Module-level singleton state (survives HMR) ───────────────────────────────

let _queue:   AudioPoolItem[] = [];
let _playing  = false;
let _current: AudioPoolItem | null = null;

/**
 * Try to play the next item in the queue.
 * No-op if something is already playing or the queue is empty.
 */
function _advance(): void {
  if (_playing || _queue.length === 0) return;

  const item   = _queue.shift()!;
  _current     = item;
  _playing     = true;

  const finish = (why: 'end' | 'error'): void => {
    if (item.blobUrl) {
      try { URL.revokeObjectURL(item.blobUrl); } catch { /* ignore */ }
    }
    _playing = false;
    _current = null;
    item.onEnd?.();
    if (why === 'error') {
      console.warn('[audio-pool] Playback error — advancing to next item');
    }
    _advance();
  };

  const { audio } = item;
  audio.onended = () => finish('end');
  audio.onerror = () => finish('error');

  audio.play().catch(() => finish('error'));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add an utterance to the playback queue.
 *
 * If an entry with the same `id` is already waiting (not yet playing), it is
 * silently replaced by the new one (e.g. retransmitted speech frame).
 * If nothing is currently playing the new item starts immediately.
 */
export function enqueueAudio(item: AudioPoolItem): void {
  // Replace any queued (not playing) entry with the same id
  _queue = _queue.filter(q => q.id !== item.id);
  _queue.push(item);
  _advance();
}

/**
 * Stop the currently playing item and clear the entire pending queue.
 * `onEnd` is called for the interrupted item and every flushed pending item.
 * Also cancels any in-flight Web Speech utterance.
 */
export function stopAllAudio(): void {
  // Stop current element
  if (_current) {
    const cur = _current;
    try { cur.audio.pause(); cur.audio.currentTime = 0; } catch { /* ignore */ }
    if (cur.blobUrl) {
      try { URL.revokeObjectURL(cur.blobUrl); } catch { /* ignore */ }
    }
    cur.onEnd?.();
  }

  // Flush remaining queue
  for (const item of _queue) {
    if (item.blobUrl) {
      try { URL.revokeObjectURL(item.blobUrl); } catch { /* ignore */ }
    }
    item.onEnd?.();
  }
  _queue   = [];
  _playing = false;
  _current = null;

  // Cancel Web Speech if the caller also uses it
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/** Returns `true` while an audio element managed by the pool is playing. */
export function isAudioPlaying(): boolean {
  return _playing;
}

/** Returns the currently playing queue item, or `null` when idle. */
export function currentPoolItem(): AudioPoolItem | null {
  return _current;
}

/** Number of items waiting to play (excludes the currently playing one). */
export function queueLength(): number {
  return _queue.length;
}
