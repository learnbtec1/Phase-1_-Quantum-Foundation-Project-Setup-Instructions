/**
 * Canonical avatar personality — identity layer for motion, speech timing, and gaze.
 * Complements legacy `config/personality.ts` (LLM/voice prose) and `avatarPersonality.ts` (micro motion).
 */
'use client';

import * as THREE from 'three';
import type { IntentPresentation } from '@/ai/avatar/avatarIntent';
import type { EyeIntentionScalars } from '@/lib/avatar/eyeIntention';
import type { PersonalityMemoryState } from '@/ai/avatar/personalityMemory';

export type PersonalityArchetype = 'calm_teacher' | 'energetic_mentor' | 'friendly_guide';

export type PersonalityTraits = {
  calmness: number;
  expressiveness: number;
  warmth: number;
  confidence: number;
  curiosity: number;
};

export type MotionSignature = {
  headAmplitude: number;
  gestureFrequency: number;
  idleMovement: number;
};

export type SpeechSignature = {
  speed: number;
  emphasis: number;
  pausePattern: number;
};

export type PersonalityProfile = {
  id: string;
  type: PersonalityArchetype;
  traits: PersonalityTraits;
  motionSignature: MotionSignature;
  speechSignature: SpeechSignature;
};

export type EffectiveTraits = PersonalityTraits;

/** Blend base traits with long-visit familiarity (subtle). */
export function mergeTraitsWithMemory(
  traits: PersonalityTraits,
  mem: PersonalityMemoryState,
): EffectiveTraits {
  const f = THREE.MathUtils.clamp(mem.familiarity, 0, 1);
  return {
    calmness: THREE.MathUtils.clamp(traits.calmness + f * 0.04, 0, 1),
    expressiveness: THREE.MathUtils.clamp(
      traits.expressiveness + mem.expressivenessBias + f * 0.03,
      0,
      1,
    ),
    warmth: THREE.MathUtils.clamp(traits.warmth + mem.warmthBias + f * 0.05, 0, 1),
    confidence: traits.confidence,
    curiosity: THREE.MathUtils.clamp(traits.curiosity + f * 0.02, 0, 1),
  };
}

const CALM_TEACHER: PersonalityProfile = {
  id: 'cogni-calm-teacher-v1',
  type: 'calm_teacher',
  traits: {
    calmness: 0.82,
    expressiveness: 0.48,
    warmth: 0.78,
    confidence: 0.74,
    curiosity: 0.65,
  },
  motionSignature: {
    headAmplitude: 0.55,
    gestureFrequency: 0.42,
    idleMovement: 0.38,
  },
  speechSignature: {
    speed: 0.42,
    emphasis: 0.45,
    pausePattern: 0.72,
  },
};

const ENERGETIC_MENTOR: PersonalityProfile = {
  id: 'cogni-energetic-mentor-v1',
  type: 'energetic_mentor',
  traits: {
    calmness: 0.38,
    expressiveness: 0.82,
    warmth: 0.7,
    confidence: 0.76,
    curiosity: 0.78,
  },
  motionSignature: {
    headAmplitude: 0.78,
    gestureFrequency: 0.8,
    idleMovement: 0.62,
  },
  speechSignature: {
    speed: 0.72,
    emphasis: 0.68,
    pausePattern: 0.4,
  },
};

const FRIENDLY_GUIDE: PersonalityProfile = {
  id: 'cogni-friendly-guide-v1',
  type: 'friendly_guide',
  traits: {
    calmness: 0.58,
    expressiveness: 0.62,
    warmth: 0.88,
    confidence: 0.62,
    curiosity: 0.82,
  },
  motionSignature: {
    headAmplitude: 0.64,
    gestureFrequency: 0.55,
    idleMovement: 0.52,
  },
  speechSignature: {
    speed: 0.55,
    emphasis: 0.52,
    pausePattern: 0.58,
  },
};

const BY_TYPE: Record<PersonalityArchetype, PersonalityProfile> = {
  calm_teacher: CALM_TEACHER,
  energetic_mentor: ENERGETIC_MENTOR,
  friendly_guide: FRIENDLY_GUIDE,
};

function readArchetypeFromEnv(): PersonalityArchetype {
  if (typeof process === 'undefined') return 'calm_teacher';
  const raw = process.env.NEXT_PUBLIC_AVATAR_PERSONALITY_TYPE?.trim().toLowerCase() ?? '';
  if (raw === 'energetic_mentor' || raw === 'mentor') return 'energetic_mentor';
  if (raw === 'friendly_guide' || raw === 'guide') return 'friendly_guide';
  if (raw === 'calm_teacher' || raw === 'teacher' || raw === 'cogni') return 'calm_teacher';
  return 'calm_teacher';
}

let _cached: PersonalityProfile | null = null;

export function getPersonalityProfile(): PersonalityProfile {
  if (_cached) return _cached;
  _cached = { ...BY_TYPE[readArchetypeFromEnv()] };
  return _cached;
}

/** Session-stable 0–1 for de-correlating variation without pure RNG noise. */
export function getPersonalityDeterministicPhase(): number {
  if (typeof window === 'undefined') return 0.37;
  let sid = sessionStorage.getItem('cogni:sessionPhase');
  if (!sid) {
    sid = String(Math.random());
    try {
      sessionStorage.setItem('cogni:sessionPhase', sid);
    } catch {
      /* */
    }
  }
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0;
  return (h % 10000) / 10000;
}

/**
 * Stable behavioral biases — same avatar, same session, not random per frame.
 */
export function getBehavioralSignature(profile: PersonalityProfile): {
  headTiltBiasRad: number;
  pauseBeforeSpeakBiasMs: number;
  gestureStylePhase: number;
} {
  const phase = getPersonalityDeterministicPhase();
  const seed = profile.id.length * 0.17 + profile.traits.calmness * 0.31;
  return {
    headTiltBiasRad: (phase - 0.5) * 0.04 * (0.6 + profile.traits.warmth * 0.4),
    pauseBeforeSpeakBiasMs: Math.round(
      28 * profile.speechSignature.pausePattern + 12 * profile.traits.calmness + phase * 22,
    ),
    gestureStylePhase: seed + phase * 0.25,
  };
}

/**
 * Motion presentation — calm → smoother/quieter; expressive → wider; confidence → steadier head gaze multiplier.
 */
export function modulatePresentationForPersonality(
  pres: IntentPresentation,
  traits: EffectiveTraits,
  motion: MotionSignature,
): IntentPresentation {
  const calm = traits.calmness;
  const ex = traits.expressiveness;
  const conf = traits.confidence;
  const cur = traits.curiosity;
  const amp = motion.headAmplitude;
  const idleM = motion.idleMovement;
  const calmSlow = THREE.MathUtils.lerp(1, 0.88, calm);
  const exBoost = THREE.MathUtils.lerp(0.92, 1.12, ex);
  const confStab = THREE.MathUtils.lerp(1, 1.08, conf);
  const curDrift = THREE.MathUtils.lerp(0.92, 1.1, cur);
  return {
    headNoiseMul: pres.headNoiseMul * calmSlow * exBoost * amp * THREE.MathUtils.lerp(0.95, 1.05, idleM),
    headGazeMul: pres.headGazeMul * confStab * THREE.MathUtils.lerp(0.96, 1.04, calm),
    saccadeMul: pres.saccadeMul * curDrift * THREE.MathUtils.lerp(1.06, 0.88, conf * 0.7),
    humanIdleNeckMul: pres.humanIdleNeckMul * exBoost * amp,
    animationGazeScaleMul: pres.animationGazeScaleMul * confStab * calmSlow,
    animationSaccadeMul: pres.animationSaccadeMul * curDrift * THREE.MathUtils.lerp(1, 0.94, conf * 0.5),
  };
}

/** Intent transition duration scale: calmer → slightly longer blends. */
export function getPersonalityTransitionMul(traits: EffectiveTraits): number {
  return THREE.MathUtils.lerp(0.85, 1.22, traits.calmness);
}

/**
 * Eye intention scalars — curiosity shifts gaze; calm reduces drift; confidence pulls to center.
 */
export function modulateEyeIntentionForPersonality(
  s: EyeIntentionScalars,
  traits: EffectiveTraits,
): EyeIntentionScalars {
  const calm = traits.calmness;
  const conf = traits.confidence;
  const cur = traits.curiosity;
  return {
    saccadeMul: s.saccadeMul * THREE.MathUtils.lerp(0.94, 1.12, cur) * THREE.MathUtils.lerp(1, 0.9, conf * 0.35),
    driftMul: s.driftMul * THREE.MathUtils.lerp(1.05, 0.86, conf) * THREE.MathUtils.lerp(1, 1.08, cur * 0.4),
    gazeDirectAdd:
      s.gazeDirectAdd + THREE.MathUtils.lerp(0, 0.028, conf * 0.85) - THREE.MathUtils.lerp(0, 0.014, calm * 0.5),
    blinkIntervalMul: s.blinkIntervalMul * THREE.MathUtils.lerp(1, 1.06, calm),
    centerPullMul: s.centerPullMul * THREE.MathUtils.lerp(1, 1.08, conf),
  };
}

/**
 * Viseme / mouth shaping — mix Azure-driven targets with speech signature.
 */
export function mixSpeechStyleWithProfile(args: {
  intensity: number;
  rhythm: number;
  emphasis: number;
  profile: PersonalityProfile;
  traits: EffectiveTraits;
}): { intensity: number; rhythm: number; emphasis: number } {
  const sig = args.profile.speechSignature;
  const w = 0.38;
  const confMul = THREE.MathUtils.lerp(0.94, 1.12, args.traits.confidence);
  return {
    intensity: THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(args.intensity, args.intensity * 0.62 + sig.emphasis * 0.38 + sig.speed * 0.08, w)
        * confMul,
      0.15,
      1,
    ),
    rhythm: THREE.MathUtils.lerp(args.rhythm, THREE.MathUtils.lerp(0.35, 0.85, sig.speed), 0.35),
    emphasis: THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(args.emphasis, args.emphasis * 0.55 + sig.emphasis * 0.45, 0.42),
      0,
      1,
    ),
  };
}
