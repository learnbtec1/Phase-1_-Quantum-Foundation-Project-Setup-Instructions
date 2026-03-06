// File: frontend/src/ai/cognitive/EmotionDecay.ts
import type { PADVector } from '@/types/ai';
import { PAD_BASELINE } from './PADModel';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// يتم استدعاؤه كل إطار لتقليل PAD تدريجيًا نحو baseline
export function tickPADDecay(currentPAD: PADVector, rate = 0.02): PADVector {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const newPAD: PADVector = {
    pleasure: clamp(lerp(currentPAD.pleasure, PAD_BASELINE.pleasure, rate), -1, 1),
    arousal: clamp(lerp(currentPAD.arousal, PAD_BASELINE.arousal, rate), -1, 1),
    dominance: clamp(lerp(currentPAD.dominance, PAD_BASELINE.dominance, rate), -1, 1),
  };

  console.log('[EmotionDecay] Decay tick:', currentPAD, '→', newPAD);
  return newPAD;
}