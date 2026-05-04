/**
 * Motion Sequencing Engine — temporal mask layer ABOVE the existing procedural stack.
 *
 * Architecture (layered, additive — does NOT replace any existing module):
 *
 *   expressionMotionEngine.ts  → decides PRIMITIVE GAINS per expression (semantic + persona).
 *   motionSequencer.ts (this)  → decides WHEN each primitive is active (temporal gating).
 *   motionComposition.ts       → multiplies expressionGain × sequencerMask, then composes.
 *
 * Effect: continuous sin output is broken into human-like sequences:
 *
 *   thinking:    tilt(0.6s) → pause(0.4s) → microShake(0.3s) → pause(0.8s)
 *   explaining:  slowNod(0.7s) → pause(0.3s) → turn(0.5s) → pause(0.5s)
 *   emphasizing: strongNod(0.4s) → pause(0.2s) → strongNod(0.4s) → pause(0.7s)
 *
 * Pause = mask of zero on all head primitives → motion fully halts (after smoothing).
 *
 * Variation:
 *   - Per-step duration jitter ±15% applied at sequence pick time.
 *   - Multiple variants per expression; cycle restart re-picks (new shape every loop).
 *
 * Smoothing: mask is lerped (0.18/frame ≈ 80–120ms) so step transitions never pop —
 * the underlying spring smoothing in motionComposition still applies on top.
 */
'use client';

import type { ExpressionState } from '../expression/expressionMap';
import { getAwarenessPauseDurationMul } from '@/lib/avatar/awareness/studentAwarenessEngine';

// ─── Sequence types ──────────────────────────────────────────────────────────

export type SequenceStepKind =
  | 'nod'
  | 'slowNod'
  | 'strongNod'
  | 'tilt'
  | 'turn'
  | 'microShake'
  /** Explicit silence — all head primitive gains gated to 0. */
  | 'pause';

export type SequenceStep = {
  kind: SequenceStepKind;
  /** Base duration (sec). Random ±15% jitter applied at sequence pick time. */
  durationSec: number;
};

export type Sequence = SequenceStep[];

// ─── Per-expression sequence library (with variants) ─────────────────────────

const SEQUENCE_VARIANTS: Record<ExpressionState, Sequence[]> = {
  thinking: [
    // Variant A — signature tilt + reflective microShake.
    [
      { kind: 'tilt',       durationSec: 0.6 },
      { kind: 'pause',      durationSec: 0.4 },
      { kind: 'microShake', durationSec: 0.3 },
      { kind: 'pause',      durationSec: 0.8 },
    ],
    // Variant B — multi-axis: tilt → turn (gaze-drift) → tilt. Replaces the prior
    // tilt/pause-only loop that visually read as a stuck head.
    [
      { kind: 'tilt',  durationSec: 0.7 },
      { kind: 'pause', durationSec: 0.3 },
      { kind: 'turn',  durationSec: 0.4 },
      { kind: 'pause', durationSec: 0.5 },
      { kind: 'tilt',  durationSec: 0.5 },
      { kind: 'pause', durationSec: 0.7 },
    ],
    // Variant C — tilt → microShake → turn. Adds a third recognisable rhythm so
    // sustained `thinking` does not lock onto a single shape.
    [
      { kind: 'tilt',       durationSec: 0.8 },
      { kind: 'pause',      durationSec: 0.4 },
      { kind: 'microShake', durationSec: 0.25 },
      { kind: 'pause',      durationSec: 0.4 },
      { kind: 'turn',       durationSec: 0.5 },
      { kind: 'pause',      durationSec: 0.8 },
    ],
  ],
  explaining: [
    [
      { kind: 'slowNod', durationSec: 0.7 },
      { kind: 'pause',   durationSec: 0.3 },
      { kind: 'turn',    durationSec: 0.5 },
      { kind: 'pause',   durationSec: 0.5 },
    ],
    [
      { kind: 'slowNod', durationSec: 0.55 },
      { kind: 'pause',   durationSec: 0.4 },
      { kind: 'slowNod', durationSec: 0.55 },
      { kind: 'pause',   durationSec: 0.6 },
    ],
  ],
  emphasizing: [
    [
      { kind: 'strongNod', durationSec: 0.4 },
      { kind: 'pause',     durationSec: 0.2 },
      { kind: 'strongNod', durationSec: 0.4 },
      { kind: 'pause',     durationSec: 0.7 },
    ],
    [
      { kind: 'strongNod', durationSec: 0.45 },
      { kind: 'pause',     durationSec: 0.25 },
      { kind: 'strongNod', durationSec: 0.45 },
      { kind: 'pause',     durationSec: 0.25 },
      { kind: 'strongNod', durationSec: 0.45 },
      { kind: 'pause',     durationSec: 0.8 },
    ],
  ],
  confirming: [
    [
      { kind: 'nod',   durationSec: 0.5 },
      { kind: 'pause', durationSec: 0.5 },
      { kind: 'nod',   durationSec: 0.4 },
      { kind: 'pause', durationSec: 0.7 },
    ],
  ],
  listening: [
    [
      { kind: 'turn',  durationSec: 0.6 },
      { kind: 'pause', durationSec: 0.7 },
      { kind: 'turn',  durationSec: 0.4 },
      { kind: 'pause', durationSec: 0.9 },
    ],
  ],
  neutral: [
    [
      { kind: 'pause', durationSec: 1.2 },
      { kind: 'turn',  durationSec: 0.8 },
      { kind: 'pause', durationSec: 1.5 },
    ],
    // Multi-axis variant — fires occasionally so idle has perceptible 3-axis life
    // instead of only single-axis turn drift. All amplitudes stay subtle because
    // EXPRESSION_GAIN_MUL.neutral = 0.55 caps the per-primitive gain.
    [
      { kind: 'nod',   durationSec: 0.4 },
      { kind: 'pause', durationSec: 1.4 },
      { kind: 'turn',  durationSec: 0.7 },
      { kind: 'pause', durationSec: 1.0 },
      { kind: 'tilt',  durationSec: 0.5 },
      { kind: 'pause', durationSec: 1.2 },
    ],
  ],
};

// ─── Mask per step kind ──────────────────────────────────────────────────────
//
// Mask values are ∈ [0, 1] — multiplied onto the expression engine's gains.
// Disallowed primitives stay 0 because their expression gain is already 0.

type Mask = { headNod: number; headTilt: number; headTurn: number };

function maskForStep(kind: SequenceStepKind): Mask {
  switch (kind) {
    case 'pause':
      return { headNod: 0, headTilt: 0, headTurn: 0 };
    case 'nod':
    case 'slowNod':
    case 'strongNod':
      return { headNod: 1, headTilt: 0, headTurn: 0 };
    case 'tilt':
      return { headNod: 0, headTilt: 1, headTurn: 0 };
    case 'turn':
      return { headNod: 0, headTilt: 0, headTurn: 1 };
    case 'microShake':
      // Brief low-amplitude pulse across allowed primitives. The expression's
      // allowed-list filters the actually-visible motion.
      return { headNod: 0.30, headTilt: 0.30, headTurn: 0.45 };
  }
}

// ─── Per-step envelope ───────────────────────────────────────────────────────
//
//   t = elapsed / duration  ∈ [0, 1] within the step
//   attack  = smoothstep(0,   0.2, t)    → 0..1 over the first 20% of the step
//   release = smoothstep(0.7, 1.0, t)    → 0..1 over the last  30% of the step
//   envelope = attack * (1 - release)    → bell-shape (rise → hold → fall)
//
// Result: each step has its own arc instead of being a flat mask. Combined with
// the existing mask lerp + downstream spring smoothing, transitions stay C1.

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function envelopeAt(t01: number): number {
  const t = Math.min(1, Math.max(0, t01));
  const attack  = smoothstep(0,    0.2,  t);
  // Release starts at 0.65 (was 0.70): recovery phase is 35% of step instead of 30%.
  // Effect: downstroke feels faster (committed, decisive); upstroke feels deliberate (controlled).
  // Biomechanically this mirrors real head nods: fast forward, slower return.
  const release = smoothstep(0.65, 1.0,  t);
  return attack * (1 - release);
}

// ─── Pause micro-motion floor ────────────────────────────────────────────────
//
// During pauses we DO NOT zero the mask. A small constant floor keeps breathing
// + micro motion alive (eye saccades, neck drift) so the avatar reads as
// "settled" rather than "frozen". Bumped 0.12 → 0.18 so secondary primitives
// (nod, tilt) survive the adaptive dead-zone gate even in silence:
//   neutral.headNod: 0.285 × 0.18 = 0.051 > adaptiveDZ(0.20)=0.0248 ✓
const PAUSE_FLOOR_VALUE = 0.18;

// ─── Syllable-aware soft advance ─────────────────────────────────────────────
//
// When TTS speech_drive emits a syllable pulse during nod/tilt steps, we nudge
// the step forward in *time* (not skip steps). This phase-aligns nods to speech
// beats without introducing hard switches.
const NUDGEABLE_STEPS: ReadonlySet<SequenceStepKind> = new Set<SequenceStepKind>([
  'nod', 'slowNod', 'strongNod', 'tilt', 'microShake',
]);
const PULSE_THRESHOLD = 0.6;
/** Max fraction of step duration that pulses can advance. Hard cap. */
const MAX_ADVANCE_FRAC = 0.30;
/** Per-pulse advance scale (10% of step duration × pulse intensity, capped above). */
const PULSE_ADVANCE_PER_HIT = 0.10;

// ─── Internal state ──────────────────────────────────────────────────────────

let _currentExpression: ExpressionState = 'neutral';
let _currentSequence: Sequence = pickSequenceFor('neutral');
let _stepIndex = 0;
let _stepStartSec = -1;
let _lastLoggedStepIdx = -1;
/** Accumulated soft-advance from syllable pulses (sec) — reset on step boundary. */
let _pulseAdvanceAccum = 0;
let _prevSyllablePulse = 0;
/** Throttled timestamp for [MOTION_ENVELOPE] log. */
let _lastEnvelopeLogMs = 0;

// ─── Per-step phase offset ────────────────────────────────────────────────────
//
// Rolled on every step boundary. Gives each gesture a unique starting phase so
// two consecutive nods are never identical, while keeping direction correct.
//
// Bias rules by step kind:
//
//   nod / slowNod / strongNod  → sample ∈ [−0.3π, 0]   (negative = anticipation, zero = clean start)
//     Positive would place the head 81% through a nod cycle at step open — it
//     reads as a *return stroke*, not a fresh gesture. Restricting to [−0.3π, 0]
//     guarantees the first visible motion is always downward or from a resting state.
//
//   tilt / microShake / turn   → sample ∈ [−0.3π, +0.3π]   (direction controlled by tiltSign)
//     Direction is already enforced by tiltSign (±1); phase variety is purely temporal.
//
//   pause                      → 0  (no sinusoidal phase)
//
// Constraint: cos(offset) > 0 for all allowed values → direction is always positive
//   At offset = −0.3π: cos(−54°) ≈ 0.59 > 0  ✓  sin(−54°) ≈ −0.81  → anticipation pre-load
//   At offset = 0:     cos(0)   = 1.00 > 0  ✓  clean zero start

const PHASE_JITTER_MAX      = Math.PI * 0.3;   // upper magnitude for tilt/turn
const PHASE_JITTER_NOD_MAX  = Math.PI * 0.3;   // negative-only range for nods

function rollPhaseOffsetFor(kind: SequenceStepKind): number {
  if (kind === 'pause') return 0;
  if (kind === 'nod' || kind === 'slowNod' || kind === 'strongNod') {
    // Sample ∈ [−0.3π, 0]: zero = clean start, negative = anticipatory counter-load.
    return -Math.random() * PHASE_JITTER_NOD_MAX;
  }
  // tilt, turn, microShake — symmetric range; tiltSign governs visible direction.
  return (Math.random() - 0.5) * 2 * PHASE_JITTER_MAX;
}

/** Per-step initial phase offset for head primitives (radians). */
let _stepPhaseOffset = 0;

/** Mask transition smoothing (≈80–120ms ramp at 60fps). Avoids audible pops. */
const MASK_LERP = 0.18;
const _maskSmoothed: Mask = { headNod: 0, headTilt: 0, headTurn: 0 };

// ─── Sequence picker ─────────────────────────────────────────────────────────

function pickSequenceFor(expr: ExpressionState): Sequence {
  const variants = SEQUENCE_VARIANTS[expr] ?? SEQUENCE_VARIANTS.neutral;
  const base = variants[Math.floor(Math.random() * variants.length)] ?? variants[0]!;
  // Awareness Layer: pause steps are extended when student is cognitively overloaded
  // (visual breathing room). getAwarenessPauseDurationMul() returns 1.0 normally.
  const pauseMul = getAwarenessPauseDurationMul();
  return base.map((step) => {
    const jitter = 0.85 + Math.random() * 0.3;
    const awareFactor = step.kind === 'pause' ? pauseMul : 1.0;
    return {
      kind: step.kind,
      durationSec: Math.max(0.1, step.durationSec * jitter * awareFactor),
    };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SequencerOutput = {
  /** Per-primitive temporal mask (smoothed + enveloped). Multiply onto expression engine gains. */
  mask: Readonly<Mask>;
  /** Active step kind this frame. */
  step: SequenceStepKind;
  stepIndex: number;
  /** Seconds remaining in the current step (after pulse advance). */
  stepRemainingSec: number;
  /** Expression the sequencer is currently driving. */
  expression: ExpressionState;
  /** Step phase ∈ [0, 1]. */
  t01: number;
  /** Envelope value ∈ [0, 1] (0 for pause). */
  envelope: number;
  /**
   * Time elapsed since step start in seconds (including pulse advance).
   * Multiply by `headTimeScale` + add `stepPhaseOffset` in composition to get `headStepPhaseT`.
   */
  stepRelativeTimeSec: number;
  /**
   * Initial phase offset (radians, ±0.3π) rolled at each step boundary.
   * Added to `stepRelativeTimeSec × headTimeScale` so primitives start at a
   * consistent phase (sin(phaseOffset) near 0) with variety between repetitions.
   */
  stepPhaseOffset: number;
};

/**
 * Tick once per frame. Output `mask` should be multiplied onto each primitive's
 * gain BEFORE composeLayeredProceduralDeltas — so disallowed primitives still
 * stay at 0, and active ones smoothly gate in/out.
 *
 * @param committed       Committed expression from `tickExpressionHeadMotionPlan`.
 * @param tSec            Wall-clock seconds (master clock).
 * @param syllablePulse   Optional 0..1 syllable pulse hint from speechDriveState.
 *                        Strong pulses softly advance nod/tilt step timing
 *                        (max {@link MAX_ADVANCE_FRAC} of duration). Never hard-switches.
 */
export function tickMotionSequencer(
  committed: ExpressionState,
  tSec: number,
  syllablePulse?: number,
): SequencerOutput {
  if (_stepStartSec < 0) _stepStartSec = tSec;

  // Expression changed → restart sequence + pick fresh variant + new phase offset.
  if (committed !== _currentExpression) {
    _currentExpression = committed;
    _currentSequence = pickSequenceFor(committed);
    _stepIndex = 0;
    _stepStartSec = tSec;
    _pulseAdvanceAccum = 0;
    _lastLoggedStepIdx = -1;
    _stepPhaseOffset = rollPhaseOffsetFor(_currentSequence[0]?.kind ?? 'pause');
  }

  let step = _currentSequence[_stepIndex] ?? _currentSequence[0]!;

  // ── Syllable-aware soft advance (pulse rising-edge → +time within step) ─────
  const pulse = Math.min(1, Math.max(0, syllablePulse ?? 0));
  const isRisingEdge = pulse > PULSE_THRESHOLD && _prevSyllablePulse <= PULSE_THRESHOLD;
  _prevSyllablePulse = pulse;
  if (isRisingEdge && NUDGEABLE_STEPS.has(step.kind)) {
    const cap = step.durationSec * MAX_ADVANCE_FRAC;
    const wanted = step.durationSec * PULSE_ADVANCE_PER_HIT * pulse;
    const room = Math.max(0, cap - _pulseAdvanceAccum);
    const nudge = Math.min(wanted, room);
    if (nudge > 0) _pulseAdvanceAccum += nudge;
  }

  // Effective elapsed = real elapsed + accumulated pulse advance.
  let elapsed = (tSec - _stepStartSec) + _pulseAdvanceAccum;

  // Advance step(s). Safety cap protects against tab-resume spikes.
  let safetyHops = 0;
  while (elapsed >= step.durationSec && safetyHops++ < 8) {
    _stepStartSec += step.durationSec - _pulseAdvanceAccum;
    _stepIndex++;
    _pulseAdvanceAccum = 0; // reset on every step boundary
    if (_stepIndex >= _currentSequence.length) {
      // Cycle complete → re-pick variant for variety (new shape next loop).
      _currentSequence = pickSequenceFor(_currentExpression);
      _stepIndex = 0;
      _stepStartSec = tSec;
    }
    step = _currentSequence[_stepIndex]!;
    elapsed = (tSec - _stepStartSec) + _pulseAdvanceAccum;
    // Roll a fresh phase offset for every incoming step.
    _stepPhaseOffset = rollPhaseOffsetFor(step.kind);
  }

  // [MOTION_SEQUENCE] + [MOTION_PHASE] — emitted on every step transition.
  if (_stepIndex !== _lastLoggedStepIdx) {
    _lastLoggedStepIdx = _stepIndex;
    // eslint-disable-next-line no-console -- motion sequence checkpoint (only on transition)
    console.log('[MOTION_SEQUENCE]', {
      expression: _currentExpression,
      stepIndex: _stepIndex,
      step: step.kind,
      duration: Number(step.durationSec.toFixed(2)),
    });
    // Derive a human-readable direction label from step kind + phase offset sign.
    // Negative offset → anticipatory counter-motion at attack start (natural wind-up).
    const phaseDir =
      step.kind === 'pause'                          ? 'none'
      : step.kind === 'nod' || step.kind === 'slowNod' || step.kind === 'strongNod'
        ? (_stepPhaseOffset < -0.05 ? 'down↑anticipation' : 'down')
      : step.kind === 'tilt'
        ? (_stepPhaseOffset < 0 ? 'left↑anticipation' : 'right↑anticipation')
      : 'forward';
    // eslint-disable-next-line no-console -- phase reset checkpoint (only on transition)
    console.log('[MOTION_PHASE]', {
      step: step.kind,
      phase: Number(_stepPhaseOffset.toFixed(3)),
      direction: phaseDir,
    });
  }

  // ── Compute target mask: envelope × stepBase (active) OR pause floor ─────────
  const t01 = Math.min(1, Math.max(0, elapsed / Math.max(1e-3, step.durationSec)));
  const isPause = step.kind === 'pause';
  const env = isPause ? 0 : envelopeAt(t01);

  let target: Mask;
  if (isPause) {
    // Constant micro-motion floor — preserves breath/saccade life during pauses.
    target = {
      headNod:  PAUSE_FLOOR_VALUE,
      headTilt: PAUSE_FLOOR_VALUE,
      headTurn: PAUSE_FLOOR_VALUE,
    };
  } else {
    const base = maskForStep(step.kind);
    target = {
      headNod:  base.headNod  * env,
      headTilt: base.headTilt * env,
      headTurn: base.headTurn * env,
    };
  }

  // Smooth mask so transitions ramp instead of snap (envelope is already smooth;
  // this lerp is an extra stability backstop and absorbs pause↔active boundaries).
  _maskSmoothed.headNod  += (target.headNod  - _maskSmoothed.headNod)  * MASK_LERP;
  _maskSmoothed.headTilt += (target.headTilt - _maskSmoothed.headTilt) * MASK_LERP;
  _maskSmoothed.headTurn += (target.headTurn - _maskSmoothed.headTurn) * MASK_LERP;

  // [MOTION_ENVELOPE] — throttled (~5/s) so we can verify shape without flooding.
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - _lastEnvelopeLogMs >= 200) {
    _lastEnvelopeLogMs = nowMs;
    // eslint-disable-next-line no-console -- envelope checkpoint (always-on, throttled 200ms)
    console.log('[MOTION_ENVELOPE]', {
      step: step.kind,
      t: Number(t01.toFixed(3)),
      envelope: Number(env.toFixed(3)),
    });
  }

  return {
    mask: _maskSmoothed,
    step: step.kind,
    stepIndex: _stepIndex,
    stepRemainingSec: Math.max(0, step.durationSec - elapsed),
    expression: _currentExpression,
    t01,
    envelope: env,
    stepRelativeTimeSec: elapsed,
    stepPhaseOffset: _stepPhaseOffset,
  };
}

/** Reset on VRM load / session reset. */
export function resetMotionSequencer(): void {
  _currentExpression = 'neutral';
  _currentSequence = pickSequenceFor('neutral');
  _stepIndex = 0;
  _stepStartSec = -1;
  _lastLoggedStepIdx = -1;
  _pulseAdvanceAccum = 0;
  _prevSyllablePulse = 0;
  _lastEnvelopeLogMs = 0;
  _stepPhaseOffset = 0;
  _maskSmoothed.headNod = 0;
  _maskSmoothed.headTilt = 0;
  _maskSmoothed.headTurn = 0;
}

/** Diagnostic snapshot for tests / devtools. */
export function getMotionSequencerSnapshot(): {
  expression: ExpressionState;
  sequence: Sequence;
  stepIndex: number;
  stepStartSec: number;
  mask: Readonly<Mask>;
} {
  return {
    expression: _currentExpression,
    sequence: _currentSequence.map((s) => ({ ...s })),
    stepIndex: _stepIndex,
    stepStartSec: _stepStartSec,
    mask: { ..._maskSmoothed },
  };
}
