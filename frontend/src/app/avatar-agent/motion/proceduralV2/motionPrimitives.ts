/**
 * Sin-normalized procedural primitives — each returns **anatomical** pitch/yaw/roll only.
 * Euler conversion happens once in {@link motionComposition} via {@link applyCalibratedAnatomicalDelta}.
 */
'use client';

import * as THREE from 'three';
import type { AnatomicalDelta } from './calibratedAnatomicalMotion';
import { getCurrentTiltSign } from '../expression/expressionMotionEngine';

export type { AnatomicalDelta } from './calibratedAnatomicalMotion';

export type ProceduralPrimitiveContext = {
  tSec: number;
  breathAmp01: number;
  breathFreqHz: number;
  motionSpeedMul: number;
  breathingMode: 'idle' | 'speaking' | 'thinking';
  headGazeYawRad: number;
  headGazePitchRad: number;
  neckPitchBiasRad: number;
  shoulderFreezeHealPitchRad: number;
  /**
   * Phase clock for head-layer sin waves only — set to `tSec * expressionHeadTimeScale`
   * so expression controls timing without touching bone axes.
   */
  headLayerPhaseT?: number;
  /**
   * Step-relative phase clock: `stepRelativeTimeSec * headTimeScale + phaseOffset`.
   *
   * When present, head-layer primitives use this instead of `headLayerPhaseT`.
   * Ensures each step ALWAYS starts at phase 0 + optional jitter, so:
   *   - headNod  → first motion is always downward (sin starts at 0, d/dt > 0)
   *   - headTilt → direction controlled by tiltSign (not arbitrary cycle position)
   *   - headTurn → starts near zero, avoids mid-cycle onset
   *
   * Value is set by `applyLayeredProceduralStack` from sequencer output each frame.
   */
  headStepPhaseT?: number;
};

/** Bone key → summed anatomical channels for this primitive layer */
export type AnatomicalDeltaMap = Map<string, AnatomicalDelta>;

const SHOULDER_LAG_SEC = 0.04;
const HEAD_BREATH_LAG_SEC = 0.08;
const TWO_PI = Math.PI * 2;

/**
 * Non-periodic wave composed of three incommensurable sin harmonics.
 * Replaces pure sin() for idle oscillations to remove robotic periodicity —
 * the resulting pattern never exactly repeats within a normal session window.
 */
function smoothNoise(t: number): number {
  return (
    Math.sin(t)         * 0.60 +
    Math.sin(t * 0.37)  * 0.25 +
    Math.sin(t * 0.13)  * 0.15
  );
}

function addA(m: AnatomicalDeltaMap, key: string, pitch: number, yaw: number, roll: number): void {
  const o = m.get(key) ?? { pitch: 0, yaw: 0, roll: 0 };
  o.pitch += pitch;
  o.yaw += yaw;
  o.roll += roll;
  m.set(key, o);
}

const CAP = {
  trunkPitch:     0.012,
  trunkYaw:       0.004,
  trunkRoll:      0.0035,
  neckPitch:      0.010,
  neckYaw:        0.003,
  neckRoll:       0.0025,
  headNod:        0.011,
  headTilt:       0.0082,
  headTurnSin:    0.0046,
  shoulderRoll:   0.006,
} as const;

export function primitiveTorsoCoupledArmSway(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * ctx.breathFreqHz;
  const env = THREE.MathUtils.clamp(ctx.breathAmp01, 0, 1.8) * THREE.MathUtils.clamp(ctx.motionSpeedMul, 0.35, 1.35);
  const ph = Math.sin((ctx.tSec - SHOULDER_LAG_SEC) * w) * env;
  const a = 0.00105 * env;
  addA(out, 'lua', ph * a * 0.95, 0, ph * a * 1.1);
  addA(out, 'rua', ph * a * 0.88, 0, ph * a * 1.04);
  return out;
}

export function primitiveBreathing(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * ctx.breathFreqHz;
  const env = THREE.MathUtils.clamp(ctx.breathAmp01, 0, 1.8) * THREE.MathUtils.clamp(ctx.motionSpeedMul, 0.35, 1.35);
  let phase = Math.sin(ctx.tSec * w) * env;
  if (ctx.breathingMode === 'thinking') {
    phase += 0.35 * Math.sin(ctx.tSec * w * 1.618 + 0.7) * env;
  }
  phase = THREE.MathUtils.clamp(phase, -1.2, 1.2);
  const shoulderPhase = Math.sin((ctx.tSec - SHOULDER_LAG_SEC) * w) * env;
  const headPhase = Math.sin((ctx.tSec - HEAD_BREATH_LAG_SEC) * w) * env * 0.22;

  const trunkPitch = phase * CAP.trunkPitch * -1;
  const shoulderRoll = shoulderPhase * CAP.shoulderRoll;
  const neckPitch = headPhase * CAP.neckPitch + ctx.neckPitchBiasRad * 0.85;

  addA(out, 'spine', trunkPitch * 0.52, 0, phase * CAP.trunkRoll * 0.4);
  addA(out, 'chest', trunkPitch * 0.95, 0, phase * CAP.trunkRoll * 0.35);
  addA(out, 'leftShoulder', 0, 0, shoulderRoll);
  addA(out, 'rightShoulder', 0, 0, shoulderRoll);
  addA(out, 'neck', neckPitch, 0, headPhase * CAP.neckRoll * 0.35);
  /** Head motion comes only from {@link PROCEDURAL_HEAD_LAYER} so base breath does not cancel nod/tilt/turn. */
  return out;
}

export function primitiveHeadNod(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * ctx.breathFreqHz * 1.07;
  const env = THREE.MathUtils.clamp(ctx.breathAmp01, 0, 1.5) * THREE.MathUtils.clamp(ctx.motionSpeedMul, 0.35, 1.35);
  // Prefer headStepPhaseT (phase-reset per step) when available.
  // headStepPhaseT = 0 at step start → sin(0) = 0, d/dt positive → first motion is DOWNWARD.
  // phaseOffset ±0.3π adds variety while keeping cos(offset) > 0 (direction preserved).
  // headLayerPhaseT (expression-scaled abs time) is the fallback for continuous mode.
  const t = ctx.headStepPhaseT ?? ctx.headLayerPhaseT ?? ctx.tSec;
  const s = Math.sin(t * w);
  addA(out, 'head', s * CAP.headNod * env * 0.65, 0, 0);
  return out;
}

export function primitiveHeadTilt(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * 0.37;
  const env = THREE.MathUtils.clamp(ctx.breathAmp01, 0, 1.4) * 0.45;
  // tiltSign (±1) from expressionMotionEngine controls LEFT vs RIGHT.
  // With headStepPhaseT: sin(0) = 0 at step start → roll grows toward ±tiltSign.
  // The direction of the initial move is always determined by tiltSign, not arbitrary cycle.
  const t = ctx.headStepPhaseT ?? ctx.headLayerPhaseT ?? ctx.tSec;
  const tiltSign = getCurrentTiltSign();
  const roll = Math.sin(t * w) * CAP.headTilt * env * tiltSign;
  addA(out, 'head', 0, 0, roll);
  addA(out, 'neck', 0, 0, roll * 0.22);
  return out;
}

export function primitiveHeadTurn(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * 0.18;
  // headStepPhaseT ensures tremor starts from zero displacement at step onset,
  // then smoothly drifts toward the gaze target. Avoids mid-cycle "jump-to-position."
  const t = ctx.headStepPhaseT ?? ctx.headLayerPhaseT ?? ctx.tSec;
  /** Micro-tremor: lower freq (10×t) anchored to step time to avoid nervous jitter on restart. */
  const tremor = Math.sin(t * w) * CAP.headTurnSin * 0.22 * THREE.MathUtils.clamp(ctx.motionSpeedMul, 0.4, 1.2);
  const microT = Math.sin(t * 10) * 0.01;
  addA(
    out,
    'head',
    ctx.headGazePitchRad + tremor * 0.12 + microT * 0.06,
    ctx.headGazeYawRad  + tremor * 0.15 + microT * 0.08,
    0,
  );
  return out;
}

export function primitiveShoulderShift(ctx: ProceduralPrimitiveContext): AnatomicalDeltaMap {
  const out: AnatomicalDeltaMap = new Map();
  const w = TWO_PI * 0.29;
  const env = THREE.MathUtils.clamp(ctx.breathAmp01, 0, 1.4) * THREE.MathUtils.clamp(ctx.motionSpeedMul, 0.35, 1.35);
  // smoothNoise instead of pure sin — shoulder sway now avoids exact-period loops
  const roll = smoothNoise(ctx.tSec * w + 0.55) * CAP.shoulderRoll * 0.55 * env;
  const fh = ctx.shoulderFreezeHealPitchRad;
  addA(out, 'leftShoulder', fh, 0, roll);
  addA(out, 'rightShoulder', -fh * 0.9, 0, roll);
  return out;
}

export type ProceduralPrimitiveFn = (ctx: ProceduralPrimitiveContext) => AnatomicalDeltaMap;

/** Breathing + torso sway + shoulders — no direct `head` delta (head layer owns that). */
export const PROCEDURAL_BASE_LAYER: ProceduralPrimitiveFn[] = [
  primitiveBreathing,
  primitiveTorsoCoupledArmSway,
  primitiveShoulderShift,
];

export const PROCEDURAL_HEAD_LAYER: ProceduralPrimitiveFn[] = [
  primitiveHeadNod,
  primitiveHeadTilt,
  primitiveHeadTurn,
];

export const DEFAULT_PROCEDURAL_STACK: ProceduralPrimitiveFn[] = [
  ...PROCEDURAL_BASE_LAYER,
  ...PROCEDURAL_HEAD_LAYER,
];
