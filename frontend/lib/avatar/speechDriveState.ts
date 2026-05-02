/**
 * Speech-driven motion helpers — RMS + phrase phase + syllable spikes from analyser only.
 * No events; updated once per frame from VRMSkeletonManager. Consumed by intentMotorLayer.
 */

/** Per-frame lerp toward raw RMS (user-tuned anti-jitter) */
const ENERGY_SMOOTH = 0.2;

let smoothedEnergy = 0;
let prevRawVol = 0;
/** 0–1 looping “phrase” phase for beat-aligned motion. */
let phrasePhase = 0;
/** Short-lived emphasis after volume transient (syllable / stress proxy). */
let syllablePulse = 0;

export type SpeechDriveSnapshot = {
  /** Agent TTS / lip-sync window (caller sets from isTalking). */
  active: boolean;
  /** Smoothed RMS 0–1. */
  energy: number;
  /** True when energy dropped below pause threshold (soft speech / breath). */
  inPause: boolean;
  /** 0–1 loop, advances faster when energy is high. */
  phrasePhase: number;
  /** 0–1 decaying bump on volume spikes. */
  syllablePulse: number;
};

/**
 * Call each frame after you know `speaking` and optional analyser RMS (0–1).
 * When `volume01` is null (no analyser), uses a low default while speaking so phrase phase still runs.
 */
export function updateSpeechDriveFromAnalyser(params: {
  speaking: boolean;
  volume01: number | null;
  delta: number;
}): void {
  const dt = Math.min(Math.max(params.delta, 0), 0.1);

  if (!params.speaking) {
    smoothedEnergy *= Math.pow(0.88, dt * 60);
    if (smoothedEnergy < 0.012) smoothedEnergy = 0;
    prevRawVol = 0;
    syllablePulse *= Math.pow(0.82, dt * 60);
    phrasePhase += dt * 0.12;
    phrasePhase %= 1;
    return;
  }

  const raw =
    typeof params.volume01 === 'number' && Number.isFinite(params.volume01)
      ? Math.min(1, Math.max(0, params.volume01))
      : 0.11;

  const dv = Math.max(0, raw - prevRawVol);
  prevRawVol = raw * 0.35 + prevRawVol * 0.65;
  if (dv > 0.055) {
    syllablePulse = Math.min(1, syllablePulse + 0.38);
  }
  syllablePulse *= Math.pow(0.86, dt * 60);

  smoothedEnergy += (raw - smoothedEnergy) * ENERGY_SMOOTH;
  smoothedEnergy = Math.min(1, Math.max(0, smoothedEnergy));

  const rate = 0.32 + smoothedEnergy * 1.05 + syllablePulse * 0.55;
  phrasePhase += dt * rate;
  while (phrasePhase >= 1) phrasePhase -= 1;
  while (phrasePhase < 0) phrasePhase += 1;
}

const PAUSE_ENERGY_THRESHOLD = 0.038;

/** Baseline energy for motion layers when not speaking — avoids frozen intent/cinematic blend. */
export const IDLE_MOTION_ENERGY_BASE = 0.15;

/** Dev: when true, `active` mirrors `speaking` (ignores RMS > 0.02 gate — diagnostic for “silent” TTS/analyser). */
const SPEAK_ACTIVE_IGNORE_RMS_GATE =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_MOTION_SPEAK_ACTIVE_IGNORE_RMS === 'true';

export function getSpeechDriveSnapshot(speaking: boolean): SpeechDriveSnapshot {
  const inPause = speaking && smoothedEnergy < PAUSE_ENERGY_THRESHOLD;
  const rawE = smoothedEnergy;
  /** Motion layers never use true zero — keeps intent/cinematic/speech coupling alive. */
  const energyForMotion = Math.max(IDLE_MOTION_ENERGY_BASE, rawE);
  return {
    active: SPEAK_ACTIVE_IGNORE_RMS_GATE ? speaking : speaking && rawE > 0.02,
    energy: energyForMotion,
    inPause,
    phrasePhase,
    syllablePulse,
  };
}
