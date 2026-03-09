/**
 * GestureEngine — maps Verona action-line text to physical avatar movements.
 *
 * Wraps `dispatchGestureFromActionText` with:
 *   - Emotion-gesture correlation (e.g., celebrate → wave intensity 1.2)
 *   - Intensity scaling based on emotional state
 *   - Composite gesture sequences (gesture + emotion together)
 */

import { dispatchGestureFromActionText } from '@/ai/avatar/actions';

// ─── Gesture descriptor ───────────────────────────────────────────────────────

export interface GestureDescriptor {
  type: 'wave' | 'point' | 'openHand' | 'beat';
  side?: 'left' | 'right' | 'both';
  intensity?: number;   // 0.0 – 1.5
  duration?: number;    // seconds
  speed?: number;       // playback rate multiplier (default 1.0)
}

// ─── Emotion → gesture override ───────────────────────────────────────────────

const EMOTION_GESTURE_HINTS: Record<string, Partial<GestureDescriptor>> = {
  celebrate:    { type: 'wave',      intensity: 1.3, duration: 3.0 },
  encouraging:  { type: 'openHand',  intensity: 1.0, duration: 2.0 },
  thinking:     { type: 'beat',      intensity: 0.6, duration: 1.5 },
  friendly:     { type: 'openHand',  intensity: 0.8, duration: 1.5 },
  strict:       { type: 'point',     intensity: 0.9, duration: 1.5 },
  neutral:      { type: 'beat',      intensity: 0.5, duration: 1.0 },
};

// ─── Action-text → gesture type ───────────────────────────────────────────────
// Patterns extracted from Dr. Hamza's gesture vocabulary in the V200 prompt.

const ACTION_GESTURE_MAP: Array<{ pattern: RegExp; gesture: Partial<GestureDescriptor> }> = [
  { pattern: /يميل|lean|lean forward/i,      gesture: { type: 'openHand', intensity: 0.8 } },
  { pattern: /يشير|points?|index finger/i,   gesture: { type: 'point',    intensity: 0.9 } },
  { pattern: /يلوّح|wave|waves?/i,            gesture: { type: 'wave',     intensity: 1.0 } },
  { pattern: /يصفق|clap|enthusiastic/i,      gesture: { type: 'wave',     intensity: 1.3 } },
  { pattern: /يفرد|spread|open (palm|hand)/i, gesture: { type: 'openHand', intensity: 0.9 } },
  { pattern: /يضع يده|hand on chest/i,        gesture: { type: 'beat',     intensity: 0.6 } },
  { pattern: /يومئ|nod|يهز/i,                gesture: { type: 'beat',     intensity: 0.5 } },
];

// ─── GestureEngine ────────────────────────────────────────────────────────────

export class GestureEngine {
  private _queue: Array<{ descriptor: GestureDescriptor; startTime: number }> = [];
  private _isProcessing = false;

  /**
   * Resolve action text + emotion to a single GestureDescriptor (no dispatch).
   * Internal helper used by both play() and planGestures().
   */
  private _resolve(actionText: string, emotion?: string): GestureDescriptor {
    // 1. Action-text keyword match
    for (const { pattern, gesture } of ACTION_GESTURE_MAP) {
      if (pattern.test(actionText)) {
        const emotionHint = emotion ? EMOTION_GESTURE_HINTS[emotion] : undefined;
        return {
          type:      gesture.type      ?? 'openHand',
          side:      gesture.side      ?? 'right',
          intensity: Math.min(1.5, (gesture.intensity ?? 0.8) * (emotionHint?.intensity ?? 1.0)),
          duration:  gesture.duration  ?? emotionHint?.duration ?? 2.0,
        };
      }
    }
    // 2. Emotion hint fallback
    if (emotion && EMOTION_GESTURE_HINTS[emotion]) {
      const hint = EMOTION_GESTURE_HINTS[emotion];
      return {
        type:      hint.type      ?? 'openHand',
        side:      'right',
        intensity: hint.intensity ?? 0.8,
        duration:  hint.duration  ?? 2.0,
      };
    }
    // 3. Generic beat so something always fires
    return { type: 'beat', side: 'right', intensity: 0.5, duration: 1.5 };
  }

  /**
   * Parse an action-line string and dispatch the best-matching gesture event.
   * Optionally provide the current emotion tag to scale intensity.
   *
   * Priority:
   *   1. Explicit keyword match in action text (ACTION_GESTURE_MAP)
   *   2. Emotion-based hint (EMOTION_GESTURE_HINTS)
   *   3. Falls back to dispatchGestureFromActionText (from actions.ts)
   */
  play(actionText: string, emotion?: string): void {
    if (!actionText) return;

    const descriptor = this._resolve(actionText, emotion);
    // If _resolve returned the generic beat fallback AND neither text nor emotion
    // matched a specific rule, delegate to the legacy text-based dispatcher.
    const hasTextMatch   = ACTION_GESTURE_MAP.some(({ pattern }) => pattern.test(actionText));
    const hasEmotionHint = emotion !== undefined && Boolean(EMOTION_GESTURE_HINTS[emotion]);
    if (descriptor.type === 'beat' && descriptor.intensity === 0.5 && !hasTextMatch && !hasEmotionHint) {
      dispatchGestureFromActionText(actionText);
      return;
    }
    this.enqueue(descriptor);
  }

  /**
   * Add a gesture to the queue (max 3 queued at once).
   */
  enqueue(descriptor: GestureDescriptor): void {
    if (this._queue.length > 3) return;
    this._queue.push({ descriptor, startTime: Date.now() });
    this._processQueue();
  }

  private async _processQueue(): Promise<void> {
    if (this._isProcessing || this._queue.length === 0) return;
    this._isProcessing = true;
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (item) {
        this._dispatch(item.descriptor);
        await new Promise<void>(r => setTimeout(r, (item.descriptor.duration ?? 2.0) * 800));
      }
    }
    this._isProcessing = false;
  }

  /**
   * Plan multiple gestures for an entire utterance.
   * Returns an array of { descriptor, fireAtMs } for the Director to schedule.
   *
   * High-energy emotions receive a second beat gesture halfway through the speech
   * to maintain viewer engagement during long utterances (>2 000 ms estimated).
   */
  planGestures(
    actionText:       string,
    emotion:          string,
    speechDurationMs: number,
  ): Array<{ descriptor: GestureDescriptor; fireAtMs: number }> {
    const primary = this._resolve(actionText, emotion);
    const scheduled: Array<{ descriptor: GestureDescriptor; fireAtMs: number }> = [
      { descriptor: primary, fireAtMs: 0 },
    ];

    const HIGH_ENERGY = ['excited', 'celebrate', 'celebration', 'encouraging', 'happy', 'proud'];
    if (HIGH_ENERGY.includes(emotion) && speechDurationMs > 2000) {
      scheduled.push({
        descriptor: { type: 'beat', side: 'right', intensity: 0.55, duration: 1.2 },
        fireAtMs:   Math.round(speechDurationMs * 0.48),
      });
    }
    return scheduled;
  }

  /**
   * Play a gesture by explicit descriptor (bypasses text parsing).
   */
  playDescriptor(descriptor: GestureDescriptor): void {
    this._dispatch(descriptor);
  }

  /**
   * Play a celebration sequence: wave + high-energy emotion.
   */
  celebrate(): void {
    this._dispatch({ type: 'wave', side: 'right', intensity: 1.3, duration: 3.0 });
  }

  /**
   * Play an explanatory gesture: point toward virtual board.
   */
  explain(): void {
    this._dispatch({ type: 'point', side: 'right', intensity: 0.9, duration: 2.0 });
  }

  /**
   * Play an empathy/open-palm gesture: spread both hands.
   */
  empathize(): void {
    this._dispatch({ type: 'openHand', side: 'right', intensity: 0.7, duration: 1.8 });
  }

  /**
   * Warm greeting wave — right hand, smooth speed.
   */
  warmGreeting(): void {
    this.enqueue({ type: 'wave', side: 'right', intensity: 0.9, duration: 2.5, speed: 0.8 });
  }

  /**
   * Emphatic pointing gesture — faster, high intensity.
   */
  emphaticPoint(): void {
    this.enqueue({ type: 'point', side: 'right', intensity: 1.1, duration: 1.5, speed: 1.2 });
  }

  /**
   * Tilt the head to one side for the given duration.
   * Used for 'thinking' / curious behaviour contracts.
   * @param direction - 'left' or 'right'
   * @param angle     - rotation in radians (e.g. 0.13)
   * @param durationMs - how long to hold the tilt (milliseconds)
   */
  headTilt(direction: 'left' | 'right', angle: number, durationMs: number): void {
    if (typeof window === 'undefined') return;
    const yaw = direction === 'left' ? -angle : angle;
    window.dispatchEvent(
      new CustomEvent('avatar:headpose', {
        detail: { yaw, pitch: 0, duration: durationMs },
      }),
    );
  }

  /**
   * Quick double head-jerk for surprise reactions.
   * Fires two rapid opposing headpose events 220 ms apart.
   */
  headJerks(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('avatar:headpose', { detail: { yaw: 0.08, pitch: -0.05, duration: 200 } }),
    );
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('avatar:headpose', { detail: { yaw: -0.06, pitch: 0, duration: 200 } }),
      );
    }, 220);
  }

  /**
   * Wave both hands — used for the celebration behaviour contract.
   * @param durationSecs - how long the wave animation plays (seconds)
   */
  waveBothHands(durationSecs: number): void {
    this._dispatch({ type: 'wave', side: 'both', intensity: 1.3, duration: durationSecs });
  }

  private _dispatch(g: GestureDescriptor): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('avatar:gesture', {
        detail: {
          type:      g.type,
          side:      g.side     ?? 'right',
          intensity: g.intensity ?? 0.8,
          duration:  g.duration  ?? 2.0,
          speed:     g.speed    ?? 1.0,
        },
      }),
    );
  }
}

export const gestureEngine = new GestureEngine();
