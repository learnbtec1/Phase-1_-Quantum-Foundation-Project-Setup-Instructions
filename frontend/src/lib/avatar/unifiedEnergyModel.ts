/**
 * Single smoothed energy signal for body motion + performance scales.
 * Ingests intentEnergy (brain), behavior intent intensity (Level-7 frame), and audio RMS
 * only here — motion layers must not read raw RMS directly.
 */
'use client';

import { updateSpeechDriveFromUnifiedEnergy } from '@/lib/avatar/speechDriveState';

const SMOOTH = 0.15;

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
}

export function getSmoothedUnifiedEnergy(): number {
  return smoothedUnified;
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
