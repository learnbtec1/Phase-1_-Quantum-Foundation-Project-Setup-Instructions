/**
 * Organic micro-variance for intent motor — Simplex-dominant blend (avoids repetitive sine-only beats).
 * Presence / joint idle use their own simplex paths; this file is intent-specific amplitudes only.
 */
import { createNoise3D } from 'simplex-noise';

const nMicro = createNoise3D(() => 0.314159);

/**
 * High-frequency residual for head / arms / neck (same call sites as legacy `microNoiseIntent`).
 */
export function sampleIntentMotorMicroNoise(t: number, seed: number): number {
  const s = seed * 0.0873;
  const u = t * 1.12 + s;
  const v = t * 0.89 + s * 1.91;
  const w = t * 0.37 + seed * 0.02;
  const simplex = nMicro(u, v * 0.73, w);
  const sine =
    Math.sin(t * 17.3 + seed) * Math.sin(t * 11.9 + seed * 1.9);
  return simplex * 0.00115 + sine * 0.00042;
}

/**
 * Slow phrase-scale micro variation (replaces single `Math.sin(tScaled * 1.9)` streak).
 */
export function sampleIntentMotorPhraseMicroVar(tScaled: number): number {
  const n = nMicro(tScaled * 0.71 + 0.11, tScaled * 0.53 + 0.2, tScaled * 0.19 + 0.31);
  return n * 0.00072 + Math.sin(tScaled * 1.9) * 0.00035;
}
