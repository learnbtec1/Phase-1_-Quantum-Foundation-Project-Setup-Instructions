/**
 * Expression **authority** for head-layer procedural motion: allowed primitives only,
 * adaptive hold, cross-expression gain blend, per-primitive energy profile, and
 * lerped head time-scale.
 *
 * Signal flow (no double-smoothing contract):
 *   raw energy → smoothedEnergy (lerp 0.12)  — ONE smoothing for energy
 *   gain targets → lerp 0.15                 — ONE smoothing for gains
 *   rotation spring → done in motionComposition.springToward only
 */
'use client';

import * as THREE from 'three';
import type { ExpressionState, ExpressionPrimitiveName } from './expressionMap';
import {
  EXPRESSION_ALLOWED,
  EXPRESSION_GAIN_MUL,
  EXPRESSION_HEAD_TIME_SCALE,
  EXPRESSION_PRIORITY,
  EXPRESSION_ENERGY_INFLUENCE,
  EXPRESSION_PRIMITIVE_BIAS,
  personaHeadOverride,
} from './expressionMap';
import type { CogniTeachingStance } from '@/lib/avatar/cogniPersonaStance';

const ALL_SHORT: ExpressionPrimitiveName[] = ['headNod', 'headTilt', 'headTurn'];

/** Per-primitive energy curve: `gain *= 0.4 + smoothedEnergy * profile[name]`. */
const ENERGY_PROFILE: Record<ExpressionPrimitiveName, number> = {
  headNod:  1.0,
  headTilt: 0.8,
  headTurn: 0.9,
};

// ─── Energy smoothing (ONE place, not propagated downstream) ─────────────────

const ENERGY_LERP = 0.12;
let _smoothedEnergy = 0.5;

function tickSmoothedEnergy(raw: number): number {
  const e = THREE.MathUtils.clamp(raw, 0, 1);
  _smoothedEnergy += (e - _smoothedEnergy) * ENERGY_LERP;
  return _smoothedEnergy;
}

// ─── Gain visibility + clamping ──────────────────────────────────────────────

/**
 * Gains below this threshold produce no visible motion — snap to 0.
 * Gains above ramp smoothly to a perceptible minimum, preventing micro-pulses.
 *
 * Lowered 0.05 → 0.02 so that secondary primitives (nod/turn in `thinking`)
 * survive the gate even during pause-floor frames
 * (bias × floor = 0.45 × 0.12 = 0.054, safe above 0.02).
 * The adaptive threshold in `smoothVisibilityFloor` handles per-call
 * energy-aware scaling on top.
 */
const GAIN_DEAD_ZONE  = 0.02;
/** Width of the smooth ramp above the dead zone (avoids the hard-edge pop). */
const GAIN_RAMP_WIDTH = 0.08;
/** Peak floor boost added at the top of the ramp (fades in with smoothstep). */
const GAIN_FLOOR_BOOST = 0.046;

/**
 * Energy-aware dead zone: wider in silence (filters noise), narrower during
 * speech (lets subtle motion through). Range empirically chosen so:
 *   silence (energy ≈ 0.20): dz ≈ 0.031 → small motions still filtered
 *   normal speech (energy ≈ 0.55): dz ≈ 0.024 → more primitives visible
 *   loud speech (energy ≈ 0.85): dz ≈ 0.018 → richer expressive motion
 *
 * Falls back to GAIN_DEAD_ZONE constant when energy is unknown (0).
 */
function computeAdaptiveDeadZone(energy: number): number {
  // Widened silence window slightly (MAX 0.04→0.028) so nod/tilt survive
  // during pause steps even in low-energy idle (energy ≈ 0.20):
  //   headNod masked = 0.285 × 0.18 = 0.051 > 0.0248 ✓
  //   headTilt masked = 0.312 × 0.18 = 0.056 > 0.0248 ✓
  const MIN_DZ = 0.012;  // was 0.015
  const MAX_DZ = 0.028;  // was 0.04
  const e = Math.min(1, Math.max(0, energy));
  return MAX_DZ - (MAX_DZ - MIN_DZ) * e;
}

/**
 * Replaces the old `next < 0.05 ? 0 : next + 0.03`.
 * Ramps from 0 → floorBoost via smoothstep so there is never a discontinuous
 * +0.03 jump that causes micro-pulsing on the gain boundary.
 * Uses an energy-aware dead zone so more motion passes through during speech.
 */
function smoothVisibilityFloor(g: number, gainMaxCap: number, energy = 0): number {
  const dz = computeAdaptiveDeadZone(energy);
  if (g < dz) return 0;
  const ramp = smoothstep01((g - dz) / GAIN_RAMP_WIDTH);
  return Math.min(g + GAIN_FLOOR_BOOST * ramp, gainMaxCap);
}

// ─── Priority hysteresis ──────────────────────────────────────────────────────

/**
 * When switching to a *lower* priority expression, require a longer hold.
 * Prevents chatty back-and-forth between e.g. `explaining` and `confirming`.
 */
const DOWNGRADE_HOLD_MUL = 2.2;

// ─── Adaptive hold ────────────────────────────────────────────────────────────

const MIN_HOLD_SEC = 1.2;
const MAX_HOLD_SEC = 3.0;

function dynamicHoldSec(energy: number): number {
  const e = THREE.MathUtils.clamp(energy, 0, 1);
  return MIN_HOLD_SEC + (1 - e) * (MAX_HOLD_SEC - MIN_HOLD_SEC);
}

function smoothstep01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ─── Transition + memory state ───────────────────────────────────────────────

let _committed: ExpressionState = 'neutral';
let _prevCommitted: ExpressionState = 'neutral';
let _lastSwitchSec = -1e9;
/** 0→1 after a committed expression change — drives gain / freq cross-fade. */
let _transition01 = 1;
const TRANSITION_SPEED = 3.2; // ~0.3s to settle at 60fps

// ─── Motion Variety Engine ───────────────────────────────────────────────────
//
// Motion variants are re-rolled on every committed expression change so two
// consecutive nods are never identical. All deterministic per commit (seed-free
// random is acceptable here — visual variety, not reproducible test fixtures).

/** Nod amplitude variants (multiplied onto the headNod gain). */
const NOD_VARIANTS = [
  { name: 'small',  mul: 0.70 },
  { name: 'medium', mul: 1.00 },
  { name: 'strong', mul: 1.40 },
] as const;
type NodVariant = (typeof NOD_VARIANTS)[number]['name'];

/** State chosen at every commit — survives until the next commit. */
type VariationState = {
  nodVariant: NodVariant;
  nodMul:     number;
  /** ±1 — multiplied onto headTilt anatomical roll. */
  tiltSign:   number;
  /** 0.90–1.10 — multiplied onto headTimeScale (±10% jitter). */
  timingJitter: number;
};

let _variation: VariationState = {
  nodVariant: 'medium',
  nodMul:     1.0,
  tiltSign:   1,
  timingJitter: 1.0,
};

function rollNewVariation(expr: ExpressionState): VariationState {
  // Pick nod variant. Bias slightly: emphasizing favors strong, listening favors small.
  let pickIdx: number;
  if (expr === 'emphasizing') {
    pickIdx = Math.random() < 0.55 ? 2 : (Math.random() < 0.7 ? 1 : 0); // strong bias
  } else if (expr === 'confirming') {
    pickIdx = Math.random() < 0.5 ? 1 : (Math.random() < 0.6 ? 2 : 0);  // medium bias
  } else if (expr === 'listening' || expr === 'neutral') {
    pickIdx = Math.random() < 0.6 ? 0 : 1;                               // small bias
  } else {
    pickIdx = Math.floor(Math.random() * NOD_VARIANTS.length);
  }
  const nv = NOD_VARIANTS[pickIdx]!;
  const tiltSign = Math.random() < 0.5 ? -1 : 1;
  const timingJitter = 0.90 + Math.random() * 0.20; // [0.90, 1.10]
  return {
    nodVariant: nv.name,
    nodMul: nv.mul,
    tiltSign,
    timingJitter,
  };
}

/** Read-only accessor — exported for primitives. */
export function getCurrentTiltSign(): number {
  return _variation.tiltSign;
}

/**
 * Human-readable primary motion for `[MOTION_SEMANTIC]` logging.
 * Note: the actual gain mix is multi-primitive — this is just the *signature* move.
 */
function expressionPrimaryMotion(expr: ExpressionState): 'nod' | 'tilt' | 'turn' | 'none' {
  switch (expr) {
    case 'emphasizing': return 'nod';
    case 'confirming':  return 'nod';
    case 'explaining':  return 'nod';   // slow nod with turn underneath
    case 'thinking':    return 'tilt';
    case 'listening':   return 'turn';
    case 'neutral':     return 'turn';  // subtle gaze drift
    default:            return 'none';
  }
}

/** Diagnostic snapshot. */
export function getVariationStateSnapshot(): Readonly<VariationState> {
  return { ..._variation };
}

// ─── Gain stabilisation (ONE lerp for gains; no downstream rotation re-lerp) ─

const GAIN_LERP = 0.15;
const _smoothedGains = new Map<string, number>([
  ['headNod',  0],
  ['headTilt', 0],
  ['headTurn', 0],
]);

function tickStabilisedGains(
  targets: Map<string, number>,
  gainMaxCap: number,
  energy: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of ALL_SHORT) {
    const target = targets.get(name) ?? 0;
    const prev   = _smoothedGains.get(name) ?? 0;
    const smoothedGain = prev + (target - prev) * GAIN_LERP;
    _smoothedGains.set(name, smoothedGain);
    out.set(name, smoothVisibilityFloor(smoothedGain, gainMaxCap, energy));
  }
  return out;
}

function resetTransitionState(): void {
  _committed = 'neutral';
  _prevCommitted = 'neutral';
  _lastSwitchSec = -1e9;
  _transition01 = 1;
  _smoothedEnergy = 0.5;
  for (const k of ALL_SHORT) _smoothedGains.set(k, 0);
  // Reset variety state so a fresh session does not inherit the previous tiltSign /
  // nodMul. Without this, primitives could read stale values for several seconds
  // before the first new commit re-rolls them.
  _variation = {
    nodVariant:   'medium',
    nodMul:       1.0,
    tiltSign:     1,
    timingJitter: 1.0,
  };
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExpressionHeadPlan = {
  /** Expression after memory gate (frozen until hold elapses). */
  committedExpression: ExpressionState;
  /** Raw mapper output this frame (before hold). */
  rawExpression: ExpressionState;
  /** Scale applied to `tSec` inside head primitives only. */
  headTimeScale: number;
  /**
   * shortName → final stabilised gain (0 = skip primitive).
   * These are already lerp-smoothed — do NOT re-lerp in downstream code.
   */
  primitiveGains: Map<string, number>;
  /** Smoothed energy used this tick (for diagnostics). */
  smoothedEnergy: number;
};

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Single call per frame: smooths energy, updates adaptive memory + gain
 * transition, returns head plan.
 *
 * Contract:
 * - Energy smoothed here only (don't re-lerp rawEnergy before passing).
 * - Gains lerped here only (springToward in motionComposition handles rotations).
 */
export function tickExpressionHeadMotionPlan(
  rawExpression: ExpressionState,
  rawEnergy: number,
  tSec: number,
  deltaSec: number,
  stance: CogniTeachingStance,
): ExpressionHeadPlan {
  const smoothedEnergy = tickSmoothedEnergy(rawEnergy);
  const hold = dynamicHoldSec(smoothedEnergy);

  const incomingPriority = EXPRESSION_PRIORITY[rawExpression];
  const committedPriority = EXPRESSION_PRIORITY[_committed];

  /**
   * Hysteresis: downgrading priority needs extra hold time to prevent oscillation.
   * Exception: returning to `neutral` (priority 0) is the natural settle path —
   * applying the 2.2× downgrade multiplier there made the avatar look "stuck
   * in thinking" for several seconds after the conversation ended. For the
   * neutral target we use the base hold only.
   */
  const isReturnToNeutral = rawExpression === 'neutral';
  const holdRequired =
    !isReturnToNeutral && incomingPriority < committedPriority
      ? hold * DOWNGRADE_HOLD_MUL
      : hold;

  const canOverride =
    rawExpression !== _committed &&
    tSec - _lastSwitchSec >= holdRequired &&
    (incomingPriority >= committedPriority || isReturnToNeutral);

  if (canOverride) {
    _prevCommitted = _committed;
    _committed = rawExpression;
    _lastSwitchSec = tSec;
    _transition01 = 0;
    // Motion variety: re-roll variants on every commit so consecutive nods/tilts vary.
    _variation = rollNewVariation(_committed);

    // [MOTION_SEMANTIC] — emitted on every committed expression change.
    // Maps committed expression → primary motion primitive for human readability.
    const motionPrim = expressionPrimaryMotion(_committed);
    // eslint-disable-next-line no-console -- semantic checkpoint (always-on, only fires on commit)
    console.log('[MOTION_SEMANTIC]', {
      detected: rawExpression,
      committed: _committed,
      motion: motionPrim,
      nodVariant: _variation.nodVariant,
      tiltSign: _variation.tiltSign,
      timingJitter: Number(_variation.timingJitter.toFixed(2)),
    });
  }

  _transition01 = Math.min(1, _transition01 + Math.max(0, deltaSec) * TRANSITION_SPEED);
  const tw = smoothstep01(_transition01);

  const persona = personaHeadOverride(stance);

  const gainsPrev = buildPrimitiveGainsForExpression(_prevCommitted, smoothedEnergy, persona);
  const gainsCurr = buildPrimitiveGainsForExpression(_committed,     smoothedEnergy, persona);

  const rawTargets = new Map<string, number>();
  for (const name of ALL_SHORT) {
    const a = gainsPrev.get(name) ?? 0;
    const b = gainsCurr.get(name) ?? 0;
    rawTargets.set(name, a + (b - a) * tw);
  }

  // ONE gain smoothing pass (lerp 0.15 + energy-aware visibility floor + persona cap)
  const primitiveGains = tickStabilisedGains(rawTargets, persona.gainMaxCap, smoothedEnergy);

  // Expression-specific energy influence on timeScale.
  // thinking (0.12): barely speeds up → intrinsic contemplative rhythm preserved.
  // emphasizing (0.44): responsive → feels energetic and social.
  const energyBoost   = 0.85 + smoothedEnergy * 0.3; // 0.85..1.15
  const influencePrev = EXPRESSION_ENERGY_INFLUENCE[_prevCommitted];
  const influenceCurr = EXPRESSION_ENERGY_INFLUENCE[_committed];
  const blendedInfluence = influencePrev + (influenceCurr - influencePrev) * tw;
  const energyTimeMul = 1.0 + blendedInfluence * (energyBoost - 1.0);

  const baseFreqPrev  = EXPRESSION_HEAD_TIME_SCALE[_prevCommitted] * persona.freqMul;
  const baseFreqCurr  = EXPRESSION_HEAD_TIME_SCALE[_committed]     * persona.freqMul;
  const baseTimeScale = baseFreqPrev + (baseFreqCurr - baseFreqPrev) * tw;
  // Apply ±10% timing jitter from current variation (re-rolled per commit).
  const headTimeScale = baseTimeScale * energyTimeMul * _variation.timingJitter;

  // Apply nod variant (small/medium/strong) to the headNod gain only.
  const headNodGain = primitiveGains.get('headNod') ?? 0;
  if (headNodGain > 0) {
    primitiveGains.set('headNod', Math.min(headNodGain * _variation.nodMul, persona.gainMaxCap));
  }

  return {
    committedExpression: _committed,
    rawExpression,
    headTimeScale,
    primitiveGains,
    smoothedEnergy,
  };
}

function buildPrimitiveGainsForExpression(
  expr: ExpressionState,
  smoothedEnergy: number,
  persona: ReturnType<typeof personaHeadOverride>,
): Map<string, number> {
  let allowed = [...EXPRESSION_ALLOWED[expr]];
  if (persona.blockHeadTilt) {
    allowed = allowed.filter((n) => n !== 'headTilt');
  }

  const exprMul = EXPRESSION_GAIN_MUL[expr] * persona.gainMul;
  const biasRow = EXPRESSION_PRIMITIVE_BIAS[expr];
  const out = new Map<string, number>();
  for (const name of ALL_SHORT) {
    /**
     * `bias === 0` is treated as "blocked" even if the primitive is in `allowed`.
     * This lets `EXPRESSION_PRIMITIVE_BIAS` fully control which primitives contribute
     * without forcing every expression to maintain a parallel allow-list.
     */
    const bias = biasRow[name];
    if (!allowed.includes(name) || bias <= 0) {
      out.set(name, 0);
      continue;
    }
    const prof = ENERGY_PROFILE[name];
    const energyScale = 0.46 + smoothedEnergy * prof;
    let g = exprMul * energyScale * bias;
    if (name === 'headNod') g *= persona.nodGainMul * persona.celebrateNodMul;
    if (name === 'headTilt') g *= persona.celebrateTiltMul;
    out.set(name, Math.min(g, persona.gainMaxCap));
  }
  return out;
}

/** Reset all expression motion memory (VRM load / session reset). */
export function resetExpressionMotionEngine(): void {
  resetTransitionState();
}

// ─── Legacy helper ────────────────────────────────────────────────────────────

export type ExpressionMotionEntry = {
  name: ExpressionPrimitiveName;
  gain: number;
};

export type ExpressionMotionResult = {
  expression: ExpressionState;
  primitives: ExpressionMotionEntry[];
  energy: number;
};

/** @deprecated Prefer {@link tickExpressionHeadMotionPlan}. */
export function selectExpressionMotions(
  expression: ExpressionState,
  energy: number,
  _tSec: number,
  personaMul = 1,
): ExpressionMotionResult {
  const names = EXPRESSION_ALLOWED[expression];
  const exprGain = EXPRESSION_GAIN_MUL[expression];
  const primitives: ExpressionMotionEntry[] = names.map((name) => ({
    name,
    gain:
      (0.46 + THREE.MathUtils.clamp(energy, 0, 1) * (ENERGY_PROFILE[name] ?? 1)) *
      exprGain *
      personaMul,
  }));
  return { expression, primitives, energy };
}
