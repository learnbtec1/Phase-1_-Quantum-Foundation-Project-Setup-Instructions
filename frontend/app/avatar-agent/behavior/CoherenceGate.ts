/**
 * Level 7.2 — Measure mind “steadiness”; when too low, gently pull signals back toward sane range.
 */

import type { GlobalMindFrame } from './GlobalMindFrame';

const LOW = 0.55;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeCoherence(frame: GlobalMindFrame): number {
  const emotionStability = 1 - Math.abs(frame.emotion.intensity - frame.arousal);
  const attentionStability = 1 - Math.abs(frame.attention - 0.5);
  return clamp01((emotionStability + attentionStability) / 2);
}

export type GatedMindFrame = GlobalMindFrame & { coherence: number };

export const COHERENCE_LOW_THRESHOLD = LOW;

/**
 * Attaches {@link GatedMindFrame#coherence}. If coherence is below threshold, slightly reduces
 * instability on the frame (attention toward center, load eased) then recomputes coherence.
 */
export function applyCoherenceGate(frame: GlobalMindFrame): GatedMindFrame {
  const coherence = computeCoherence(frame);
  let next: GlobalMindFrame = { ...frame };
  if (coherence < LOW) {
    const pull = (LOW - coherence) * 0.35;
    next = {
      ...next,
      attention: clamp01(next.attention + (0.5 - next.attention) * pull),
      cognitiveLoad: clamp01(next.cognitiveLoad * (1 - pull * 0.35)),
      arousal: clamp01(
        next.arousal + (next.emotion.intensity - next.arousal) * pull * 0.18,
      ),
    };
  }
  return { ...next, coherence: computeCoherence(next) };
}
