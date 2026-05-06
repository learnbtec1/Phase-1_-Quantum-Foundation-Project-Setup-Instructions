/**
 * Compose procedural primitives, spring-smooth euler deltas, apply to bone pose map.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from '@/app/avatar-agent/motion/PoseComposer';
import { isPoseKeyProcedurallySuppressed } from '@/app/avatar-agent/motion/proceduralSuppressionContext';
import {
  ANATOMICAL_LIMITS_HEAD_RAD,
  ANATOMICAL_LIMITS_NECK_RAD,
  ANATOMICAL_LIMITS_TRUNK_RAD,
  ANATOMICAL_LIMITS_CLAVICLE_RAD,
  ANATOMICAL_LIMITS_LUA_RAD,
  ANATOMICAL_LIMITS_RUA_RAD,
  type AnatomicalEulerLimitBox,
} from '@/app/avatar-agent/kinematicStandards';
import {
  PROCEDURAL_BASE_LAYER,
  PROCEDURAL_HEAD_LAYER,
  type ProceduralPrimitiveContext,
  type ProceduralPrimitiveFn,
} from './motionPrimitives';
import type { AnatomicalDelta } from './calibratedAnatomicalMotion';
import { applyCalibratedAnatomicalDelta } from './calibratedAnatomicalMotion';
import { isDebugMotion, logDebug, logDebugThrottled } from '@/lib/logging/runtimeLog';
import { mapIntentToExpression } from '../expression/expressionMap';
import {
  tickExpressionHeadMotionPlan,
  resetExpressionMotionEngine,
} from '../expression/expressionMotionEngine';
import {
  tickMotionSequencer,
  resetMotionSequencer,
} from './motionSequencer';
import { getEmbodimentState } from '@/lib/avatar/embodimentState';
import { getSmoothedUnifiedEnergy } from '@/lib/avatar/unifiedEnergyModel';
import { getCogniTeachingStance } from '@/lib/avatar/cogniPersonaStance';
import { recordContinuousMotionActivity } from '@/lib/behavior/behaviorMotionBrain';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

const LIMIT_BY_BONE: Record<string, AnatomicalEulerLimitBox> = {
  head:            ANATOMICAL_LIMITS_HEAD_RAD,
  neck:            ANATOMICAL_LIMITS_NECK_RAD,
  spine:           ANATOMICAL_LIMITS_TRUNK_RAD,
  chest:           ANATOMICAL_LIMITS_TRUNK_RAD,
  leftShoulder:    ANATOMICAL_LIMITS_CLAVICLE_RAD,
  rightShoulder:   ANATOMICAL_LIMITS_CLAVICLE_RAD,
  lua:             ANATOMICAL_LIMITS_LUA_RAD,
  rua:             ANATOMICAL_LIMITS_RUA_RAD,
  leftUpperArm:    ANATOMICAL_LIMITS_LUA_RAD,
  rightUpperArm:   ANATOMICAL_LIMITS_RUA_RAD,
};

export type EulerDeltaMap = Map<string, THREE.Vector3>;

/** Max euler step per frame as fraction of anatomical span (per axis). */
const DELTA_FRACTION = 0.045;

/** Weighted blend for neck between base-breath contribution and head-layer contribution. */
const NECK_HEAD_WEIGHT = 0.4; // 0.6 base + 0.4 head

function clampEulerDeltaToAnatomy(v: THREE.Vector3, box: AnatomicalEulerLimitBox): void {
  const sx = (box.maxX - box.minX) * DELTA_FRACTION;
  const sy = (box.maxY - box.minY) * DELTA_FRACTION;
  const sz = (box.maxZ - box.minZ) * DELTA_FRACTION;
  v.x = THREE.MathUtils.clamp(v.x, -sx, sx);
  v.y = THREE.MathUtils.clamp(v.y, -sy, sy);
  v.z = THREE.MathUtils.clamp(v.z, -sz, sz);
}

export function composeMotion(
  primitives: ProceduralPrimitiveFn[],
  ctx: ProceduralPrimitiveContext,
): EulerDeltaMap {
  const acc = new Map<string, AnatomicalDelta>();
  for (const fn of primitives) {
    for (const [bone, d] of fn(ctx)) {
      const cur = acc.get(bone) ?? { pitch: 0, yaw: 0, roll: 0 };
      cur.pitch += d.pitch;
      cur.yaw += d.yaw;
      cur.roll += d.roll;
      acc.set(bone, cur);
    }
  }
  const euler = new Map<string, THREE.Vector3>();
  for (const [bone, d] of acc) {
    euler.set(bone, applyCalibratedAnatomicalDelta(bone, d));
  }
  return euler;
}

// ─── Head layer constants ─────────────────────────────────────────────────────

/**
 * Nod / tilt / turn base gain in anatomical space.
 * Asymmetry (TASK 5): turn × 0.85, tilt × 0.90 so head prioritises pitch
 * (nod) over yaw, matching natural conversation biomechanics.
 */
const HEAD_PRIMITIVE_GAIN: Record<string, number> = {
  primitiveHeadNod:  2.5,
  primitiveHeadTilt: 1.80,  // was 2.0 (×0.9 asymmetry)
  primitiveHeadTurn: 1.53,  // was 1.8 (×0.85 asymmetry)
};

/** Default per-primitive short-name gain (expression engine multiplies on top). */
const EXPRESSION_PRIMITIVE_GAIN: Record<string, number> = {
  headNod:  1.0,
  headTilt: 1.0,
  headTurn: 1.0,
};

// ─── Internal composition helpers ────────────────────────────────────────────

function dominantAnatomicalAxis(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}

function composeBaseLayerAnatomical(
  stack: ProceduralPrimitiveFn[],
  ctx: ProceduralPrimitiveContext,
): Map<string, AnatomicalDelta> {
  const acc = new Map<string, AnatomicalDelta>();
  for (const fn of stack) {
    for (const [bone, d] of fn(ctx)) {
      const cur = acc.get(bone) ?? { pitch: 0, yaw: 0, roll: 0 };
      cur.pitch += d.pitch;
      cur.yaw += d.yaw;
      cur.roll += d.roll;
      acc.set(bone, cur);
    }
  }
  return acc;
}

/**
 * Merge head primitives without blind same-axis sum.
 * Keeps the larger anatomical magnitude per axis; applies expression gain.
 */
function composeHeadLayerAnatomicalDominant(
  stack: ProceduralPrimitiveFn[],
  ctx: ProceduralPrimitiveContext,
  expressionGains?: Map<string, number>,
): Map<string, AnatomicalDelta> {
  const acc = new Map<string, AnatomicalDelta>();
  for (const fn of stack) {
    const baseGain = HEAD_PRIMITIVE_GAIN[fn.name] ?? 1;
    // Strip "primitive" prefix + lower-case first char → short key (e.g. "headNod")
    const shortName = fn.name.replace(/^primitive(.+)$/, (_, s: string) => s.charAt(0).toLowerCase() + s.slice(1));
    const exprGain =
      expressionGains === undefined
        ? (EXPRESSION_PRIMITIVE_GAIN[shortName] ?? 1)
        : (expressionGains.get(shortName) ?? 0);
    if (exprGain <= 0) continue;
    const gain = baseGain * exprGain;
    for (const [bone, d] of fn(ctx)) {
      const pitched = d.pitch * gain;
      const yawed   = d.yaw   * gain;
      const rolled  = d.roll  * gain;
      const cur = acc.get(bone) ?? { pitch: 0, yaw: 0, roll: 0 };
      acc.set(bone, {
        pitch: dominantAnatomicalAxis(cur.pitch, pitched),
        yaw:   dominantAnatomicalAxis(cur.yaw,   yawed),
        roll:  dominantAnatomicalAxis(cur.roll,  rolled),
      });
    }
  }
  return acc;
}

function mergeEulerWeighted(
  base: THREE.Vector3,
  overlay: THREE.Vector3,
  w: number,
): THREE.Vector3 {
  const iw = 1 - w;
  return new THREE.Vector3(
    base.x * iw + overlay.x * w,
    base.y * iw + overlay.y * w,
    base.z * iw + overlay.z * w,
  );
}

const _neckBase    = new THREE.Vector3();
const _neckOverlay = new THREE.Vector3();

// ─── Public composition API ───────────────────────────────────────────────────

/**
 * Base layer (breath + torso + shoulders) summed; head layer wins on `head`;
 * neck blends 60% base / 40% head (prevents jitter).
 * Expression gains scale head primitives based on intent + energy.
 */
export function composeLayeredProceduralDeltas(
  ctx: ProceduralPrimitiveContext,
  expressionGains?: Map<string, number>,
): EulerDeltaMap {
  const baseAnat = composeBaseLayerAnatomical(PROCEDURAL_BASE_LAYER, ctx);
  const headAnat = composeHeadLayerAnatomicalDominant(PROCEDURAL_HEAD_LAYER, ctx, expressionGains);

  const euler = new Map<string, THREE.Vector3>();

  for (const [bone, d] of baseAnat) {
    if (bone === 'head') continue;
    euler.set(bone, applyCalibratedAnatomicalDelta(bone, d));
  }

  for (const [bone, d] of headAnat) {
    if (bone === 'neck') {
      const existingNeck = euler.get('neck');
      if (existingNeck) _neckBase.copy(existingNeck);
      else _neckBase.set(0, 0, 0);
      applyCalibratedAnatomicalDelta('neck', d, _neckOverlay);
      euler.set('neck', mergeEulerWeighted(_neckBase, _neckOverlay, NECK_HEAD_WEIGHT));
      continue;
    }
    if (bone === 'head') {
      euler.set('head', applyCalibratedAnatomicalDelta('head', d));
    }
  }

  return euler;
}

// ─── Spring smoothing ─────────────────────────────────────────────────────────

const smoothed = new Map<string, THREE.Vector3>();
const LAMBDA_BASE = 14;
/** λ=20 — responsive for head/neck, smooth enough to avoid jitter. */
const LAMBDA_HEAD = 20;

function proceduralSmoothingLambda(bone: string): number {
  return bone === 'head' || bone === 'neck' ? LAMBDA_HEAD : LAMBDA_BASE;
}

/**
 * NO-DOUBLE-SMOOTH CONTRACT:
 * - Expression gains are already lerp(0.15)-stabilised in `expressionMotionEngine`.
 * - Raw energy is already lerp(0.12)-smoothed in `expressionMotionEngine`.
 * - This function is the SOLE rotation-space smoothing in the pipeline.
 *   Do NOT add lerp/smooth calls on the same signal anywhere upstream.
 */

/** Throttle `[MOTION_SELECTED]` diag log. */
let lastProceduralStackDiagLogMs = 0;

function springToward(
  target: THREE.Vector3,
  key: string,
  dt: number,
  lambda: number,
): THREE.Vector3 {
  let s = smoothed.get(key);
  if (!s) {
    s = target.clone();
    smoothed.set(key, s);
    return s;
  }
  const t = 1 - Math.exp(-lambda * Math.min(0.1, Math.max(0, dt)));
  s.lerp(target, t);
  return s;
}

// ─── Anticipation state (avatar:speak:anticipation) ──────────────────────────
let _anticipationBoost = 0;
let _anticipationActive = false;
if (typeof window !== 'undefined') {
  window.addEventListener('avatar:speak:anticipation', () => {
    _anticipationBoost = 0.18;
    _anticipationActive = true;
  });
}

/** Multi-harmonic noise — non-periodic idle oscillation (no exact repeat). */
function smoothNoise(t: number): number {
  return Math.sin(t) * 0.60 + Math.sin(t * 0.37) * 0.25 + Math.sin(t * 0.13) * 0.15;
}

export function resetProceduralMotionSmoother(): void {
  smoothed.clear();
  resetExpressionMotionEngine();
  resetMotionSequencer();
}

// ─── Apply composed deltas ────────────────────────────────────────────────────

export function applyComposedProceduralMotion(
  finalPose: BonePoseMap,
  deltas: EulerDeltaMap,
  safeDelta: number,
  debugBoneRot: boolean,
  /** Adaptive head λ — varies from LAMBDA_HEAD-6 (low energy) to LAMBDA_HEAD+4 (high). */
  headLambdaOverride?: number,
): void {
  for (const [bone, raw] of deltas) {
    const box = LIMIT_BY_BONE[bone];
    if (!box) continue;
    const clamped = raw.clone();
    clampEulerDeltaToAnatomy(clamped, box);
    const lambda =
      bone === 'head' || bone === 'neck'
        ? (headLambdaOverride ?? LAMBDA_HEAD)
        : LAMBDA_BASE;
    const sm = springToward(clamped, bone, safeDelta, lambda);
    if (debugBoneRot && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console -- intentional procedural debug
      console.log('[BONE ROT]', bone, { x: sm.x, y: sm.y, z: sm.z, order: 'YXZ' });
    }
    if (isPoseKeyProcedurallySuppressed(bone)) continue;
    const q = finalPose.get(bone);
    if (!q) continue;
    _e.set(sm.x, sm.y, sm.z, 'YXZ');
    _qDelta.setFromEuler(_e);
    _qOut.copy(q).multiply(_qDelta);
    finalPose.set(bone, _qOut.clone());
  }
}

// ─── Full pipeline wrappers ───────────────────────────────────────────────────

/** Throttle [PROCEDURAL EXECUTED] so it logs ~once per second at most. */
let _lastProceduralExecutedLogMs = 0;

/** Full pipeline: flat primitive stack → compose → smooth → multiply pose. */
export function applyProceduralPrimitiveStack(
  finalPose: BonePoseMap,
  ctx: ProceduralPrimitiveContext,
  stack: ProceduralPrimitiveFn[],
  safeDelta: number,
): void {
  const debug =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_BONE_ROT === 'true';
  if (isDebugMotion()) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastProceduralStackDiagLogMs >= 900) {
      lastProceduralStackDiagLogMs = now;
      logDebug(
        'MOTION',
        () => {
          const labels = stack.map((f) => f.name || 'anonymous');
          return `[MOTION_SELECTED] proceduralStack:${labels.join('+')}`;
        },
      );
    }
  }
  const composed = composeMotion(stack, ctx);
  applyComposedProceduralMotion(finalPose, composed, safeDelta, debug);
}

function logProceduralLayerDiag(committed: string, raw: string): void {
  if (!isDebugMotion()) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastProceduralStackDiagLogMs >= 900) {
    lastProceduralStackDiagLogMs = now;
    logDebug(
      'MOTION',
      () => {
        const base = PROCEDURAL_BASE_LAYER.map((f) => f.name || 'anon').join('+');
        const head = PROCEDURAL_HEAD_LAYER.map((f) => f.name || 'anon').join('+');
        return `[MOTION_SELECTED] proceduralLayered:committed[${committed}]raw[${raw}]|base[${base}]|head[${head}]`;
      },
    );
  }
}

/**
 * Humanization pipeline:
 * 1. Reads intent + behaviorMode from embodiment state.
 * 2. Maps to an ExpressionState.
 * 3. Expression **authority**: adaptive hold + cross-fade + persona overrides.
 * 4. Composes layered deltas (allowed head primitives only; neck weighted blend).
 * 5. Spring-smooths + applies to finalPose quaternions.
 */
export function applyLayeredProceduralStack(
  finalPose: BonePoseMap,
  ctx: ProceduralPrimitiveContext,
  safeDelta: number,
): void {
  const debug =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_BONE_ROT === 'true';

  // ── Resolve raw expression from embodiment ─────────────────────────────────
  const emb = getEmbodimentState();
  const energy = getSmoothedUnifiedEnergy();
  const rawExpression = mapIntentToExpression(
    emb.intent.activeIntent,
    emb.behaviorMode,
    {
      emphasis:    emb.hints.emphasis,
      question:    emb.hints.question,
      explanation: emb.hints.explanation,
      attention:   emb.hints.attention   ?? 0,
      thinkingCue: emb.hints.thinkingCue ?? 0,
    },
  );

  const stance = getCogniTeachingStance();
  const plan = tickExpressionHeadMotionPlan(rawExpression, energy, ctx.tSec, safeDelta, stance);

  // Adaptive head λ: low energy → 14 (damped, gentle); high energy → 24 (crisp, responsive)
  const headLambda = 14 + THREE.MathUtils.clamp(plan.smoothedEnergy, 0, 1) * 10;

  logProceduralLayerDiag(plan.committedExpression, plan.rawExpression);

  // ── Motion Sequencer: temporal mask + phase reset ─────────────────────────
  // Breaks continuous sin output into human-like sequences (move → pause → move).
  // Also provides step-relative timing + per-step phase offset for phase-reset.
  const seq = tickMotionSequencer(
    plan.committedExpression,
    ctx.tSec,
    emb.speech.syllablePulse,
  );

  // headStepPhaseT = step-relative time (sec) × expression speed + phase offset.
  // = 0 at step start → sin(phaseOffset) small, direction determined by sign.
  // headLayerPhaseT (expression-scaled abs clock) is still set as legacy fallback.
  const headStepPhaseT = seq.stepRelativeTimeSec * plan.headTimeScale + seq.stepPhaseOffset;

  const ctxHead: ProceduralPrimitiveContext = {
    ...ctx,
    headLayerPhaseT: ctx.tSec * plan.headTimeScale,
    headStepPhaseT,
  };
  const maskedGains = new Map<string, number>();
  for (const [name, gain] of plan.primitiveGains) {
    const m =
      name === 'headNod'  ? seq.mask.headNod  :
      name === 'headTilt' ? seq.mask.headTilt :
      name === 'headTurn' ? seq.mask.headTurn :
      1;
    maskedGains.set(name, gain * m);
  }

  // ── Anticipation decay (per-frame; event resets _anticipationBoost to 0.18) ─
  if (_anticipationActive) {
    if (_anticipationBoost > 0.005) {
      _anticipationBoost *= 0.88;  // decays over ~10 frames at 60 fps
    } else {
      _anticipationBoost = 0;
      _anticipationActive = false;
    }
  }
  // ── Energy coupling + anticipation applied to masked gains ────────────────
  const _eBoost = 0.6 + plan.smoothedEnergy * 0.7;
  const _totalBoost = _eBoost * (1 + _anticipationBoost);
  for (const [_k, _g] of maskedGains) maskedGains.set(_k, _g * _totalBoost);

  const composed = composeLayeredProceduralDeltas(ctxHead, maskedGains);

  // ── Head → chest anatomical coupling (subtle follow-through) ─────────────
  const _hd = composed.get('head');
  const _cd = composed.get('chest');
  if (_hd && _cd) {
    _cd.x += _hd.x * 0.12;  // nod  → chest pitch
    _cd.y += _hd.y * 0.08;  // turn → chest yaw (clamped by clampEulerDeltaToAnatomy)
    _cd.z += _hd.z * 0.05;  // tilt → chest roll
  }
  // ── Micro-fidget (silence only; neutral / listening expressions) ──────────
  if (!emb.speech.active &&
      (plan.committedExpression === 'neutral' || plan.committedExpression === 'listening')) {
    const _fidget = smoothNoise(ctx.tSec * 0.7) * 0.002 + smoothNoise(ctx.tSec * 1.3) * 0.001;
    if (_hd) _hd.x += _fidget;
  }

  applyComposedProceduralMotion(finalPose, composed, safeDelta, debug, headLambda);

  {
    const embW = getEmbodimentState();
    const gainVals = [...maskedGains.values()].filter((v) => typeof v === 'number' && Number.isFinite(v));
    const exprProxy =
      gainVals.length > 0
        ? THREE.MathUtils.clamp(gainVals.reduce((a, b) => a + b, 0) / 2.85, 0, 1.15)
        : 0;
    const baseProxy = THREE.MathUtils.clamp(
      ctx.breathAmp01 * 0.38 + ctx.motionSpeedMul * 0.24,
      0.08,
      1,
    );
    const speechProxy = embW.speech.active
      ? THREE.MathUtils.clamp(0.22 + embW.speech.energy * 0.7, 0, 1)
      : 0.1;
    logDebugThrottled(
      'MOTION',
      'motion-layer-weight',
      900,
      '[MOTION_LAYER_WEIGHT]',
      {
        base: Number(baseProxy.toFixed(3)),
        expression: Number(exprProxy.toFixed(3)),
        speech: Number(speechProxy.toFixed(3)),
      },
    );
  }

  // [PROCEDURAL EXECUTED] — always-on checkpoint, throttled to ~1/s so it's visible without flood.
  const _nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (_nowMs - _lastProceduralExecutedLogMs >= 1000) {
    _lastProceduralExecutedLogMs = _nowMs;
    // eslint-disable-next-line no-console -- motion pipeline checkpoint (always-on)
    console.log('[PROCEDURAL EXECUTED]', {
      expression: plan.committedExpression,
      step: seq.step,
      t01: Number(seq.t01.toFixed(3)),
      envelope: Number(seq.envelope.toFixed(3)),
      energy: Number(plan.smoothedEnergy.toFixed(3)),
      gains: Object.fromEntries(maskedGains),
      tSec: Number(ctx.tSec.toFixed(2)),
    });
  }

  // FORENSIC_CP: طبقة الرأس/الصدر الإجرائية ≠ إيماءات الذراع؛ يجب أن يحدِّث ساعة النشاط المستمر
  // حتى لا يظهر [MOTION] NO MOTION FOR TOO LONG بينما الحركة ظاهرة على الرأس.
  if (
    seq.envelope > 0.035 ||
    plan.smoothedEnergy > 0.22 ||
    [...maskedGains.values()].some((v) => v > 0.08)
  ) {
    recordContinuousMotionActivity();
  }
}
