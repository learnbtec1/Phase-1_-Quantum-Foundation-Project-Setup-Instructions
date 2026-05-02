/**
 * Cognitive brain model — centralized intention-driven state (not raw signal mirroring).
 * Feeds motion, gaze, lips, and gesture priority through one coherent snapshot.
 */
'use client';

import * as THREE from 'three';
import type { AgentFrame, EmotionLabel, PADVector } from '@/types/ai';
import type { InteractionIntent } from '@/ai/avatar/avatarIntent';
import type { UserSpeechRhythm } from '@/lib/avatar/userEmotionMirror';
import { getIntentPresentation, type IntentPresentation } from '@/ai/avatar/avatarIntent';
import type { PersonalityProfile } from '@/ai/avatar/personalityProfile';
import type { PersonalityMemoryState } from '@/ai/avatar/personalityMemory';
import {
  mergeTraitsWithMemory,
  mixSpeechStyleWithProfile,
  type EffectiveTraits,
} from '@/ai/avatar/personalityProfile';

// ── Public schema (matches product spec) ─────────────────────────────────────

export type CognitiveIntent = InteractionIntent;

export type BrainEmotionVA = {
  valence: number;
  arousal: number;
};

export type BrainSpeechStyle = {
  /** 0–1 overall speech intensity (drives viseme + motor). */
  intensity: number;
  /** 0–1 mapped from user rhythm + persona + profile. */
  rhythm: number;
  /** 0–1 linguistics + PAD stress + profile signature. */
  emphasis: number;
};

export type BrainTemporalMemory = {
  lastIntent: CognitiveIntent;
  intentDuration: number;
  lastSpeechTime: number;
};

/**
 * Full cognitive snapshot — single source for embodiment tuning/debug.
 */
export type AvatarBrainState = {
  intent: CognitiveIntent;
  emotion: BrainEmotionVA;
  energy: number;
  attention: number;
  /** Full character profile (archetype + traits + signatures). */
  personality: PersonalityProfile;
  personalityMemory: PersonalityMemoryState;
  /** Traits + familiarity — use for modulation helpers. */
  effectiveTraits: EffectiveTraits;
  speechStyle: BrainSpeechStyle;
  temporalMemory: BrainTemporalMemory;
};

export type ResolveIntentInput = {
  talking: boolean;
  thinking: boolean;
  isUserSpeaking: boolean;
  isListening: boolean;
  emotionLabel: EmotionLabel;
  lastFrame: AgentFrame | null;
  pad: PADVector;
  speechEmphasisHint: number;
  /** True during client TTS lead-in (eyes/body before audio). */
  preSpeechCognitiveWindow: boolean;
  intentAnticipation: number;
};

/**
 * Intent engine — priority order matches “human” semantics.
 * - User speaking → listening
 * - About to speak (lead-in / anticipation) → thinking
 * - Cognitive thinking signals → thinking
 * - Agent speaking + strong stress → emphasizing else explaining
 */
export function resolveIntent(input: ResolveIntentInput): CognitiveIntent {
  if (input.isUserSpeaking || input.isListening) return 'listening';

  if (input.preSpeechCognitiveWindow && !input.talking) return 'thinking';
  if (input.intentAnticipation > 0.16 && !input.talking && !input.isUserSpeaking) {
    return 'thinking';
  }

  if (input.thinking) return 'thinking';
  const tMs = input.lastFrame?.thinking_time_ms;
  if (typeof tMs === 'number' && tMs >= 850 && !input.talking) return 'thinking';

  const thinkingEmos = new Set<EmotionLabel>(['thinking', 'curious', 'surprised']);
  if (thinkingEmos.has(input.emotionLabel) && !input.talking && !input.isUserSpeaking) {
    return 'thinking';
  }

  if (input.talking) {
    const hint = input.speechEmphasisHint;
    const ar = input.pad.arousal;
    const strongEmotion =
      input.emotionLabel === 'excited'
      || input.emotionLabel === 'angry'
      || input.emotionLabel === 'encouraging';
    if (hint >= 0.52 || ar >= 0.48 || strongEmotion) return 'emphasizing';
    return 'explaining';
  }

  return 'idle';
}

function padToValenceArousal(pad: PADVector): BrainEmotionVA {
  return {
    valence: THREE.MathUtils.clamp(pad.pleasure, -1, 1),
    arousal: THREE.MathUtils.clamp(pad.arousal, -1, 1),
  };
}

function rhythmScalar(r: UserSpeechRhythm): number {
  if (r === 'fast') return 0.78;
  if (r === 'slow') return 0.38;
  return 0.55;
}

export function buildAvatarBrainState(args: {
  intent: CognitiveIntent;
  pad: PADVector;
  energy: number;
  attention: number;
  userSpeechRhythm: UserSpeechRhythm;
  speechEmphasisHint: number;
  temporalMemory: BrainTemporalMemory;
  profile: PersonalityProfile;
  personalityMemory: PersonalityMemoryState;
}): AvatarBrainState {
  const se = args.speechEmphasisHint;
  const traits = mergeTraitsWithMemory(args.profile.traits, args.personalityMemory);
  const baseIntensity = THREE.MathUtils.clamp(0.35 + args.energy * 0.55 + se * 0.12, 0, 1);
  const mixed = mixSpeechStyleWithProfile({
    intensity: baseIntensity,
    rhythm: rhythmScalar(args.userSpeechRhythm),
    emphasis: se,
    profile: args.profile,
    traits,
  });
  return {
    intent: args.intent,
    emotion: padToValenceArousal(args.pad),
    energy: args.energy,
    attention: args.attention,
    personality: args.profile,
    personalityMemory: args.personalityMemory,
    effectiveTraits: traits,
    speechStyle: mixed,
    temporalMemory: args.temporalMemory,
  };
}

export function lerpIntentPresentation(a: IntentPresentation, b: IntentPresentation, t: number): IntentPresentation {
  const u = THREE.MathUtils.smoothstep(t, 0, 1);
  return {
    headNoiseMul: THREE.MathUtils.lerp(a.headNoiseMul, b.headNoiseMul, u),
    headGazeMul: THREE.MathUtils.lerp(a.headGazeMul, b.headGazeMul, u),
    saccadeMul: THREE.MathUtils.lerp(a.saccadeMul, b.saccadeMul, u),
    humanIdleNeckMul: THREE.MathUtils.lerp(a.humanIdleNeckMul, b.humanIdleNeckMul, u),
    animationGazeScaleMul: THREE.MathUtils.lerp(a.animationGazeScaleMul, b.animationGazeScaleMul, u),
    animationSaccadeMul: THREE.MathUtils.lerp(a.animationSaccadeMul, b.animationSaccadeMul, u),
  };
}

export function getBlendedIntentPresentation(args: {
  committedIntent: CognitiveIntent;
  visualFromIntent: CognitiveIntent;
  visualBlend01: number;
}): IntentPresentation {
  const a = getIntentPresentation(args.visualFromIntent);
  const b = getIntentPresentation(args.committedIntent);
  return lerpIntentPresentation(a, b, args.visualBlend01);
}

/** Micro drift so timing never loops identically (breath-scale). */
export function humanVariationMul(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  const f = x - Math.floor(x);
  return 1 + (f - 0.5) * 0.06;
}

const FREEZE_AFTER_SEC = 2;
const FREEZE_ENERGY_NUDGE = 0.07;

export function evaluateFreezeAndValidate(args: {
  nowMs: number;
  lastMotionAtMs: number;
  energy: number;
}): { frozen: boolean; energyAdjust: number } {
  if (args.lastMotionAtMs <= 0) return { frozen: false, energyAdjust: 0 };
  const dt = (args.nowMs - args.lastMotionAtMs) / 1000;
  if (dt < FREEZE_AFTER_SEC) return { frozen: false, energyAdjust: 0 };
  return { frozen: true, energyAdjust: FREEZE_ENERGY_NUDGE };
}

export { FREEZE_AFTER_SEC };
