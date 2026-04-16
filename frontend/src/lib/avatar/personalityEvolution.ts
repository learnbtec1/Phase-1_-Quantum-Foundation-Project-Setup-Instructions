/**
 * Adaptive digital identity — slow personality drift from interaction signals.
 * Blends learned traits with a fixed base (COGNI core identity preserved).
 *
 * Storage: localStorage `cogni:pev` (bounded). No PII.
 */
'use client';

import { getProfile } from '@/lib/avatar/emotionalMemory';

const STORAGE_KEY = 'cogni:pev';

/** Core baseline — canonical identity anchor */
export const BASE_PERSONALITY_VECTOR: PersonalityVector = {
  warmth: 0.6,
  energy: 0.5,
  formality: 0.4,
  curiosity: 0.7,
  empathy: 0.65,
};

const LEARNING_RATE = 0.02;
/** How much learned `adapted` blends into visible vector (spec: 0.2–0.4) */
const BLEND_ALPHA = 0.28;
/** Max deviation of stored `adapted` from BASE per axis */
const MAX_DRIFT = 0.14;
/** After this many days idle, pull adapted toward BASE each read */
const INACTIVE_DECAY_START_DAYS = 3;
const INACTIVE_DECAY_HALF_LIFE_DAYS = 18;

export type PersonalityVector = {
  warmth: number;
  energy: number;
  formality: number;
  curiosity: number;
  empathy: number;
};

let _adapted: PersonalityVector = { ...BASE_PERSONALITY_VECTOR };
let _dirty = false;
let _lastDecayApplyMs = 0;
let _initialized = false;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVector(a: PersonalityVector, b: PersonalityVector, t: number): PersonalityVector {
  return {
    warmth: lerp(a.warmth, b.warmth, t),
    energy: lerp(a.energy, b.energy, t),
    formality: lerp(a.formality, b.formality, t),
    curiosity: lerp(a.curiosity, b.curiosity, t),
    empathy: lerp(a.empathy, b.empathy, t),
  };
}

function clampDrift(v: PersonalityVector): PersonalityVector {
  const o = { ...v };
  (Object.keys(BASE_PERSONALITY_VECTOR) as (keyof PersonalityVector)[]).forEach((k) => {
    const b = BASE_PERSONALITY_VECTOR[k];
    o[k] = Math.max(b - MAX_DRIFT, Math.min(b + MAX_DRIFT, o[k]));
    o[k] = clamp01(o[k]);
  });
  return o;
}

export function initPersonalityEvolution(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersonalityVector>;
      _adapted = clampDrift({
        warmth: typeof p.warmth === 'number' ? p.warmth : BASE_PERSONALITY_VECTOR.warmth,
        energy: typeof p.energy === 'number' ? p.energy : BASE_PERSONALITY_VECTOR.energy,
        formality: typeof p.formality === 'number' ? p.formality : BASE_PERSONALITY_VECTOR.formality,
        curiosity: typeof p.curiosity === 'number' ? p.curiosity : BASE_PERSONALITY_VECTOR.curiosity,
        empathy: typeof p.empathy === 'number' ? p.empathy : BASE_PERSONALITY_VECTOR.empathy,
      });
    } else {
      _adapted = { ...BASE_PERSONALITY_VECTOR };
    }
  } catch {
    _adapted = { ...BASE_PERSONALITY_VECTOR };
  }
  _initialized = true;
}

export function flushPersonalityEvolution(): void {
  if (typeof window === 'undefined' || !_dirty) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_adapted));
    _dirty = false;
  } catch {
    /* quota */
  }
}

function ensureInit(): void {
  if (typeof window === 'undefined') return;
  if (!_initialized) initPersonalityEvolution();
}

/**
 * Idle decay: slowly return toward BASE when user has been away.
 */
function applyInactiveDecay(): void {
  const now = Date.now();
  if (now - _lastDecayApplyMs < 60_000) return;
  _lastDecayApplyMs = now;

  const lastTs = getProfile().lastInteractionTs;
  const days = (now - lastTs) / 86_400_000;
  if (days <= INACTIVE_DECAY_START_DAYS) return;

  const u = Math.min(1, (days - INACTIVE_DECAY_START_DAYS) / INACTIVE_DECAY_HALF_LIFE_DAYS);
  const step = u * 0.04;
  _adapted = lerpVector(_adapted, BASE_PERSONALITY_VECTOR, step);
  _adapted = clampDrift(_adapted);
  _dirty = true;
}

/**
 * Effective traits shown to the system — blend identity base with learned offset.
 */
export function getEffectivePersonalityVector(): PersonalityVector {
  if (typeof window === 'undefined') return { ...BASE_PERSONALITY_VECTOR };
  ensureInit();
  applyInactiveDecay();
  return lerpVector(BASE_PERSONALITY_VECTOR, _adapted, BLEND_ALPHA);
}

/** Raw adapted (for debugging / export only) */
export function getAdaptedPersonalityVector(): PersonalityVector {
  ensureInit();
  return { ..._adapted };
}

function inferDeltasFromInteraction(input: {
  text: string;
  engagement: number;
  mirrorEmotion?: string;
}): PersonalityVector {
  const t = (input.text ?? '').trim();
  const lower = t.toLowerCase();
  const eng = clamp01(input.engagement);
  const mirror = (input.mirrorEmotion ?? '').toLowerCase();

  let dw = 0;
  let de = 0;
  let df = 0;
  let dc = 0;
  let dem = 0;

  if (/thanks|thank you|شكر|ممتاز|great|love|awesome|رائع|حلو|❤|😊|yay|yes!/.test(lower)) {
    dw += 0.45;
    de += 0.12;
  }
  if (/\b(because|therefore|analysis|analyze|data|metric|chart|graph|evidence|إحصاء|تحليل|لأن|وبالتالي)\b/i.test(lower)) {
    df += 0.55;
    dc += 0.35;
    dw -= 0.12;
  }
  if (t.length > 140) {
    df += 0.18;
    dc += 0.12;
  }

  const engDelta = eng - 0.5;
  dw += engDelta * 0.35;
  de += engDelta * 0.4;
  dem += engDelta * 0.15;

  if (mirror === 'excited') de += 0.4;
  if (mirror === 'frustrated') dem += 0.35;
  if (mirror === 'confused') {
    dem += 0.3;
    df -= 0.2;
    dw += 0.15;
  }
  if (mirror === 'calm') {
    dw += 0.12;
    de -= 0.1;
  }

  return {
    warmth: dw,
    energy: de,
    formality: df,
    curiosity: dc,
    empathy: dem,
  };
}

/** Apply one learning step from a user turn (deterministic, small deltas). */
export function tickPersonalityFromInteraction(input: {
  text: string;
  engagement: number;
  mirrorEmotion?: string;
}): void {
  ensureInit();
  const d = inferDeltasFromInteraction(input);
  const lr = LEARNING_RATE;

  _adapted.warmth += d.warmth * lr;
  _adapted.energy += d.energy * lr;
  _adapted.formality += d.formality * lr;
  _adapted.curiosity += d.curiosity * lr;
  _adapted.empathy += d.empathy * lr;

  _adapted = clampDrift(_adapted);
  _dirty = true;
}

/** Subtle multipliers for embodiment — keep near 1 */
export function getGestureEnergyMul(): number {
  if (typeof window === 'undefined') return 1;
  const v = getEffectivePersonalityVector();
  const e = v.energy;
  return clamp01(0.96 + e * 0.1);
}

export function getGazeIntentionPersonalityMods(): {
  driftMul: number;
  gazeDirectAdd: number;
} {
  if (typeof window === 'undefined') return { driftMul: 1, gazeDirectAdd: 0 };
  const v = getEffectivePersonalityVector();
  const soft = v.warmth * 0.5 + v.empathy * 0.5;
  return {
    driftMul: clamp01(1.02 - soft * 0.06),
    gazeDirectAdd: (soft - 0.6) * 0.028,
  };
}

export function getReactionDelayEvolutionMul(): number {
  if (typeof window === 'undefined') return 1;
  const v = getEffectivePersonalityVector();
  return clamp01(0.94 + v.empathy * 0.08 + (1 - v.energy) * 0.05);
}

/** One line for LLM / memory context */
export function getPersonalityEvolutionSummary(): string {
  const v = getEffectivePersonalityVector();
  const pace =
    v.formality > 0.52 ? 'structured' : v.energy > 0.55 ? 'upbeat' : 'steady';
  return (
    `Personality vector (evolved): warmth=${v.warmth.toFixed(2)} energy=${v.energy.toFixed(2)} ` +
    `formality=${v.formality.toFixed(2)} curiosity=${v.curiosity.toFixed(2)} empathy=${v.empathy.toFixed(2)} | pace=${pace}`
  );
}

export function resetPersonalityEvolution(): void {
  _adapted = { ...BASE_PERSONALITY_VECTOR };
  _dirty = true;
  _initialized = true;
  flushPersonalityEvolution();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
