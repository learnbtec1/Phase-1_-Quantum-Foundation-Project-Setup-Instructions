'use client';
/**
 * Cogni Personality Authority Resolver — Stage 1 (single source of truth).
 *
 * Consolidates fragmented personality inputs into ONE read model:
 *   `ResolvedCogniPersonality`.
 *
 * HARD RULES (this module):
 *   • Never runs inside useFrame — consumers call `getResolvedCogniPersonality()`
 *     only when they need a snapshot (or rely on snapshot-hash caching).
 *   • Recomputes ONLY when the input snapshot changes (persona / stance /
 *     memory / evolution / response mood).
 *   • Does NOT import or call gesture engines, biomechanical layers, lip sync,
 *     or behavior timeline.
 *
 * Waterfall (strict — higher priority wins; lower = small additive only):
 *   1. Base identity — `config/personality.ts` (COGNI_PERSONA + AVATAR_PERSONALITY)
 *   2. Archetype profile — `personalityProfile.ts` (trait + motion + speech sig)
 *   3. Teaching stance — `cogniPersonaStance.ts` (performance scales + stance enum)
 *   4. Evolution vector — `personalityEvolution.ts` (bounded drift from interaction)
 *   5. Session memory — `personalityMemory.ts` (warmth / expressiveness bias)
 *   6. Response mood — `responsePersonality.ts` (engaged vs calm micro-nudge)
 */

import * as THREE from 'three';

import { AVATAR_PERSONALITY, COGNI_PERSONA } from '@/config/personality';
import { getPersonalityProfile } from '@/ai/avatar/personalityProfile';
import { getPersonalityMemoryState } from '@/ai/avatar/personalityMemory';
import { getDerivedAvatarMood } from '@/ai/avatar/responsePersonality';
import {
  BASE_PERSONALITY_VECTOR,
  getEffectivePersonalityVector,
} from '@/lib/avatar/personalityEvolution';
import {
  getCogniPersonaPerformanceScales,
  getCogniTeachingStance,
  type CogniTeachingStance,
} from '@/lib/avatar/cogniPersonaStance';

// ─── Public resolved model (contract from Stage 1 spec) ─────────────────────

export type ResolvedCogniPersonality = {
  warmth: number;
  expressiveness: number;
  calmness: number;
  energy: number;
  curiosity: number;
  empathy: number;
  formality: number;

  gestureIntensity: number;
  gestureSpeed: number;
  gestureFrequency: number;

  headMovementAmount: number;
  eyeContactStrength: number;
  breathingAmplitude: number;

  speechRateMul: number;

  activePersona: 'calm_teacher' | 'friendly_guide' | 'energetic_mentor';

  activeStance:
    | 'interactive_assistant'
    | 'formal_instructor'
    | 'supportive_companion';

  sourceBreakdown: {
    base: string;
    profile: string;
    stance: string;
    memory: string;
    evolution: string;
    response: string;
  };
};

// ─── Internal authority audit (Phase 1 — frozen as documentation) ─────────────
/*
  | File                         | Traits controlled              | Mutates motion? | Every frame? | Gesture intensity? | Emotion weight? | Conflicts with |
  |------------------------------|--------------------------------|-----------------|----------------|----------------------|-----------------|----------------|
  | config/personality.ts        | LLM prose, PAD, voice, timing| Indirect via TTS| No             | timing baseline      | prompt prose    | profile voice  |
  | personalityProfile.ts        | 5 traits + motion + speech sig| No (read model) | getPersonalityProfile cached once per load | motionSignature feeds motion elsewhere | traits → presentation | avatarPersonality 3-scalar |
  | avatarPersonality.ts         | calm / expressive / curiosity  | Indirect multipliers | Only if polled per frame | yes via getCinematicGestureWeightFactor | no | personalityProfile overlap |
  | personalityMemory.ts         | familiarity + biases         | No              | No             | no                   | no              | mergeTraitsWithMemory vs manual merge |
  | responsePersonality.ts       | mood, reply class, delays      | preamble events | async setTimeout paths | intent depth offsets | classifyReply | brain store coupling |
  | personalityEvolution.ts      | 5D vector drift                | indirect        | if polled each frame | getGestureEnergyMul | no | BASE vs adapted |
  | cogniPersonaStance.ts        | stance + perf scales           | indirect        | stance read cheap | semanticGestureMul   | emotion→stance  | awareness engine |
  | __personalityMotion.ts       | Stage 2: consumer of resolver only | YES in-place motion object | if called each frame | maps gestureIntensity etc. | none (no local persona) | was duplicate profile table (removed) |
*/

// ─── Snapshot cache (no per-frame recompute) ─────────────────────────────────

let _lastSnapshotKey = '';
let _cached: ResolvedCogniPersonality | null = null;
let _listenersAttached = false;

function clamp01(x: number): number {
  return THREE.MathUtils.clamp(x, 0, 1);
}

function mapStanceToResolved(s: CogniTeachingStance): ResolvedCogniPersonality['activeStance'] {
  if (s === 'formal_instructor') return 'formal_instructor';
  if (s === 'charismatic_celebrate') return 'supportive_companion';
  return 'interactive_assistant';
}

/** Priority 1 — Base identity from `config/personality.ts` (Cogni core targets). */
function buildBaseIdentity(): Pick<
  ResolvedCogniPersonality,
  | 'warmth'
  | 'expressiveness'
  | 'calmness'
  | 'energy'
  | 'curiosity'
  | 'empathy'
  | 'formality'
> {
  const pad = AVATAR_PERSONALITY;
  const timing = COGNI_PERSONA.timing;

  const warmth = clamp01(pad.friendliness);
  const curiosity = clamp01(pad.curiosity);
  const calmness = clamp01(0.52 + pad.seriousness * 0.22 + (1 - pad.playfulness) * 0.18);
  const expressiveness = clamp01(
    0.42 + pad.friendliness * 0.22 + (1 - pad.seriousness) * 0.18 + (1 - pad.playfulness) * 0.12,
  );
  const energy = clamp01(timing.baselineGestureIntensity * 0.52);
  const empathy = clamp01(pad.friendliness * 0.9 + pad.playfulness * 0.1);
  const formality = clamp01(pad.seriousness * 0.72 + (1 - pad.friendliness) * 0.08);

  return { warmth, expressiveness, calmness, energy, curiosity, empathy, formality };
}

/** Single mutable accumulator so stance / evolution / memory / response layers mutate ONE state (no “dead” object literals). */
type ResolveAccum = {
  warmth: number;
  expressiveness: number;
  calmness: number;
  energy: number;
  curiosity: number;
  empathy: number;
  formality: number;
  gestureIntensity: number;
  gestureSpeed: number;
  gestureFrequency: number;
  headMovementAmount: number;
};

function applyStanceModifiers(stance: CogniTeachingStance, acc: ResolveAccum): void {
  // Small additive / multiplicative nudges only — never full overwrite.
  if (stance === 'formal_instructor') {
    acc.calmness = clamp01(acc.calmness + 0.05);
    acc.expressiveness = clamp01(acc.expressiveness - 0.06);
    acc.energy = clamp01(acc.energy - 0.05);
    acc.gestureIntensity = clamp01(acc.gestureIntensity * 0.92);
    acc.gestureFrequency = clamp01(acc.gestureFrequency * 0.9);
    acc.headMovementAmount = clamp01(acc.headMovementAmount * 0.88);
  } else if (stance === 'charismatic_celebrate') {
    acc.warmth = clamp01(acc.warmth + 0.03);
    acc.expressiveness = clamp01(acc.expressiveness + 0.06);
    acc.energy = clamp01(acc.energy + 0.06);
    acc.gestureIntensity = clamp01(acc.gestureIntensity * 1.08);
    acc.gestureFrequency = clamp01(acc.gestureFrequency * 1.06);
    acc.headMovementAmount = clamp01(acc.headMovementAmount * 1.1);
  }
}

function evolutionDeltaAdd(v: typeof BASE_PERSONALITY_VECTOR, acc: ResolveAccum): void {
  const b = BASE_PERSONALITY_VECTOR;
  const k = 0.12;
  acc.warmth = clamp01(acc.warmth + (v.warmth - b.warmth) * k);
  acc.energy = clamp01(acc.energy + (v.energy - b.energy) * k);
  acc.formality = clamp01(acc.formality + (v.formality - b.formality) * k);
  acc.curiosity = clamp01(acc.curiosity + (v.curiosity - b.curiosity) * k);
  acc.empathy = clamp01(acc.empathy + (v.empathy - b.empathy) * k);
  acc.calmness = clamp01(acc.calmness + (v.formality - b.formality) * -0.04);
}

function memoryDeltaAdd(mem: ReturnType<typeof getPersonalityMemoryState>, acc: ResolveAccum): void {
  acc.warmth = clamp01(acc.warmth + mem.warmthBias);
  acc.expressiveness = clamp01(acc.expressiveness + mem.expressivenessBias);
  const f = THREE.MathUtils.clamp(mem.familiarity, 0, 1);
  acc.curiosity = clamp01(acc.curiosity + f * 0.02);
}

function responseMoodNudge(mood: ReturnType<typeof getDerivedAvatarMood>, acc: ResolveAccum): void {
  const m = mood === 'engaged' ? 1.08 : 0.92;
  const d = (m - 1) * 0.04;
  acc.expressiveness = clamp01(acc.expressiveness + d);
  acc.energy = clamp01(acc.energy + d * 0.75);
  acc.curiosity = clamp01(acc.curiosity + d * 0.5);
}

function computeSnapshotKey(): string {
  const profile = getPersonalityProfile();
  const stance = getCogniTeachingStance();
  const ev = getEffectivePersonalityVector();
  const mem = getPersonalityMemoryState();
  const mood = getDerivedAvatarMood();
  const scales = getCogniPersonaPerformanceScales();

  return JSON.stringify({
    pType: profile.type,
    pId: profile.id,
    stance,
    sSem: +scales.semanticGestureMul.toFixed(4),
    sVoice: +scales.voiceRateMul.toFixed(4),
    sProc: +scales.proceduralIntensityMul.toFixed(4),
    ev: {
      w: +ev.warmth.toFixed(4),
      e: +ev.energy.toFixed(4),
      f: +ev.formality.toFixed(4),
      c: +ev.curiosity.toFixed(4),
      em: +ev.empathy.toFixed(4),
    },
    mem: {
      f: +mem.familiarity.toFixed(4),
      wb: +mem.warmthBias.toFixed(4),
      eb: +mem.expressivenessBias.toFixed(4),
      vc: mem.visitCount,
    },
    mood,
  });
}

function resolveWaterfall(): ResolvedCogniPersonality {
  const profile = getPersonalityProfile();
  const stance = getCogniTeachingStance();
  const scales = getCogniPersonaPerformanceScales();
  const ev = getEffectivePersonalityVector();
  const mem = getPersonalityMemoryState();
  const mood = getDerivedAvatarMood();

  // ── Priority 1: base identity ───────────────────────────────────────────
  const base = buildBaseIdentity();

  // ── Priority 2: archetype profile (strong blend toward profile traits) ─
  const wProfile = 0.72;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const acc: ResolveAccum = {
    warmth: clamp01(lerp(base.warmth, profile.traits.warmth, wProfile)),
    expressiveness: clamp01(lerp(base.expressiveness, profile.traits.expressiveness, wProfile)),
    calmness: clamp01(lerp(base.calmness, profile.traits.calmness, wProfile)),
    energy: clamp01(
      lerp(base.energy, profile.traits.confidence * 0.55 + profile.traits.expressiveness * 0.25, wProfile),
    ),
    curiosity: clamp01(lerp(base.curiosity, profile.traits.curiosity, wProfile)),
    empathy: clamp01(lerp(base.empathy, profile.traits.warmth * 0.85 + profile.traits.confidence * 0.1, wProfile)),
    formality: clamp01(
      lerp(base.formality, profile.traits.calmness * 0.35 + (1 - profile.traits.expressiveness) * 0.25, wProfile),
    ),
    gestureIntensity: clamp01(
      COGNI_PERSONA.timing.baselineGestureIntensity
        * (0.48 + 0.52 * profile.motionSignature.gestureFrequency)
        * THREE.MathUtils.clamp(scales.semanticGestureMul, 0.42, 1.52),
    ),
    gestureSpeed: clamp01(
      profile.speechSignature.speed * (0.55 + 0.45 * scales.voiceRateMul / 1.06),
    ),
    gestureFrequency: clamp01(
      profile.motionSignature.gestureFrequency * THREE.MathUtils.clamp(scales.semanticGestureMul, 0.42, 1.52),
    ),
    headMovementAmount: clamp01(
      profile.motionSignature.headAmplitude * (0.88 + 0.12 * scales.proceduralIntensityMul / 1.2),
    ),
  };

  applyStanceModifiers(stance, acc);

  // ── Priority 4: evolution (small additive toward learned vector) ────────
  evolutionDeltaAdd(ev, acc);

  // ── Priority 5: memory biases (small) ────────────────────────────────────
  memoryDeltaAdd(mem, acc);

  // ── Priority 6: response mood (tiny) ─────────────────────────────────────
  responseMoodNudge(mood, acc);

  const confidenceBlend = clamp01(
    profile.traits.confidence * 0.55 + acc.warmth * 0.25 + acc.calmness * 0.2,
  );
  const eyeContactStrength = clamp01(confidenceBlend * 0.88 + acc.warmth * 0.12);
  const breathingAmplitude = clamp01(0.94 - acc.calmness * 0.22);

  const speechRateMul = THREE.MathUtils.clamp(
    scales.voiceRateMul * (0.86 + COGNI_PERSONA.voiceParameters.rate * 0.14),
    0.78,
    1.14,
  );

  const activePersona = profile.type as ResolvedCogniPersonality['activePersona'];
  const activeStance = mapStanceToResolved(stance);

  const sourceBreakdown = {
    base:
      `AVATAR_PERSONALITY(f=${padNum(AVATAR_PERSONALITY.friendliness)},c=${padNum(AVATAR_PERSONALITY.curiosity)}) + COGNI_PERSONA.timing`,
    profile: `${profile.id} traits + motion/speech sig (blend ${wProfile})`,
    stance: `${stance} → scales(voice=${padNum(scales.voiceRateMul)},sem=${padNum(scales.semanticGestureMul)})`,
    memory: `familiarity=${padNum(mem.familiarity)} wb=${padNum(mem.warmthBias)} eb=${padNum(mem.expressivenessBias)}`,
    evolution: `Δ vs BASE at k=0.12 (${padNum(ev.warmth)},${padNum(ev.energy)},…)`,
    response: `mood=${mood} nudge±${padNum(Math.abs((mood === 'engaged' ? 1.08 : 0.92) - 1) * 0.04)}`,
  };

  return {
    warmth: +acc.warmth.toFixed(4),
    expressiveness: +acc.expressiveness.toFixed(4),
    calmness: +acc.calmness.toFixed(4),
    energy: +acc.energy.toFixed(4),
    curiosity: +acc.curiosity.toFixed(4),
    empathy: +acc.empathy.toFixed(4),
    formality: +acc.formality.toFixed(4),
    gestureIntensity: +acc.gestureIntensity.toFixed(4),
    gestureSpeed: +acc.gestureSpeed.toFixed(4),
    gestureFrequency: +acc.gestureFrequency.toFixed(4),
    headMovementAmount: +acc.headMovementAmount.toFixed(4),
    eyeContactStrength: +eyeContactStrength.toFixed(4),
    breathingAmplitude: +breathingAmplitude.toFixed(4),
    speechRateMul: +speechRateMul.toFixed(4),
    activePersona,
    activeStance,
    sourceBreakdown,
  };
}

function padNum(n: number): string {
  return n.toFixed(3);
}

/** Force next `getResolvedCogniPersonality()` to recompute (e.g. after tests). */
export function invalidateCogniPersonalityResolver(): void {
  _lastSnapshotKey = '';
  _cached = null;
}

/**
 * Authoritative read — returns the same object reference until the input
 * snapshot changes (no useFrame, no implicit per-frame work).
 */
export function getResolvedCogniPersonality(): ResolvedCogniPersonality {
  const key = computeSnapshotKey();
  if (_cached && key === _lastSnapshotKey) {
    return _cached;
  }
  _lastSnapshotKey = key;
  _cached = resolveWaterfall();
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__COGNI_PERSONALITY = _cached;
  }
  return _cached;
}

/** Idempotent — attaches lightweight listeners so stance/emotion updates invalidate the snapshot key naturally on next read. */
export function initCogniPersonalityResolverSideChannel(): void {
  if (typeof window === 'undefined' || _listenersAttached) return;
  _listenersAttached = true;
  const bump = (): void => {
    invalidateCogniPersonalityResolver();
  };
  window.addEventListener('avatar:emotion', bump);
  window.addEventListener('avatar:speak:end', bump);
  window.addEventListener('cogni:personality:invalidate', bump);
  getResolvedCogniPersonality();
}
