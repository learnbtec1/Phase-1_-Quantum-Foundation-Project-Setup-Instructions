/**
 * Emotion → VRM expression preset weights (smooth lerp in AnimationController; never overrides viseme mouth keys).
 */
'use client';

import * as THREE from 'three';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';

const PRESETS: Record<
  BrainStatePayload['emotion'],
  Partial<Record<'happy' | 'sad' | 'angry' | 'relaxed' | 'surprised', number>>
> = {
  neutral: {},
  happy: { happy: 0.45 },
  serious: { relaxed: 0.22 },
  concerned: { sad: 0.28, relaxed: 0.12 },
};

export function expressionWeightsFromPayload(
  emotion: BrainStatePayload['emotion'],
  expressiveness: number,
): Partial<Record<'happy' | 'sad' | 'angry' | 'relaxed' | 'surprised', number>> {
  const base = PRESETS[emotion] ?? {};
  const m = THREE.MathUtils.clamp(expressiveness, 0, 1);
  const out: Partial<Record<'happy' | 'sad' | 'angry' | 'relaxed' | 'surprised', number>> = {};
  for (const k of Object.keys(base) as Array<keyof typeof base>) {
    const v = base[k];
    if (typeof v === 'number') out[k] = v * (0.55 + m * 0.55);
  }
  return out;
}
