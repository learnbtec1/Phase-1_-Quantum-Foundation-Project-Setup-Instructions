/**
 * Pure helpers for V20 procedural life (breathing envelope, group bounce).
 * Keeps math testable and AvatarCanvas slightly thinner.
 *
 * Phase 20 — `vrmaMicroBreathEuler` drives a minimal spine / chest / shoulder sway
 * layered on top of VRMA so the body keeps “alive” motion when clips run (TTS-independent).
 */
import {
  BREATHE_HZ,
  BREATHE_AMP_STANDING,
  BREATHE_AMP_SITTING,
  BREATHE_HARMONIC_STRENGTH,
  BREATHE_HARMONIC_FREQ,
  BREATHE_GROUP_BOUNCE_M,
} from '@/config/avatar';

const TAU = Math.PI * 2;

/** Slow oscillation (rad) for additive VRMA overlay — spine X, chest X, shoulder roll Z. */
export function vrmaMicroBreathEuler(t: number): {
  spineX: number;
  chestX: number;
  shoulderRoll: number;
} {
  const f = TAU * 0.19;
  const spineX =
    Math.sin(t * f) * 0.007 + Math.sin(t * f * 2.08) * 0.0024;
  const chestX =
    Math.sin(t * f + 0.11) * 0.006 + Math.sin(t * f * 2.08 + 0.4) * 0.002;
  const shoulderRoll = Math.sin(t * f + 0.55) * 0.0055;
  return { spineX, chestX, shoulderRoll };
}

/** Spine / upper-chest breathing target (small angle, before lerp). */
export function breathSpineAmount(
  t: number,
  isSitting: boolean,
  phaseScale: number,
): number {
  const amp = (isSitting ? BREATHE_AMP_SITTING : BREATHE_AMP_STANDING) * phaseScale;
  const f = TAU * BREATHE_HZ;
  return (
    Math.sin(t * f) * amp
    + Math.sin(t * f * BREATHE_HARMONIC_FREQ) * amp * BREATHE_HARMONIC_STRENGTH
  );
}

/** Sub-millimetre vertical bounce on the avatar root (metres). */
export function breathGroupBounce(t: number, isSitting: boolean): number {
  const scale = isSitting ? 0.55 : 1;
  return Math.sin(t * TAU * BREATHE_HZ) * BREATHE_GROUP_BOUNCE_M * scale;
}
