/**
 * Centralized deterministic pseudo-noise (no RNG). t = masterClock-derived seconds.
 */
'use client';

import { nowMs } from '@/lib/avatar/masterClock';

const F1 = 0.23;
const F2 = 0.37;
const F3 = 0.61;
const PHASE1 = 1.17;
const PHASE2 = 2.03;

export function getNoiseTimeSec(): number {
  return nowMs() / 1000;
}

export function deterministicNoiseUnit(tSec: number): number {
  return (Math.sin(tSec * F1) + Math.sin(tSec * F2 + PHASE1) + Math.sin(tSec * F3 + PHASE2)) / 3;
}

export function deterministicNoiseVector3(
  tSec: number,
  scale: number,
): { x: number; y: number; z: number } {
  const s = Math.min(0.004, Math.max(0, scale));
  const n0 = deterministicNoiseUnit(tSec);
  const n1 = deterministicNoiseUnit(tSec + 0.41);
  const n2 = deterministicNoiseUnit(tSec + 0.83);
  return { x: n0 * s, y: n1 * s * 0.85, z: n2 * s * 0.7 };
}

/** Phase 6: low-amplitude lean / tilt when user engagement is low (deterministic). */
export function deterministicAttentionSeekingNudge(tSec: number): {
  forwardLean: number;
  tiltZ: number;
} {
  const n = deterministicNoiseUnit(tSec * 1.07);
  const n2 = deterministicNoiseUnit(tSec * 0.71 + 1.9);
  return { forwardLean: n * 0.024, tiltZ: n2 * 0.031 };
}

export function deterministicNoiseSpineChest(
  tSec: number,
  ampRad: number,
): { spineRx: number; spineRz: number; chestRx: number; shoulderY: number } {
  const cap = Math.min(0.004, Math.max(0, ampRad));
  const n = deterministicNoiseUnit(tSec);
  const n2 = deterministicNoiseUnit(tSec + 1.1);
  return {
    spineRx: n * cap * 0.55,
    spineRz: n2 * cap * 0.35,
    chestRx: n * cap * -0.45,
    shoulderY: n2 * cap * 0.4,
  };
}
