/**
 * Maps speech emotion + intensity → gesture weight, breathing, micro-nod bias.
 * Read-only helpers — no timers, no viseme mutation.
 */
'use client';

import type { SpeechEmotionSnapshot } from './speechEmotionBridge';

/** Gesture clip layer multiplier (applied in gesturePlayer). */
export function getSpeechGestureWeightMul(s: SpeechEmotionSnapshot | null): number {
  if (!s) return 1;
  const e = s.emotion.toLowerCase();
  const i = Math.min(1, Math.max(0, s.intensity));
  let base =
    e === 'excited' || e === 'celebrate' || e === 'happy'
      ? 1 + 0.22 * i
      : e === 'calm' || e === 'neutral'
        ? 1 - 0.18 * i
        : e === 'serious' || e === 'strict'
          ? 1 - 0.08 * i
          : e === 'thinking'
            ? 1 - 0.12 * i
            : 1;
  if (typeof s.energy === 'number' && s.energy > 0.04) {
    base *= 1 + 0.2 * Math.min(1, s.energy);
  }
  return base;
}

/** Breathing layer amplitude multiplier while speaking. */
export function getSpeechBreathingAmplitudeMul(speaking: boolean, s: SpeechEmotionSnapshot | null): number {
  if (!speaking || !s) return 1;
  const i = Math.min(1, Math.max(0, s.intensity));
  const e = s.emotion.toLowerCase();
  let base = 1.12 + 0.14 * i;
  if (e === 'calm' || e === 'sad') base = 1.04 + 0.06 * i;
  if (e === 'excited') base = 1.22 + 0.12 * i;
  return Math.min(1.38, Math.max(1, base));
}

/** Nod / micro-head intensity scale during punctuation pauses. */
export function getPauseMicroHeadMul(s: SpeechEmotionSnapshot | null): number {
  if (!s) return 1;
  const e = s.emotion.toLowerCase();
  const i = Math.min(1, Math.max(0, s.intensity));
  if (e === 'thinking' || e === 'serious') return 0.75 + 0.2 * i;
  if (e === 'excited') return 1.15 + 0.15 * i;
  return 0.9 + 0.15 * i;
}

/** Blend viseme vs expression overlay (documented contract; LipSync uses 0.7/0.3 constants). */
export const VISEME_BLEND = { primary: 0.7, expression: 0.3 } as const;
