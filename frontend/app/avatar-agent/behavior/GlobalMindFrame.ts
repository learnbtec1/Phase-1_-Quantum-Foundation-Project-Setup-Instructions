/**
 * Level 7 — Single unified cognitive snapshot (one “mind frame”).
 */

import type { Intent } from './intentTypes';
import type { EmotionState } from './EmotionDrift';

export type GlobalMindFrame = {
  intent: Intent;
  emotion: EmotionState;

  attention: number;
  arousal: number;
  confidence: number;

  /** Wall time for debugging / analytics */
  timestamp: number;

  /** Internal pressure 0..1 (drives micro-expression density, saccade bias). */
  cognitiveLoad: number;

  /** Set by {@link applyCoherenceGate} (Level 7.2) for stability governance. */
  coherence?: number;
};
