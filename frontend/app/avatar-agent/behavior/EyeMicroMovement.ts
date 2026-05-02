/**
 * Level 6.2 — Tiny gaze offsets (supplements built-in VRMSkeletonManager saccades).
 */

export type SaccadeSample = {
  x: number;
  y: number;
  durationMs: number;
};

export function generateSaccade(): SaccadeSample {
  return {
    x: (Math.random() - 0.5) * 0.02,
    y: (Math.random() - 0.5) * 0.02,
    durationMs: 80 + Math.random() * 120,
  };
}

/** Dispatches a short `avatar:gaze` nudge (AnimationController). */
export function dispatchSaccade(): void {
  dispatchSaccadeSample(generateSaccade());
}

/** Use a pre-generated sample (e.g. from {@link composeBehavior}). */
export function dispatchSaccadeSample(s: SaccadeSample): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:gaze', {
      detail: {
        yaw: s.x * 3.2,
        pitch: s.y * 3.2,
        durationMs: s.durationMs,
      },
    }),
  );
}
