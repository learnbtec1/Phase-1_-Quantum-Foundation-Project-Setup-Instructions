/**
 * Single smoothed energy signal for body motion + performance scales.
 * Ingests intentEnergy (brain), behavior intent intensity (Level-7 frame), and audio RMS
 * only here — motion layers must not read raw RMS directly.
 *
 * Stage 3 — **stableMotionEnergy**: one human-like, low-jitter scalar for procedural
 * motion (attack/release, dead-zone, burst limiting, hysteresis). Call
 * `tickStableMotionEnergy` once per frame after the raw viseme/TTS blend is known,
 * then read `getStableMotionEnergy()` from motion layers (not raw viseme/RMS).
 */
'use client';

import { updateSpeechDriveFromUnifiedEnergy } from '@/lib/avatar/speechDriveState';

const SMOOTH = 0.15;

/** Hysteresis band on the *energy scalar* (not the speaking flag). */
const HYST_ENTER = 0.12;
const HYST_EXIT = 0.06;
const DEAD_ZONE = 0.024;
const BURST_MAX_STEP = 0.09;

let stableMotionEnergy = 0;
let _burstLimited = 0;
let _hystActive = false;
let _lastStableDebug: Record<string, unknown> = {};

/**
 * Dynamic idle floor.
 *
 * `IDLE_FLOOR_SILENT` was 0.10 — too low for procedural expression head motion to
 * cross the perceptible threshold while silent (`energyScale = 0.46 + e * profile`
 * gave ≈0.55 head gain at idle, which lerp + spring smoothing then hid). Bumped to
 * 0.20 so:
 *   - silent baseline expression gains stay visible (~0.65 at idle)
 *   - speaking still wins (`IDLE_FLOOR_SPEAKING = 0.30` + `0.6*audioRMS`)
 *   - the avatar no longer reads as "frozen between utterances"
 */
const IDLE_FLOOR_SILENT   = 0.20;
const IDLE_FLOOR_SPEAKING = 0.30;

let smoothedUnified = IDLE_FLOOR_SILENT;
let lastEnergyLogMs = 0;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function resetUnifiedEnergyForSession(): void {
  smoothedUnified = IDLE_FLOOR_SILENT;
  lastEnergyLogMs = 0;
  stableMotionEnergy = 0;
  _burstLimited = 0;
  _hystActive = false;
}

export function getSmoothedUnifiedEnergy(): number {
  return smoothedUnified;
}

/**
 * Authoritative procedural motion energy (0–1). Updated only via
 * {@link tickStableMotionEnergy} — not raw viseme/RMS.
 */
export function getStableMotionEnergy(): number {
  return stableMotionEnergy;
}

/**
 * Human-like stabilization of the already-blended raw motion energy (viseme peek +
 * TTS fallback, etc.). Call once per frame after raw `motionEnergyUnified` is computed.
 */
export function tickStableMotionEnergy(raw01: number, speaking: boolean, deltaSec: number): void {
  const dt = Math.min(Math.max(deltaSec, 0), 0.1);
  const raw = clamp01(raw01);

  if (!speaking) {
    _hystActive = false;
    const alphaSilence = 1 - Math.exp(-dt * 4.2);
    stableMotionEnergy += (0 - stableMotionEnergy) * alphaSilence;
    if (stableMotionEnergy < 0.0035) stableMotionEnergy = 0;
    _burstLimited *= Math.pow(0.9, dt * 60);
    if (_burstLimited < 0.01) _burstLimited = 0;

    _lastStableDebug = {
      rawSpeechEnergy: +raw.toFixed(4),
      smoothedEnergy: +_burstLimited.toFixed(4),
      stableMotionEnergy: +stableMotionEnergy.toFixed(4),
      active: false,
      hysteresis: { enteredAt: HYST_ENTER, exitedAt: HYST_EXIT },
      damping: {
        burstReduction: 0,
        smoothing: +alphaSilence.toFixed(3),
      },
      gestureGate: {
        proceduralAllowed: false,
        amplificationClamped: true,
      },
    };
    if (typeof window !== 'undefined') {
      (window as Window & { __MOTION_ENERGY_DEBUG?: unknown }).__MOTION_ENERGY_DEBUG = _lastStableDebug;
    }
    return;
  }

  const maxStep = BURST_MAX_STEP * Math.max(1, dt * 60);
  const jump = raw - _burstLimited;
  const burstLimited =
    Math.abs(jump) > maxStep ? _burstLimited + Math.sign(jump) * maxStep : raw;
  _burstLimited = clamp01(burstLimited);

  if (_burstLimited >= HYST_ENTER) _hystActive = true;
  else if (_burstLimited < HYST_EXIT) _hystActive = false;

  let target = _burstLimited;
  if (Math.abs(target - stableMotionEnergy) < DEAD_ZONE) {
    target = stableMotionEnergy;
  }

  const rising = target > stableMotionEnergy;
  const alphaAttack = 1 - Math.exp(-dt * 16);
  const alphaRelease = 1 - Math.exp(-dt * 4.8);
  const alpha = rising ? alphaAttack : alphaRelease;
  stableMotionEnergy += (target - stableMotionEnergy) * alpha;
  stableMotionEnergy = clamp01(Math.min(stableMotionEnergy, 0.96));

  const burstReduction = Math.abs(raw - _burstLimited);

  _lastStableDebug = {
    rawSpeechEnergy: +raw.toFixed(4),
    smoothedEnergy: +_burstLimited.toFixed(4),
    stableMotionEnergy: +stableMotionEnergy.toFixed(4),
    active: _hystActive,
    hysteresis: { enteredAt: HYST_ENTER, exitedAt: HYST_EXIT },
    damping: {
      burstReduction: +burstReduction.toFixed(4),
      smoothing: +(rising ? alphaAttack : alphaRelease).toFixed(3),
    },
    gestureGate: {
      proceduralAllowed: stableMotionEnergy > 0.038 || speaking,
      amplificationClamped: true,
    },
  };
  if (typeof window !== 'undefined') {
    (window as Window & { __MOTION_ENERGY_DEBUG?: unknown }).__MOTION_ENERGY_DEBUG = _lastStableDebug;
  }
}

/**
 * Per animation frame — call once from VRMSkeletonManager (after sampling analyser when speaking).
 */
export function tickUnifiedEnergy(input: {
  intentEnergy: number;
  behaviorIntensity: number;
  /** Normalized 0–1 (e.g. readAnalyserRms01); use 0 when not speaking or analyser not yet wired. */
  audioRms01: number;
  speaking: boolean;
  delta: number;
}): void {
  const ie = clamp01(input.intentEnergy);
  const bi = clamp01(input.behaviorIntensity);
  const ar = clamp01(input.audioRms01);

  // Raw composite: intent + behavior + audio.
  // While speaking, audio dominates (60%); while silent, audio is 0 anyway.
  const composite = input.speaking
    ? clamp01(0.25 * ie + 0.15 * bi + 0.6 * ar)
    : clamp01(0.5  * ie + 0.5  * bi);

  // Dynamic floor: speaking holds energy alive even without audio; silence decays toward 0.1.
  const floor      = input.speaking ? IDLE_FLOOR_SPEAKING : IDLE_FLOOR_SILENT;
  const unifiedRaw = Math.max(composite, floor);

  smoothedUnified += (unifiedRaw - smoothedUnified) * SMOOTH;

  updateSpeechDriveFromUnifiedEnergy({
    speaking: input.speaking,
    unifiedSmoothed: smoothedUnified,
    delta: input.delta,
  });

  if (typeof window !== 'undefined') {
    // Mirrors smoothed pipeline energy so motion layers can fall back when
    // viseme-driven peekSpeechEnergy() is still 0 (lip-sync lag / blocked events).
    (window as Window & { __lastTTSEnergy?: number }).__lastTTSEnergy = smoothedUnified;
  }

  // Log only once per second to avoid console flooding (not gated behind DEBUG_MOTION
  // so it's always available for quick sanity checks).
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastEnergyLogMs >= 4000) {
    lastEnergyLogMs = now;
    // eslint-disable-next-line no-console -- energy pipeline checkpoint (throttled 4s)
    console.log('[TTS ENERGY]', {
      intentEnergy: Number(ie.toFixed(3)),
      behaviorIntensity: Number(bi.toFixed(3)),
      audioRMS: Number(ar.toFixed(3)),
      computedEnergy: Number(unifiedRaw.toFixed(3)),
      smoothedUnifiedEnergy: Number(smoothedUnified.toFixed(3)),
      speaking: input.speaking,
    });
  }
}
