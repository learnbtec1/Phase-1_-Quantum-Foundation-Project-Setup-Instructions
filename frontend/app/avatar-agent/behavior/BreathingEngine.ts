/**
 * Level 6.2 — Couple procedural breathing energy to affective state (via motor multiplier ref).
 */

/** Relative breath rate vs neutral (1.0). VRMSkeletonManager scales breath speed with motorMul. */
export function getBreathingRate(emotion: string): number {
  const e = emotion.toLowerCase();
  switch (e) {
    case 'focused':
      return 0.82;
    case 'happy':
    case 'excited':
      return 1.28;
    case 'surprised':
      return 1.18;
    case 'curious':
      return 1.05;
    case 'neutral':
    default:
      return 1.0;
  }
}

/** Chest / spine breath amplitude scale (used to nudge motor). */
export function getBreathingAmplitude(intensity: number): number {
  const i = Math.min(1, Math.max(0, intensity));
  return 0.02 + i * 0.03;
}

/**
 * Softly nudges `motorSpeedMulRef` toward a target derived from emotion + intensity.
 * Call once per approved intent (host); PAD bridge continues to blend each frame.
 */
export function applyBreathingMotorCoupling(
  emotion: string,
  intensity: number,
  motorSpeedMulRef?: { current: number },
): void {
  if (!motorSpeedMulRef) return;
  const rate = getBreathingRate(emotion);
  const amp = getBreathingAmplitude(intensity);
  const target = Math.min(1.42, Math.max(0.58, 0.82 + (rate - 1) * 0.22 + amp * 1.1));
  const cur = motorSpeedMulRef.current;
  motorSpeedMulRef.current = cur * 0.78 + target * 0.22;
}
