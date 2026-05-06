'use client';

/**
 * __personalityMotion.ts — **Pure motion consumer** (Stage 2).
 *
 * Pipeline position: AFTER `applySpeechFusion`, BEFORE the `_VIS_AMP` clamp.
 *
 * **Authority:** All trait-like gains come ONLY from `getResolvedCogniPersonality()`.
 * This module does not infer persona, stance, or emotional personality; it maps
 * already-resolved scalars → per-frame motion injections and **smooths those gains**
 * (output smoothing only — never the resolver snapshot).
 *
 * Mapping (single path, no stacked profile tables):
 *   • gestureAmp    ← gestureIntensity
 *   • gestureFreq   ← gestureFrequency (+ gestureSpeed as light coupling)
 *   • nodGain       ← headMovementAmount
 *   • tiltBias      ← small blend of warmth / curiosity (radians)
 *   • expressivity  ← expressiveness with calmness cap (energy-gated scale)
 *
 * Invariants (unchanged):
 *   • At speech energy 0, multiplicative expressivity scale is ×1 (silence).
 *   • Expressivity multiplier at full energy stays ≥ 0.7 (no collapse).
 *
 * Stage 3 — Procedural energy uses **only** `getStableMotionEnergy()` (not raw
 * viseme / opts.energy) so head and hands are not driven by frame spikes.
 */

import * as THREE from 'three';

import {
  getResolvedCogniPersonality,
  type ResolvedCogniPersonality,
} from '@/lib/avatar/resolveCogniPersonality';
import { getStableMotionEnergy } from '@/lib/avatar/unifiedEnergyModel';

// ─── Legacy motion profile label (HUD / devtools only — derived from resolver) ─

export type PersonalityProfile = 'teacher' | 'friend' | 'coach' | 'neutral';
export type PersonalityType = PersonalityProfile;

export type PersonalityMotionOpts = {
  speaking: boolean;
  energy: number;
  timeSec: number;
  intent: string;
};

type PersonalityParams = {
  gestureAmp: number;
  gestureFreq: number;
  nodGain: number;
  tiltBias: number;
  expressivity: number;
};

const MOTION_OUTPUT_SMOOTH = 0.16;
const BURST_HZ_BASE = 6;
const HEAD_ENERGY_SMOOTH = 0.12;
const GESTURE_ENERGY_CAP = 0.88;

let _personalityHeadEnergySm = 0;

let _smoothedParams: PersonalityParams | null = null;
let _lastPersonaStanceKey = '';

/** Resolver-only violation log (populated only if consumer invariant breaks). */
const _motionViolations: string[] = [];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mapPersonaToMotionProfile(r: ResolvedCogniPersonality): PersonalityProfile {
  switch (r.activePersona) {
    case 'calm_teacher':
      return 'teacher';
    case 'friendly_guide':
      return 'friend';
    case 'energetic_mentor':
      return 'coach';
    default:
      return 'neutral';
  }
}

/**
 * @deprecated Motion no longer follows manual profile switches — Cogni identity is
 * resolved centrally. Call is a no-op (retained so stray callers do not throw).
 */
export function setPersonalityProfile(_p: PersonalityProfile): void {
  /* authority: resolver only — manual motion profile selection removed */
}

/** Label derived from `getResolvedCogniPersonality().activePersona` (not an independent authority). */
export function getPersonalityProfile(): PersonalityProfile {
  return mapPersonaToMotionProfile(getResolvedCogniPersonality());
}

/** Current motion gains + derived HUD profile (all from resolver → mapping). */
export function getPersonalityConfig(): Readonly<PersonalityParams> & { profile: PersonalityProfile } {
  const r = getResolvedCogniPersonality();
  const profile = mapPersonaToMotionProfile(r);
  const p = deriveMotionParamsFromResolved(r);
  return { ...p, profile };
}

function _normIntent(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Single mapping: resolver → motion coefficients. No secondary amplifier tables.
 */
function deriveMotionParamsFromResolved(r: ResolvedCogniPersonality): PersonalityParams {
  const gi = THREE.MathUtils.clamp(r.gestureIntensity, 0.22, 1.05);
  const gf = THREE.MathUtils.clamp(r.gestureFrequency, 0.28, 1.55);
  const gs = THREE.MathUtils.clamp(r.gestureSpeed, 0.25, 1.2);
  const hm = THREE.MathUtils.clamp(r.headMovementAmount, 0.25, 1.2);
  const ex = THREE.MathUtils.clamp(r.expressiveness, 0.18, 0.95);
  const calm = THREE.MathUtils.clamp(r.calmness, 0.2, 0.98);
  const warmth = THREE.MathUtils.clamp(r.warmth, 0.15, 1);
  const curiosity = THREE.MathUtils.clamp(r.curiosity, 0.15, 1);

  const gestureAmp = THREE.MathUtils.clamp(0.4 + gi * 0.58, 0.45, 1.12);
  const gestureFreq = THREE.MathUtils.clamp(0.38 + gf * 0.55 + (gs - 0.5) * 0.12, 0.32, 1.45);
  const nodGain = THREE.MathUtils.clamp(0.36 + hm * 0.64, 0.38, 1.18);
  const tiltBias = THREE.MathUtils.clamp(
    (warmth - 0.5) * 0.055 + (curiosity - 0.5) * 0.028,
    -0.048,
    0.058,
  );
  let expressivity = 0.74 + ex * 0.34 - calm * 0.07;
  expressivity = THREE.MathUtils.clamp(expressivity, 0.7, 1.22);

  return { gestureAmp, gestureFreq, nodGain, tiltBias, expressivity };
}

function smoothMotionOutputParams(target: PersonalityParams, r: ResolvedCogniPersonality): PersonalityParams {
  const key = `${r.activePersona}|${r.activeStance}`;
  if (key !== _lastPersonaStanceKey) {
    _lastPersonaStanceKey = key;
    _smoothedParams = { ...target };
    return _smoothedParams;
  }
  if (!_smoothedParams) {
    _smoothedParams = { ...target };
    return _smoothedParams;
  }
  const s = _smoothedParams;
  s.gestureAmp = lerp(s.gestureAmp, target.gestureAmp, MOTION_OUTPUT_SMOOTH);
  s.gestureFreq = lerp(s.gestureFreq, target.gestureFreq, MOTION_OUTPUT_SMOOTH);
  s.nodGain = lerp(s.nodGain, target.nodGain, MOTION_OUTPUT_SMOOTH);
  s.tiltBias = lerp(s.tiltBias, target.tiltBias, MOTION_OUTPUT_SMOOTH * 0.85);
  s.expressivity = lerp(s.expressivity, target.expressivity, MOTION_OUTPUT_SMOOTH);
  return s;
}

function assertFiniteParams(label: string, p: PersonalityParams): void {
  const bad = (x: number) => !Number.isFinite(x);
  if (
    bad(p.gestureAmp) ||
    bad(p.gestureFreq) ||
    bad(p.nodGain) ||
    bad(p.tiltBias) ||
    bad(p.expressivity)
  ) {
    const msg = `${label}: non-finite motion params`;
    if (!_motionViolations.includes(msg)) _motionViolations.push(msg);
  }
}

/**
 * Apply personality-driven modulation to motion in-place.
 * **Input authority:** `getResolvedCogniPersonality()` exclusively for trait gains.
 */
export function applyPersonalityMotion(
  motion: { headNod: number; headTilt: number; openGesture: number },
  opts: PersonalityMotionOpts,
): void {
  const person = getResolvedCogniPersonality();
  const rawTarget = deriveMotionParamsFromResolved(person);
  assertFiniteParams('deriveMotionParamsFromResolved', rawTarget);
  const p = smoothMotionOutputParams(rawTarget, person);
  assertFiniteParams('smoothMotionOutputParams', p);

  const stableEn = THREE.MathUtils.clamp(getStableMotionEnergy(), 0, 1);
  _personalityHeadEnergySm = lerp(_personalityHeadEnergySm, stableEn, HEAD_ENERGY_SMOOTH);
  const energyHead = _personalityHeadEnergySm;
  const energyGesture = Math.min(GESTURE_ENERGY_CAP, stableEn);
  if (!opts.speaking) {
    _personalityHeadEnergySm *= 0.86;
  }
  const intent = _normIntent(opts.intent);

  const _preHN = motion.headNod;
  const _preHT = motion.headTilt;
  const _preOG = motion.openGesture;

  motion.openGesture += energyGesture * 0.095 * p.gestureAmp;
  motion.headNod += energyHead * 0.028 * p.nodGain;
  motion.headTilt += p.tiltBias;

  const scale = 1 + (p.expressivity - 1) * energyHead;
  if (scale !== 1) {
    motion.headNod *= scale;
    motion.openGesture *= scale;
  }

  if (intent === 'emphasizing' && opts.speaking) {
    const burst = Math.abs(Math.sin(opts.timeSec * BURST_HZ_BASE * p.gestureFreq));
    motion.headNod += burst * 0.11 * p.gestureAmp * energyHead;
  }

  const deltaHN = motion.headNod - _preHN;
  const deltaHT = motion.headTilt - _preHT;
  const deltaOG = motion.openGesture - _preOG;
  const finalMotionScale = THREE.MathUtils.clamp(
    (p.gestureAmp + p.nodGain + THREE.MathUtils.clamp(scale, 0.65, 1.35)) / 3,
    0.35,
    1.15,
  );

  const profile = mapPersonaToMotionProfile(person);

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__PERSONALITY_MOTION_DEBUG = {
      personalitySource: 'resolver',
      activePersona: person.activePersona,
      activeStance: person.activeStance,
      gestureIntensity: person.gestureIntensity,
      expressiveness: person.expressiveness,
      calmness: person.calmness,
      finalMotionScale,
      smoothedMotionParams: { ...p },
      derivedHudProfile: profile,
      removedMultipliers: [
        'PERSONALITIES teacher/friend/coach/neutral fingerprint table (independent motion authority)',
        'window.__personalityProfile runtime override branch',
        'per-call _activeProfile state separate from Cogni resolver',
        'stacked duplicate gestureIntensity from profile row × resolver (resolver-only path)',
      ],
      runtimeAuthority: 'resolver_only',
      motionEnergyAuthority: 'stableMotionEnergy',
      stableMotionEnergy: stableEn,
      energyForHead: energyHead,
      energyForGesture: energyGesture,
      remainingViolations: [..._motionViolations],
      deltas: {
        headNod: +deltaHN.toFixed(4),
        headTilt: +deltaHT.toFixed(4),
        openGesture: +deltaOG.toFixed(4),
      },
      authorityCheck: {
        resolverOnly: true,
        snapshot: `${person.activePersona}|${person.activeStance}`,
      },
    };
  }
}
