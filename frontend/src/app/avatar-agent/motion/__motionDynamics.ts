'use client';

/**
 * __motionDynamics.ts — Rhythm · Anticipation · Inertia
 * ───────────────────────────────────────────────────────────────────────────
 * The three fundamental properties that separate "stable system" from
 * "looks like a person".
 *
 *   RHYTHM       — speech-coupled micro-oscillation that makes each beat of
 *                  the utterance readable in the body.  Uses a single
 *                  frequency that adapts to speech energy so it speeds up
 *                  slightly during emphatic speech and slows during pauses.
 *
 *   ANTICIPATION — a small leading-edge overshoot in the direction of a
 *                  coming gesture, resolved before the main motion fires.
 *                  "The body leans forward before the arm moves."
 *                  Triggered on speech-start, intent change, and
 *                  intensity spikes.
 *
 *   INERTIA      — momentum carry-through after a gesture peak so motion
 *                  eases out rather than snapping to zero.  A first-order
 *                  low-pass filter (exponential decay) on the *velocity*
 *                  of the motion channels.
 *
 * Pipeline position: AFTER `applyPersonalityMotion`, BEFORE the `_VIS_AMP`
 * clamp.  Additive deltas only — all upstream guards remain valid.
 *
 * Strict invariants:
 *   • All writes use `+=` on the passed motion object (additive).
 *   • Cannot zero a channel that was already non-zero (additive bias only).
 *   • No allocations per frame (module-scope scalars only).
 *   • Frame-rate-independent: all time constants in ms / seconds via `dt`.
 */

export type MotionDynamicsOpts = {
  /** True while the avatar is uttering speech. */
  speaking: boolean;
  /** 0..1 smoothed speech energy. */
  energy: number;
  /** Active intent label. */
  intent: string;
  /** Monotonic clock seconds (use `t` from `useFrame`). */
  timeSec: number;
  /** Frame delta seconds (use `safeDelta` from `useFrame`). */
  deltaSec: number;
};

// ── Constants ───────────────────────────────────────────────────────────────

// RHYTHM
const RHYTHM_BASE_HZ     = 1.4;    // beats/sec at neutral energy
const RHYTHM_HZ_RANGE    = 0.8;    // +0.8 Hz at energy=1 → max 2.2 Hz
const RHYTHM_NOD_AMP     = 0.012;  // rad — subtle vertical bob
const RHYTHM_GESTURE_AMP = 0.018;  // gesture-channel micro-pulse

// ANTICIPATION
const ANTICIPATION_DUR_SEC  = 0.18;  // seconds the lead-edge lasts
const ANTICIPATION_NOD_AMP  = 0.022; // rad — head leans forward
const ANTICIPATION_OG_AMP   = 0.030; // gesture channels open slightly
const INTENT_COOLDOWN_SEC   = 0.80;  // min seconds between new anticipations

// INERTIA
const INERTIA_NOD_TAU_SEC    = 0.18; // RC time constant for headNod velocity
const INERTIA_OG_TAU_SEC     = 0.22; // RC time constant for openGesture velocity

// ── Module-scope state (no React, no allocations per frame) ─────────────────

// Rhythm
let _rhythmPhase       = 0;

// Anticipation
let _anticipationTimer = 0;   // seconds remaining in current anticipation
let _anticipationDirN  = 0;   // +1 or −1 for nod direction
let _anticipationDirOG = 0;
let _lastIntentKey     = '';
let _lastIntentChangeT = -Infinity;

// Inertia
let _inertiaVelNod  = 0;    // smoothed instantaneous velocity of headNod
let _inertiaVelOG   = 0;    // smoothed instantaneous velocity of openGesture
let _prevHeadNod    = 0;
let _prevOpenGesture = 0;

// Debug / log
let _lastDynamicsLogMs = -Infinity;
const DYNAMICS_LOG_MS  = 600;

function _normIntent(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Apply rhythm, anticipation, and inertia deltas to motion in-place.
 *
 * Must be called ONCE per render frame after `applyPersonalityMotion` and
 * before `_VIS_AMP`.  Requires `opts.deltaSec` (frame delta) to be
 * frame-rate independent.
 */
export function applyMotionDynamics(
  motion: { headNod: number; headTilt: number; openGesture: number },
  opts: MotionDynamicsOpts,
): void {
  const { speaking, energy, timeSec, deltaSec } = opts;
  const intent = _normIntent(opts.intent);
  const e01 = Math.max(0, Math.min(1, energy));
  const dt  = Math.max(0, Math.min(0.1, deltaSec));

  // ── 1. RHYTHM ─────────────────────────────────────────────────────────
  // Adaptive frequency: slightly faster during energetic speech.
  // Phase integrated each frame (frame-rate-independent).
  if (speaking) {
    const hz = RHYTHM_BASE_HZ + RHYTHM_HZ_RANGE * e01;
    _rhythmPhase += hz * dt * 2 * Math.PI;
    const wave = Math.sin(_rhythmPhase);

    const nodPulse     = wave * RHYTHM_NOD_AMP     * e01;
    const gesturePulse = wave * RHYTHM_GESTURE_AMP * e01;

    motion.headNod      += nodPulse;
    motion.openGesture  += gesturePulse;
  } else {
    // Decay phase so rhythm doesn't continue past speech.
    const kDecay = 1 - Math.exp(-dt / 0.35);
    _rhythmPhase += _rhythmPhase * (-kDecay);
  }

  // ── 2. ANTICIPATION ───────────────────────────────────────────────────
  // Trigger on three events: speaking start, intent change, intensity spike.
  const intentChanged =
    intent !== '' &&
    intent !== _lastIntentKey &&
    timeSec - _lastIntentChangeT > INTENT_COOLDOWN_SEC;

  const shouldTrigger = speaking && (intentChanged || _anticipationTimer <= 0 && e01 > 0.65);

  if (intentChanged) {
    _lastIntentKey     = intent;
    _lastIntentChangeT = timeSec;
  }

  if (shouldTrigger && _anticipationTimer <= 0) {
    _anticipationTimer = ANTICIPATION_DUR_SEC;
    _anticipationDirN  = motion.headNod >= 0 ? 1 : -1;
    _anticipationDirOG = 1;
  }

  if (_anticipationTimer > 0) {
    _anticipationTimer = Math.max(0, _anticipationTimer - dt);
    // Shape: rise then fall — sin²( t/dur · π ) to create a smooth bump.
    const progress   = 1 - _anticipationTimer / ANTICIPATION_DUR_SEC;
    const shapedAmp  = Math.sin(progress * Math.PI);

    motion.headNod     += _anticipationDirN  * ANTICIPATION_NOD_AMP  * shapedAmp * e01;
    motion.openGesture += _anticipationDirOG * ANTICIPATION_OG_AMP   * shapedAmp * e01;
  }

  // ── 3. INERTIA ────────────────────────────────────────────────────────
  // Smooth instantaneous velocity of each channel (first-order LPF).
  // Then add a fraction of the velocity back as a carry-through bias so
  // motion eases OUT instead of snapping to the next target.
  // Uses exponential RC: k = 1 − exp(−dt/τ).
  const kNod = 1 - Math.exp(-dt / INERTIA_NOD_TAU_SEC);
  const kOG  = 1 - Math.exp(-dt / INERTIA_OG_TAU_SEC);

  const velNodRaw  = dt > 0 ? (motion.headNod     - _prevHeadNod)    / dt : 0;
  const velOGRaw   = dt > 0 ? (motion.openGesture - _prevOpenGesture) / dt : 0;

  _inertiaVelNod += (velNodRaw  - _inertiaVelNod) * kNod;
  _inertiaVelOG  += (velOGRaw   - _inertiaVelOG)  * kOG;

  const INERTIA_CARRY = 0.25;  // fraction of smoothed velocity added back
  motion.headNod      += _inertiaVelNod * dt * INERTIA_CARRY;
  motion.openGesture  += _inertiaVelOG  * dt * INERTIA_CARRY;

  _prevHeadNod     = motion.headNod;
  _prevOpenGesture = motion.openGesture;

  // ── Debug surface ─────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__motionDynamics = {
      rhythmPhase:       +_rhythmPhase.toFixed(2),
      anticipationTimer: +_anticipationTimer.toFixed(3),
      inertiaVelNod:     +_inertiaVelNod.toFixed(4),
      inertiaVelOG:      +_inertiaVelOG.toFixed(4),
      speaking,
      energy: +e01.toFixed(3),
    };
  }

  // Throttled log
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - _lastDynamicsLogMs > DYNAMICS_LOG_MS && speaking) {
    _lastDynamicsLogMs = nowMs;
    // eslint-disable-next-line no-console
    console.log('[MOTION_DYNAMICS]', {
      rhythmHz:          +(RHYTHM_BASE_HZ + RHYTHM_HZ_RANGE * e01).toFixed(2),
      anticipationTimer: +_anticipationTimer.toFixed(3),
      inertiaVelNod:     +_inertiaVelNod.toFixed(4),
      inertiaVelOG:      +_inertiaVelOG.toFixed(4),
      motion: {
        headNod:     +motion.headNod.toFixed(3),
        openGesture: +motion.openGesture.toFixed(3),
      },
      energy: +e01.toFixed(3),
      intent,
    });
  }
}

/** Reset all internal state (call on speech-end / avatar hot-reload). */
export function resetMotionDynamics(): void {
  _rhythmPhase        = 0;
  _anticipationTimer  = 0;
  _anticipationDirN   = 0;
  _anticipationDirOG  = 0;
  _lastIntentKey      = '';
  _lastIntentChangeT  = -Infinity;
  _inertiaVelNod      = 0;
  _inertiaVelOG       = 0;
  _prevHeadNod        = 0;
  _prevOpenGesture    = 0;
  _lastDynamicsLogMs  = -Infinity;
}
