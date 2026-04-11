/**
 * Maps {@link BehaviorState} → motion *inputs* only (events / hints).
 * MUST NOT import PoseComposer, three, or VRM — no poses, no bones.
 */

import type { BehaviorState } from './BehaviorBrain';

/** Serializable motion hints for the existing avatar event pipeline. */
export type PoseMotionHints = {
  /** Dispatch procedural gesture (normalized by dispatchAvatar). */
  gesture?: { gesture: string; durationMs?: number; source?: string };
  /** Optional viseme-adjacent cue — uses same channel as existing emotion events. */
  emotion?: { emotion: string; strength: number };
  /** Suggested motor multiplier overlay (host merges with PAD; optional). */
  motorMulHint?: number;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive motion hints from behavior. Idempotent per frame if state unchanged
 * (caller should diff to avoid spamming gestures).
 */
export function behaviorStateToPoseHints(
  prev: BehaviorState | null,
  next: BehaviorState,
): PoseMotionHints {
  const hints: PoseMotionHints = {};

  const intentChanged = !prev || prev.intent !== next.intent;
  const emotionChanged = !prev || prev.emotion !== next.emotion;

  if (intentChanged) {
    if (next.intent === 'explain') {
      hints.gesture = { gesture: 'explain', durationMs: 3200, source: 'behavior' };
    } else if (next.intent === 'react') {
      hints.gesture = { gesture: 'agree', durationMs: 1800, source: 'behavior' };
    } else if (next.intent === 'listen') {
      /* Listening posture is driven by avatar:listening + skeleton; no forced gesture. */
    } else {
      hints.gesture = { gesture: 'idle', durationMs: 400, source: 'behavior' };
    }
  }

  if (emotionChanged) {
    const map: Record<string, string> = {
      happy: 'happy',
      thinking: 'neutral',
      curious: 'surprised',
      concerned: 'sad',
      empathetic: 'happy',
      neutral: 'neutral',
    };
    const em = map[next.emotion] ?? 'neutral';
    hints.emotion = {
      emotion: em,
      strength: 0.35 + 0.45 * clamp01(next.arousal),
    };
  }

  hints.motorMulHint =
    0.75 + 0.35 * clamp01(next.arousal) + 0.15 * clamp01(next.attention);

  return hints;
}
