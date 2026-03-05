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
  side?: 'left' | 'right';
  intensity?: number;   // 0.0 – 1.5
  duration?: number;    // seconds
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

// ─── Phase 9: Motor memory — per-gesture cooldown windows ───────────────────────

const GESTURE_COOLDOWN_MS: Record<string, number> = {
  wave:     15_000,
  point:     8_000,
  openHand:  6_000,
  beat:      5_000,
};

// ─── GestureEngine ────────────────────────────────────────────────────────────

export class GestureEngine {
  /** Phase 9: Motor memory — tracks last-played time per gesture type. */
  private _recentGestures = new Map<string, number>();

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

    // 1. Try to match action text pattern
    for (const { pattern, gesture } of ACTION_GESTURE_MAP) {
      if (pattern.test(actionText)) {
        const emotionHint = emotion ? EMOTION_GESTURE_HINTS[emotion] : undefined;
        const merged: GestureDescriptor = {
          type:      gesture.type      ?? 'openHand',
          side:      gesture.side      ?? 'right',
          intensity: Math.min(1.5, (gesture.intensity ?? 0.8) * (emotionHint?.intensity ?? 1.0)),
          duration:  gesture.duration  ?? emotionHint?.duration ?? 2.0,
        };
        this._dispatch(merged, 200);   // Phase 3: 200ms pre-roll
        return;
      }
    }

    // 2. Emotion-driven fallback
    if (emotion && EMOTION_GESTURE_HINTS[emotion]) {
      const hint = EMOTION_GESTURE_HINTS[emotion];
      this._dispatch({
        type:      hint.type      ?? 'openHand',
        side:      'right',
        intensity: hint.intensity ?? 0.8,
        duration:  hint.duration  ?? 2.0,
      }, 200);   // Phase 3: 200ms pre-roll
      return;
    }

    // 3. Default: let actions.ts decide from keyword matching
    dispatchGestureFromActionText(actionText);
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

  private _dispatch(g: GestureDescriptor, prerollMs = 0): void {
    if (typeof window === 'undefined') return;

    // Phase 9: Motor memory — enforce cooldown, fade intensity on repeated gestures
    const cooldown    = GESTURE_COOLDOWN_MS[g.type] ?? 5_000;
    const lastPlayed  = this._recentGestures.get(g.type) ?? 0;
    const elapsed     = Date.now() - lastPlayed;
    if (elapsed < cooldown * 0.3) return;   // hard block — too soon
    const intensityScale = elapsed < cooldown
      ? (elapsed / cooldown) * 0.6 + 0.4   // 40%→100% during cooldown window
      : 1.0;
    this._recentGestures.set(g.type, Date.now());

    window.dispatchEvent(
      new CustomEvent('avatar:gesture', {
        detail: {
          type:      g.type,
          side:      g.side      ?? 'right',
          intensity: Math.min(1.5, (g.intensity ?? 0.8) * intensityScale),
          duration:  g.duration  ?? 2.0,
          variance:  Math.random(),
          preroll:   prerollMs,
        },
      }),
    );
  }
}

export const gestureEngine = new GestureEngine();
