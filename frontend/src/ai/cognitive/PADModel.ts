// File: frontend/src/ai/cognitive/PADModel.ts
import type { PADVector } from '@/types/ai';

/** Neutral PAD baseline — emotion decays toward this over time. */
export const PAD_BASELINE: PADVector = { pleasure: 0, arousal: 0, dominance: 0 };

/** Per-emotion PAD deltas (applied additively to current state). */
const EMOTION_DELTAS: Record<string, PADVector> = {
  happy:     { pleasure:  0.60, arousal:  0.40, dominance:  0.30 },
  excited:   { pleasure:  0.70, arousal:  0.80, dominance:  0.30 },
  relaxed:   { pleasure:  0.50, arousal: -0.50, dominance:  0.20 },
  calm:      { pleasure:  0.20, arousal: -0.30, dominance:  0.20 },
  curious:   { pleasure:  0.20, arousal:  0.40, dominance:  0.00 },
  attentive: { pleasure:  0.10, arousal:  0.30, dominance:  0.30 },
  proud:     { pleasure:  0.50, arousal:  0.30, dominance:  0.70 },
  surprised: { pleasure:  0.00, arousal:  0.70, dominance: -0.30 },
  anxious:   { pleasure: -0.30, arousal:  0.70, dominance: -0.40 },
  bored:     { pleasure: -0.20, arousal: -0.40, dominance: -0.20 },
  sleepy:    { pleasure:  0.10, arousal: -0.70, dominance: -0.30 },
  concerned: { pleasure: -0.30, arousal:  0.20, dominance:  0.00 },
  sad:       { pleasure: -0.60, arousal: -0.30, dominance: -0.40 },
  angry:     { pleasure: -0.60, arousal:  0.60, dominance:  0.50 },
  neutral:   { pleasure:  0.00, arousal:  0.00, dominance:  0.00 },
};

/**
 * Map an emotion label string to a PAD delta vector.
 * Unknown labels return the neutral baseline (no delta).
 */
export function mapEmotionToPAD(emotion: string): PADVector {
  return EMOTION_DELTAS[emotion] ?? PAD_BASELINE;
}
