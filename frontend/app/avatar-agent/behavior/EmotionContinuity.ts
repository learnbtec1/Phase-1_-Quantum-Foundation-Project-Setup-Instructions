/**
 * Level 7.3 — Emotional Continuity Core
 * Display affect is temporal (spring + damping + short trace), not raw frame snapshots.
 */

import type { EmotionState } from './EmotionDrift';

const TRACE_MAX = 4;

export type EmotionContinuityCore = {
  /** Smoothed affect shown to L7 frame / intent snapshot. */
  display: EmotionState;
  /** Intensity velocity (units / second-ish, integrated with dt). */
  velocity: number;
  /** Latest arbitrator-approved target. */
  target: EmotionState;
  /** Last 2–4 distinct affect samples (newest last). */
  trace: Array<{ current: string; intensity: number }>;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function createEmotionContinuity(
  seed: EmotionState = { current: 'neutral', intensity: 0.35 },
): EmotionContinuityCore {
  const s = { ...seed };
  return {
    display: { ...s },
    velocity: 0,
    target: { ...s },
    trace: [{ current: s.current, intensity: s.intensity }],
  };
}

/** Call after each successful arbitration — records short transition memory. */
export function setApprovedTarget(core: EmotionContinuityCore, target: EmotionState): void {
  const prev = core.trace[core.trace.length - 1];
  const changed =
    !prev ||
    prev.current !== target.current ||
    Math.abs(prev.intensity - target.intensity) > 0.035;
  if (changed) {
    core.trace.push({ current: target.current, intensity: target.intensity });
    if (core.trace.length > TRACE_MAX) core.trace.shift();
  }
  core.target = { current: target.current, intensity: clamp01(target.intensity) };
}

function traceOscillationFactor(core: EmotionContinuityCore): number {
  if (core.trace.length < 3) return 1;
  const uniq = new Set(core.trace.map((t) => t.current));
  return uniq.size >= 3 ? 0.55 : 1;
}

/**
 * Advance display toward `target` using momentum + trace-blended intensity.
 * Call from rAF (every frame) with wall `deltaMs`, and optionally once after `setApprovedTarget`.
 */
export function tickEmotionContinuity(core: EmotionContinuityCore, deltaMs: number): void {
  const dt = Math.min(100, Math.max(0, deltaMs)) / 1000;
  if (dt <= 0) return;

  let effIntensity = core.target.intensity;
  if (core.trace.length >= 2) {
    const avg = core.trace.reduce((s, x) => s + x.intensity, 0) / core.trace.length;
    effIntensity = effIntensity * 0.78 + avg * 0.22;
  }

  const oscF = traceOscillationFactor(core);
  const k = 2.85 * oscF;
  const gap = effIntensity - core.display.intensity;
  core.velocity += gap * k * dt;
  core.velocity *= Math.exp(-3.4 * dt);

  core.display.intensity = clamp01(core.display.intensity + core.velocity * dt * 72);

  let nextLabel = core.display.current;
  if (core.display.current === core.target.current) {
    nextLabel = core.target.current;
  } else if (Math.abs(core.display.intensity - core.target.intensity) < 0.072) {
    nextLabel = core.target.current;
  }
  core.display.current = nextLabel;
  core.display.intensity = clamp01(core.display.intensity);
}

export function resetEmotionContinuity(
  core: EmotionContinuityCore,
  seed: EmotionState = { current: 'neutral', intensity: 0.35 },
): void {
  const next = createEmotionContinuity(seed);
  core.display = next.display;
  core.velocity = next.velocity;
  core.target = next.target;
  core.trace = next.trace;
}
