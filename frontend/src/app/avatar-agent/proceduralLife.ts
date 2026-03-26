/**
 * Pure helpers for V20 procedural life (breathing envelope, group bounce).
 * Keeps math testable and AvatarCanvas slightly thinner.
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
