/**
 * Bounds smoke test for motionIntentNoise (keep formulas in sync with motionIntentNoise.ts).
 * Run: npm run test:motion-intent-noise --prefix frontend
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoise3D } from 'simplex-noise';

const nMicro = createNoise3D(() => 0.314159);

function sampleIntentMotorMicroNoise(t, seed) {
  const s = seed * 0.0873;
  const u = t * 1.12 + s;
  const v = t * 0.89 + s * 1.91;
  const w = t * 0.37 + seed * 0.02;
  const simplex = nMicro(u, v * 0.73, w);
  const sine = Math.sin(t * 17.3 + seed) * Math.sin(t * 11.9 + seed * 1.9);
  return simplex * 0.00115 + sine * 0.00042;
}

function sampleIntentMotorPhraseMicroVar(tScaled) {
  const n = nMicro(tScaled * 0.71 + 0.11, tScaled * 0.53 + 0.2, tScaled * 0.19 + 0.31);
  return n * 0.00072 + Math.sin(tScaled * 1.9) * 0.00035;
}

test('intent micro noise stays within expected magnitude', () => {
  for (let i = 0; i < 400; i++) {
    const t = i * 0.031;
    const v = sampleIntentMotorMicroNoise(t, i * 0.017);
    assert.ok(Number.isFinite(v));
    assert.ok(Math.abs(v) < 0.0025);
  }
});

test('phrase micro-var stays bounded across time', () => {
  for (let i = 0; i < 200; i++) {
    const v = sampleIntentMotorPhraseMicroVar(i * 0.12);
    assert.ok(Number.isFinite(v));
    assert.ok(Math.abs(v) < 0.002);
  }
});
