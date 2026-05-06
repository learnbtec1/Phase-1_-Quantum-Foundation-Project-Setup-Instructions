'use client';

/**
 * __speechFusion.ts — Speech + Emotion + Motion fusion layer.
 *
 * Pipeline position: AFTER `mergeBehaviorEngineMotionScalars` AND AFTER the
 * `__forceMotionState` blend wrapper, BEFORE the `_VIS_AMP` clamp.
 *
 * Owns NO bones, NO React, NO scene access. Pure data:
 *   • LipSyncManager pushes the per-frame viseme magnitude via `pushVisemeFrame`.
 *   • The fusion function reads that frame, smooths it (frame-rate-independent),
 *     applies emotion modulation, and ADDS subtle deltas to motion scalars.
 *
 * Strict invariants:
 *   • Additive only — never overwrites motion fields.
 *   • Cannot zero motion; therefore cannot trip any guard / detector upstream.
 *   • Stale viseme pushes (>200 ms) decay to silence.
 */

export type SpeechFrame = {
  /** 0..1 instantaneous viseme magnitude (max of mouth shape weights). */
  visemeWeight: number;
  /** 0..1 smoothed speech energy with τ-based smoothing. */
  energy: number;
  /** True when the latest push is recent (≤ 200 ms old). */
  fresh: boolean;
};

export type SpeechFusionMotion = {
  headNod: number;
  headTilt: number;
  openGesture: number;
  /** Optional jaw output target — added to runtime `_motionState` for downstream consumers. */
  jawOpen?: number;
};

export type SpeechFusionOpts = {
  speaking: boolean;
  emotion: string;
  /** 0..1 emotion intensity. */
  intensity: number;
  /** Monotonic clock — `performance.now()` recommended. */
  now: number;
};

// ── Internal state ─────────────────────────────────────────────────────────

let _lastWeight = 0;
let _lastPushMs = -Infinity;
let _smoothedEnergy = 0;
let _lastTickMs = -1;

const STALE_THRESHOLD_MS = 200;
const TAU_RISE_MS = 60;
const TAU_FALL_MS = 180;

let _lastCouplingLogMs = -Infinity;
const COUPLING_LOG_MS = 500;

/** Non-mutating read of the most recent smoothed energy (no side-effects). */
export function peekSpeechEnergy(): number {
  return _smoothedEnergy;
}

/** Non-mutating read of the most recent raw viseme magnitude. */
export function peekVisemeWeight(): number {
  return _lastWeight;
}

/**
 * Derived speech-coupling mode: returns 'SPEAKING' when actually speaking with
 * non-trivial energy, otherwise null. Consumers can substitute this into mode
 * decisions (scheduler / dispatch logs) without mutating any global flag.
 */
export type CouplingMode = 'SPEAKING' | null;
export function getCouplingMode(speaking: boolean): CouplingMode {
  if (!speaking) return null;
  return _smoothedEnergy > 0.2 ? 'SPEAKING' : null;
}

/** Called by `LipSyncManager` each frame with the current viseme magnitude (0..1). */
export function pushVisemeFrame(weight: number, now?: number): void {
  if (!Number.isFinite(weight)) return;
  _lastWeight = Math.max(0, Math.min(1, weight));
  _lastPushMs = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

/** Resets internal state — call on speech-end if a hard reset is desired. */
export function resetSpeechFusion(): void {
  _lastWeight = 0;
  _lastPushMs = -Infinity;
  _smoothedEnergy = 0;
  _lastTickMs = -1;
}

/**
 * Computes the current speech frame: viseme weight + smoothed energy.
 * Frame-rate-independent: τ-based exponential smoothing keyed on monotonic dt.
 */
export function getSpeechFrame(now: number): SpeechFrame {
  const dt = _lastTickMs < 0 ? 16 : Math.max(0, Math.min(100, now - _lastTickMs));
  _lastTickMs = now;

  const fresh = now - _lastPushMs < STALE_THRESHOLD_MS;
  const target = fresh ? _lastWeight : 0;

  const tau = target > _smoothedEnergy ? TAU_RISE_MS : TAU_FALL_MS;
  const k = 1 - Math.exp(-dt / tau);
  _smoothedEnergy += (target - _smoothedEnergy) * k;
  if (_smoothedEnergy < 1e-4) _smoothedEnergy = 0;

  return {
    visemeWeight: fresh ? _lastWeight : 0,
    energy: _smoothedEnergy,
    fresh,
  };
}

function _norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Apply additive speech-driven motion + emotion modulation.
 *
 * Adds:
 *   • motion.jawOpen      += visemeWeight * 0.9       (created if not present)
 *   • motion.headNod      += energy * 0.02 * tiltMul
 *   • motion.headTilt     += energy * 0.01 * tiltMul
 *   • motion.openGesture  += energy * 0.04 * gestMul
 *
 * Emotion modulation:
 *   happy / joy / excited → gestMul *1.15, tiltMul *1.20
 *   serious / sad / thinking → gestMul *0.78, tiltMul *0.85
 *   neutral else         → 1.00
 * All multipliers are then scaled by `0.85 + 0.30 * intensity01`.
 */
export function applySpeechFusion(
  motion: SpeechFusionMotion,
  opts: SpeechFusionOpts,
): SpeechFrame {
  const sf = getSpeechFrame(opts.now);

  const intensity01 = Math.max(0, Math.min(1, opts.intensity));
  const emotion = _norm(opts.emotion);

  let gestMul = 1.0;
  let tiltMul = 1.0;
  if (
    emotion === 'happy' ||
    emotion === 'joy' ||
    emotion === 'excited' ||
    emotion === 'friendly'
  ) {
    gestMul = 1.15;
    tiltMul = 1.20;
  } else if (
    emotion === 'serious' ||
    emotion === 'sad' ||
    emotion === 'thinking' ||
    emotion === 'focused' ||
    emotion === 'concerned'
  ) {
    gestMul = 0.78;
    tiltMul = 0.85;
  }
  gestMul *= 0.85 + 0.30 * intensity01;
  tiltMul *= 0.85 + 0.25 * intensity01;

  // Apply only when speaking and a fresh viseme signal exists; otherwise stay
  // at the smoothed-energy floor (which decays naturally).
  const apply = opts.speaking && (sf.fresh || sf.energy > 1e-4);
  // Capture pre-apply values for [COUPLING_CHECK] log (additive only).
  const _preHN = motion.headNod;
  const _preHT = motion.headTilt;
  const _preOG = motion.openGesture;
  // Envelope floor: when speaking, guarantee envelope ≥ 0.5 so motion exists
  // even during quiet utterance windows. Raw smoothed energy is preserved on
  // the debug surface; only the injection multiplier uses the floored value.
  const envelope = opts.speaking ? Math.max(sf.energy, 0.5) : sf.energy;

  if (apply) {
    // Speech-energy injection (baseline guarantee that motion exists during speech).
    // Spec (latest): motion.headNod += envelope * 0.03; motion.openGesture += envelope * 0.1.
    // Emotion multipliers stay multiplicative so happy/serious modulation persists.
    motion.headNod      += envelope * 0.03 * tiltMul;
    motion.headTilt     += envelope * 0.01 * tiltMul;
    motion.openGesture  += envelope * 0.10 * gestMul;
    motion.jawOpen       = (motion.jawOpen ?? 0) + sf.visemeWeight * 0.9;
  }

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__speechFusion = {
      energy:        +sf.energy.toFixed(3),
      visemeWeight:  +sf.visemeWeight.toFixed(3),
      emotion,
      intensity:     +intensity01.toFixed(3),
      gestMul:       +gestMul.toFixed(2),
      tiltMul:       +tiltMul.toFixed(2),
      fresh:         sf.fresh,
      applied:       apply,
      now:           opts.now,
    };
  }

  // [COUPLING_STATE] — energy / mode / final motion (throttled, talking-only).
  if (opts.speaking && opts.now - _lastCouplingLogMs > COUPLING_LOG_MS) {
    _lastCouplingLogMs = opts.now;
    const couplingMode: 'SPEAKING' | 'IDLE' = sf.energy > 0.2 ? 'SPEAKING' : 'IDLE';
    // eslint-disable-next-line no-console
    console.log('[COUPLING_STATE]', {
      energy:       +sf.energy.toFixed(3),
      envelope:     +envelope.toFixed(3),
      visemeWeight: +sf.visemeWeight.toFixed(3),
      speaking:     opts.speaking,
      mode:         couplingMode,
      motion: {
        headNod:     +motion.headNod.toFixed(3),
        headTilt:    +motion.headTilt.toFixed(3),
        openGesture: +motion.openGesture.toFixed(3),
        jawOpen:     motion.jawOpen !== undefined ? +motion.jawOpen.toFixed(3) : null,
      },
      delta: {
        headNod:     +(motion.headNod - _preHN).toFixed(3),
        headTilt:    +(motion.headTilt - _preHT).toFixed(3),
        openGesture: +(motion.openGesture - _preOG).toFixed(3),
      },
      emotion,
      intensity:    +intensity01.toFixed(3),
      applied:      apply,
    });
  }

  return sf;
}
