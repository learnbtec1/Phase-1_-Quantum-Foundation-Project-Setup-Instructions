import {
  getEffectivePersonalityVector,
  getReactionDelayEvolutionMul,
  type PersonalityVector,
} from '@/lib/avatar/personalityEvolution';

/**
 * Consistent micro-personality — scales timing, gaze wander, and gesture expressiveness.
 * Single object used across reply pacing, gaze, and gesture engine (no per-feature overrides).
 * Evolved traits blend here at ~28% so motion stays stable while identity slowly adapts.
 */
export type AvatarPersonality = {
  calm: number;
  expressive: number;
  curiosity: number;
};

/** Static identity anchor (COGNI core) — blended with evolution in `getPersonality()`. */
export const AVATAR_PERSONALITY: AvatarPersonality = {
  /** Higher → slower / steadier motion and longer reaction delays. */
  calm: 0.7,
  /** Higher → stronger micro-expressions and slightly higher gesture intensity bias. */
  expressive: 0.4,
  /** Higher → more idle / thinking gaze drift toward “environment”. */
  curiosity: 0.6,
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map 5D evolution vector → calm / expressive / curiosity (identity-consistent). */
function vectorToAvatarTargets(ev: PersonalityVector): Pick<AvatarPersonality, 'calm' | 'expressive' | 'curiosity'> {
  return {
    calm: clamp01(
      0.52 + (1 - ev.energy) * 0.28 + (1 - ev.warmth) * 0.06 + ev.formality * 0.08,
    ),
    expressive: clamp01(0.3 + ev.warmth * 0.32 + ev.energy * 0.26 + ev.empathy * 0.08),
    curiosity: clamp01(0.48 + ev.curiosity * 0.36 - ev.formality * 0.05),
  };
}

const EVOLUTION_SHAPE_BLEND = 0.28;

export function getPersonality(): AvatarPersonality {
  const ev = getEffectivePersonalityVector();
  const tgt = vectorToAvatarTargets(ev);
  return {
    calm: lerp(AVATAR_PERSONALITY.calm, tgt.calm, EVOLUTION_SHAPE_BLEND),
    expressive: lerp(AVATAR_PERSONALITY.expressive, tgt.expressive, EVOLUTION_SHAPE_BLEND),
    curiosity: lerp(AVATAR_PERSONALITY.curiosity, tgt.curiosity, EVOLUTION_SHAPE_BLEND),
  };
}

/** Multiplier on base reaction delay (personality + calm + empathy pacing). */
export function getReactionDelayPersonalityMul(): number {
  const { calm, expressive } = getPersonality();
  return (0.88 + calm * 0.38 - expressive * 0.12) * getReactionDelayEvolutionMul();
}

/** ~12–20% — hesitation / micro-pause before gesture (human imperfection). */
export function getHesitationChance(): number {
  const { calm } = getPersonality();
  return 0.12 + calm * 0.08;
}

/** Extra VRMA / hold duration from personality (expressive stretches slightly). */
export function getGestureDurationPersonalityMul(): number {
  const { expressive } = getPersonality();
  return 0.96 + expressive * 0.14;
}

/** Higher when calm → more “silence is human” skips for ambient idle. */
export function getIdleSilenceProbability(): number {
  const { calm, expressive } = getPersonality();
  return Math.min(0.86, Math.max(0.48, 0.7 + calm * 0.09 - expressive * 0.07));
}

/** Scales spontaneous tick spacing — calmer avatar moves less often. */
export function getSpontaneousIdleGapMul(): number {
  const { calm, expressive } = getPersonality();
  return 0.92 + calm * 0.35 - expressive * 0.08;
}

/** Calmer → slightly shallower breath amplitude (cinematic breathing layer). */
export function getBreathingAmplitudeFactor(): number {
  const { calm } = getPersonality();
  return Math.min(1, Math.max(0.68, 0.94 - calm * 0.22));
}

/** Scales procedural gesture clip weights — calm = softer, slower-feeling motion. */
export function getCinematicGestureWeightFactor(): number {
  const { calm, expressive } = getPersonality();
  return Math.min(0.98, Math.max(0.58, 0.93 - calm * 0.24 + expressive * 0.08));
}

/** Multiplier for cinematic micro noise (head/shoulder sin layer). */
export function getCinematicMicroNoiseScale(): number {
  const { calm, expressive } = getPersonality();
  return Math.min(1.15, Math.max(0.72, 0.88 - calm * 0.12 + expressive * 0.06));
}
