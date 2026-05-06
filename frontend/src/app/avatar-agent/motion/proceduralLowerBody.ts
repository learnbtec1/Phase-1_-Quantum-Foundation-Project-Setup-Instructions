'use client';

/**
 * proceduralLowerBody.ts
 * ───────────────────────────────────────────────────────────────────────────
 * Idle-aware procedural movement for the lower-body humanoid chain on a VRM
 * 1.0 rig.  Runs AFTER `vrm.update(delta)` so its writes cannot be erased by
 * the VRM heartbeat.
 *
 * API surface:
 *   • `computeProceduralLowerBody(ctx) → LowerBodyState`
 *       Pure function — produces per-bone Euler deltas + a hips position
 *       offset.  No scene mutation.
 *   • `applyLowerBodyState(vrm, state)`
 *       Applies the state additively to the VRM normalized humanoid:
 *       `bone.rotation.x += dx` (and `.position.x += dx` for hips offset).
 *   • `applyProceduralLowerBody(vrm, opts)`
 *       Backward-compatible all-in-one: compute + apply in one call.
 *   • `resetProceduralLowerBody()`
 *       Clears smoothing state (e.g. on speech-end / hot reload).
 *
 * Features:
 *   • Idle weight shift   — slow sinusoidal hip roll + lateral X-position
 *                            sway (~6 s period, ±0.05 rad / ±0.005 m).
 *   • Speech engagement   — small forward hip lean + spine pitch when
 *                            speaking; reinforced for explaining / emphasizing.
 *   • Leg compensation    — counter-rotates upper legs and feet on Z so the
 *                            sole stays parallel to the floor when hips roll.
 *   • Subtle knee breath  — ~0.7° asymmetric L/R flex jitter.
 *
 * Performance:
 *   • Two `Math.sin` calls per frame; no per-frame allocations (state object
 *     is the only outward write — its Eulers / Vector3 are stack-friendly).
 *   • Branches early when `vrm.humanoid` is missing.
 *
 * Coordinate convention (post +Z-Forward refactor):
 *   +Z forward, +Y up, +X right.  All rotation deltas use YXZ order.
 *
 * IMPORTANT — floor-lock interaction:
 *   `floorLockV121.ts` enforces `vrm.scene.position = (0, 0, 0)` and
 *   `vrm.scene.quaternion = identity`, but does NOT touch the `hips` bone's
 *   local position.  Adding to `hips.position` is safe.
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ── Public types ──────────────────────────────────────────────────────────

export type LowerBodyContext = {
  /** Monotonic clock seconds (e.g. `performance.now() * 0.001`). */
  time: number;
  /** True while uttering speech. */
  speaking: boolean;
  /** Active intent label (e.g. `'explaining'`). */
  intent: string;
  /** 0..1 — speech energy or intent intensity (caller decides). */
  intensity: number;
};

export type LowerBodyState = {
  /** Hips local-position delta (X sway, Y micro-breath, Z forward lean). */
  hipsOffset:        THREE.Vector3;
  /** Hips rotation delta (X = pitch lean, Z = roll weight shift). */
  hipsRot:           THREE.Euler;
  /** Spine forward-lean rotation delta (X = pitch). */
  spineLean:         THREE.Euler;
  /** Upper-leg counter-rotation deltas (mostly Z to compensate hip roll). */
  leftUpperLegRot:   THREE.Euler;
  rightUpperLegRot:  THREE.Euler;
  /** Lower-leg subtle flex deltas (asymmetric L/R). */
  leftLowerLegRot:   THREE.Euler;
  rightLowerLegRot:  THREE.Euler;
  /** Foot counter-rotation deltas (close the kinematic chain). */
  leftFootRot:       THREE.Euler;
  rightFootRot:      THREE.Euler;
  /** Diagnostic scalars (signed, radians / metres). */
  weightShift:       number;
  lean:              number;
  kneeFlex:          number;
};

export type LowerBodyOptions = {
  speaking: boolean;
  intent: string;
  energy: number;
  timeSec: number;
  enabled?: boolean;
};

// ── Constants (perceptual tuning) ──────────────────────────────────────────
const SHIFT_FREQ_HZ           = 1 / 6;
const SHIFT_AMP_RAD           = 0.05;
const SHIFT_AMP_POS           = 0.005;
const SHIFT_LERP_K            = 0.05;

const LEAN_SPEAK_RAD          = -0.03;
const LEAN_INTENSITY_GAIN     = -0.04;
const LEAN_EXPLAIN_FLOOR      = -0.06;
const LEAN_LERP_K             = 0.06;
const LEAN_Z_POS_GAIN         = 0.004;

const SPINE_LEAN_FACTOR       = 0.55;

const LEG_COMPENSATION_FACTOR = 0.7;
const FOOT_COMPENSATION_FACTOR = 1.0;
const KNEE_FLEX_AMP_RAD       = 0.012;
const HIP_BREATH_Y_AMP        = 0.0015;

// ── Module-scope smoothing state ───────────────────────────────────────────
let _lastWeightShift = 0;
let _lastLean        = 0;

// One-time hips rest-pose capture (to keep absolute-set position safe — we
// never overwrite the rig's authored hips height with 0).
let _hipsRestX: number | null = null;
let _hipsRestY: number | null = null;
let _hipsRestZ: number | null = null;

// Stability monitor — sliding max of |rotation| across lower-body bones.
// Logged every 2 s; warns if any bone exceeds the runaway threshold.
let _maxRotMagSince = 0;
let _lastStabilityLogMs = -Infinity;
const STABILITY_LOG_MS = 2000;
const STABILITY_RUNAWAY_RAD = 0.45; // ≈ 26° — well above any expected steady-state.

let _rotationModeLogged = false;

// Scratch (no allocations per frame for the apply path).
const _eulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');

function _normIntent(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

// ── Pure compute (no scene mutation) ───────────────────────────────────────

/**
 * Compute the procedural lower-body deltas for this frame.
 *
 * Pure: only mutates module-scope smoothing state and returns a new state
 * object.  Caller is responsible for applying it via `applyLowerBodyState`.
 */
export function computeProceduralLowerBody(ctx: LowerBodyContext): LowerBodyState {
  const t        = ctx.time;
  const intent   = _normIntent(ctx.intent);
  const energy01 = Math.max(0, Math.min(1, ctx.intensity));

  // Idle weight shift — slow sinusoidal hip roll + lateral X sway.
  const shiftPhase  = t * SHIFT_FREQ_HZ * 2 * Math.PI;
  const targetShift = Math.sin(shiftPhase) * SHIFT_AMP_RAD;
  _lastWeightShift += (targetShift - _lastWeightShift) * SHIFT_LERP_K;

  // Speech engagement — forward lean (negative X-pitch, since forward = +Z).
  let targetLean = 0;
  if (ctx.speaking) {
    targetLean = LEAN_SPEAK_RAD + energy01 * LEAN_INTENSITY_GAIN;
  }
  if (intent === 'explaining' || intent === 'emphasizing') {
    if (targetLean > LEAN_EXPLAIN_FLOOR) targetLean = LEAN_EXPLAIN_FLOOR;
  }
  _lastLean += (targetLean - _lastLean) * LEAN_LERP_K;

  // Knee breath — subtle low-freq flex (asymmetric).
  const kneeFlex = Math.sin(t * 0.6 + 1.0) * KNEE_FLEX_AMP_RAD;

  // Compute leg / foot compensations.
  const upLegCompensation = -_lastWeightShift * LEG_COMPENSATION_FACTOR;
  const footCompensation  = -upLegCompensation * FOOT_COMPENSATION_FACTOR;

  // Hips position — lateral sway proportional to roll, micro Y breath, forward Z when leaning.
  const hipsOffset = new THREE.Vector3(
    (_lastWeightShift / SHIFT_AMP_RAD) * SHIFT_AMP_POS,
    Math.sin(t * 0.9) * HIP_BREATH_Y_AMP,
    -_lastLean * LEAN_Z_POS_GAIN, // forward lean → small +Z body shift
  );

  // Hips rotation — pitch (lean) + roll (weight shift). Y stays 0.
  const hipsRot = new THREE.Euler(_lastLean * 0.45, 0, _lastWeightShift, 'YXZ');

  // Spine — additional forward lean for engagement readability.
  const spineLean = new THREE.Euler(_lastLean * SPINE_LEAN_FACTOR, 0, 0, 'YXZ');

  // Leg deltas.
  const leftUpperLegRot  = new THREE.Euler(0, 0, upLegCompensation, 'YXZ');
  const rightUpperLegRot = new THREE.Euler(0, 0, upLegCompensation, 'YXZ');
  const leftLowerLegRot  = new THREE.Euler( kneeFlex, 0, 0, 'YXZ');
  const rightLowerLegRot = new THREE.Euler(-kneeFlex, 0, 0, 'YXZ');
  const leftFootRot      = new THREE.Euler(0, 0, footCompensation, 'YXZ');
  const rightFootRot     = new THREE.Euler(0, 0, footCompensation, 'YXZ');

  // Debug surface.
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lowerBodyState = {
      weightShift:  +_lastWeightShift.toFixed(4),
      lean:         +_lastLean.toFixed(4),
      kneeFlex:     +kneeFlex.toFixed(4),
      hipsOffset: {
        x: +hipsOffset.x.toFixed(4),
        y: +hipsOffset.y.toFixed(4),
        z: +hipsOffset.z.toFixed(4),
      },
      speaking:     ctx.speaking,
      intent,
      intensity:    +energy01.toFixed(3),
    };
  }

  return {
    hipsOffset,
    hipsRot,
    spineLean,
    leftUpperLegRot,
    rightUpperLegRot,
    leftLowerLegRot,
    rightLowerLegRot,
    leftFootRot,
    rightFootRot,
    weightShift: _lastWeightShift,
    lean:        _lastLean,
    kneeFlex,
  };
}

// ── Apply helper — additive (.rotation.x += / .position.x += pattern) ─────

const _BoneName = (n: string): string => n; // const-friendly cast

/**
 * Apply a precomputed `LowerBodyState` to the live VRM humanoid.
 *
 * Stability strategy (post Rotation-Accumulation fix):
 *
 * 1. **Absolute, not additive.** Each frame we OVERWRITE the bone's rotation
 *    with the freshly-computed delta from rest pose.  No `+=` anywhere.
 *
 * 2. **Quaternion-based set, not direct euler assignment.**  We use
 *    `bone.quaternion.setFromEuler(_eulerScratch)` instead of
 *    `bone.rotation.x = …`.  Reasons:
 *      • Avoids gimbal lock when the bone's local euler order differs from
 *        the convention our state was computed in (`YXZ`).
 *      • Three.js syncs `.rotation` from `.quaternion` automatically, so
 *        downstream readers see the right values regardless of order.
 *      • VRM internally uses quaternions everywhere — fewer round-trips.
 *
 * 3. **Hips position uses `base + offset`.**  The rig's authored hips
 *    position is captured once and used as the absolute reference; never
 *    teleports to (0,0,0).
 *
 * 4. **Spine deliberately NOT touched.**  `applyFinalPoseToVrm` already wrote
 *    spine via the upper-body presence chain; touching it here would erase
 *    that work each frame.  `state.spineLean` is still produced for future
 *    composition layers.
 *
 * 5. **Stability monitor.**  We track max(|rotation|) across all lower-body
 *    bones per frame and log every 2 s.  If any bone exceeds the runaway
 *    threshold (0.45 rad ≈ 26°), a warning fires — that's the canary for any
 *    future regression that re-introduces accumulation.
 */
export function applyLowerBodyState(vrm: VRM, state: LowerBodyState): void {
  const humanoid = vrm?.humanoid;
  if (!humanoid) return;

  /** Absolute quaternion set from a YXZ-order Euler — gimbal-lock-free. */
  const setRotationFromEuler = (boneName: string, e: THREE.Euler): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bone = humanoid.getNormalizedBoneNode(_BoneName(boneName) as any);
    if (!bone) return;
    _eulerScratch.set(e.x, e.y, e.z, 'YXZ');
    bone.quaternion.setFromEuler(_eulerScratch);
  };

  /** Track |rotation| magnitude for the stability monitor. */
  const _track = (e: THREE.Euler): void => {
    const m = Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z);
    if (m > _maxRotMagSince) _maxRotMagSince = m;
  };

  // Hips — rotation X (lean) + Z (roll) absolute via quaternion; Y untouched.
  // Position — base + offset (rig's authored rest pose captured on first call).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hipsBone = humanoid.getNormalizedBoneNode('hips' as any);
  if (hipsBone) {
    // Quaternion set from { lean (X), 0 (Y untouched-as-zero), roll (Z) }.
    // NOTE: this OVERWRITES upstream Y writes on hips (which previously came
    // from subconscious sway).  Acceptable trade-off — hip Y sway is now
    // sourced from our own weight-shift on Z, plus the position X sway.
    _eulerScratch.set(state.hipsRot.x, 0, state.hipsRot.z, 'YXZ');
    hipsBone.quaternion.setFromEuler(_eulerScratch);
    _track(state.hipsRot);

    if (_hipsRestX === null) {
      _hipsRestX = hipsBone.position.x;
      _hipsRestY = hipsBone.position.y;
      _hipsRestZ = hipsBone.position.z;
    }
    hipsBone.position.x = (_hipsRestX as number) + state.hipsOffset.x;
    hipsBone.position.y = (_hipsRestY as number) + state.hipsOffset.y;
    hipsBone.position.z = (_hipsRestZ as number) + state.hipsOffset.z;
  }

  // Legs + feet — absolute quaternion set, rest pose is identity.
  setRotationFromEuler('leftUpperLeg',  state.leftUpperLegRot);
  setRotationFromEuler('rightUpperLeg', state.rightUpperLegRot);
  setRotationFromEuler('leftLowerLeg',  state.leftLowerLegRot);
  setRotationFromEuler('rightLowerLeg', state.rightLowerLegRot);
  setRotationFromEuler('leftFoot',      state.leftFootRot);
  setRotationFromEuler('rightFoot',     state.rightFootRot);

  _track(state.leftUpperLegRot);
  _track(state.rightUpperLegRot);
  _track(state.leftLowerLegRot);
  _track(state.rightLowerLegRot);
  _track(state.leftFootRot);
  _track(state.rightFootRot);

  // Spine — NOT written here (upper-body owns it; see header).
  // `state.spineLean` is intentionally untouched.

  // ── [ROTATION_MODE] one-time announcement ─────────────────────────────
  if (!_rotationModeLogged) {
    _rotationModeLogged = true;
    // eslint-disable-next-line no-console
    console.log('[ROTATION_MODE]', {
      lowerBody: 'quaternion.setFromEuler (absolute, YXZ order)',
      hipsRotation: 'quaternion.setFromEuler (X,0,Z) — Y untouched',
      hipsPosition: 'base + offset (rest pose captured once)',
      spine: 'not written (owned by upper body)',
      additive: false,
      bones: ['hips', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'],
    });
  }

  // ── [MOTION_STABILITY] periodic stability log ─────────────────────────
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - _lastStabilityLogMs > STABILITY_LOG_MS) {
    _lastStabilityLogMs = nowMs;
    const runaway = _maxRotMagSince > STABILITY_RUNAWAY_RAD;
    // eslint-disable-next-line no-console
    (runaway ? console.warn : console.log)('[MOTION_STABILITY]', {
      windowMs: STABILITY_LOG_MS,
      maxRotMag: +_maxRotMagSince.toFixed(4),
      threshold: STABILITY_RUNAWAY_RAD,
      runaway,
      hipsOffset: typeof window !== 'undefined'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? ((window as any).__lowerBodyState?.hipsOffset ?? null)
        : null,
    });
    _maxRotMagSince = 0;
  }
}

// ── Backward-compatible all-in-one wrapper ────────────────────────────────

/**
 * Compute + apply in one call.  Mirrors the previous module API so existing
 * callers don't have to change.  New code is encouraged to use the explicit
 * `computeProceduralLowerBody` + `applyLowerBodyState` split.
 */
export function applyProceduralLowerBody(vrm: VRM, opts: LowerBodyOptions): void {
  if (opts.enabled === false) return;
  if (!vrm?.humanoid) return;
  const state = computeProceduralLowerBody({
    time:      opts.timeSec,
    speaking:  opts.speaking,
    intent:    opts.intent,
    intensity: opts.energy,
  });
  applyLowerBodyState(vrm, state);
}

/** Reset internal smoothing state (e.g. on speech-end or cold reload). */
export function resetProceduralLowerBody(): void {
  _lastWeightShift     = 0;
  _lastLean            = 0;
  _hipsRestX           = null;
  _hipsRestY           = null;
  _hipsRestZ           = null;
  _maxRotMagSince      = 0;
  _lastStabilityLogMs  = -Infinity;
  _rotationModeLogged  = false;
}
