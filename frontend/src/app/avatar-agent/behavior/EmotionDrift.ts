/**
 * Level 6.1 — Gradual emotional state (reduces instant expression jumps).
 */

export type EmotionState = {
  current: string;
  intensity: number;
};

const DEFAULT_LERP = 0.12;

/**
 * Steps intensity toward target; adopts `target.current` when close in intensity space
 * so labels do not flip instantly while strength is still mid-transition.
 */
export function driftEmotion(
  current: EmotionState,
  target: EmotionState,
  lerp: number = DEFAULT_LERP,
): EmotionState {
  const nextIntensity = Math.min(
    1,
    Math.max(
      0,
      current.intensity + (target.intensity - current.intensity) * lerp,
    ),
  );

  let nextCurrent = current.current;
  if (current.current === target.current) {
    nextCurrent = target.current;
  } else if (Math.abs(nextIntensity - target.intensity) < 0.06) {
    nextCurrent = target.current;
  }

  return {
    current: nextCurrent,
    intensity: nextIntensity,
  };
}
