/**
 * Speech-driven motion helpers — phrase phase + syllable proxy driven by **unified** energy.
 * Updated from `unifiedEnergyModel.tickUnifiedEnergy`; no direct analyser reads here.
 */
'use client';

/** Tracks unified envelope for syllable-style bumps (no raw RMS). */
let prevSyllableTrack = 0;

let phrasePhase = 0;
let syllablePulse = 0;

/** Internal drive level mirrored from unified model while speaking. */
let smoothedEnergy = 0;

export type SpeechDriveSnapshot = {
  /** Agent TTS / lip-sync window (caller sets from isTalking). */
  active: boolean;
  /** 0–1 — aligned with smoothed unified energy. */
  energy: number;
  /** True when energy dropped below pause threshold (soft speech / breath). */
  inPause: boolean;
  /** 0–1 loop, advances faster when energy is high. */
  phrasePhase: number;
  /** 0–1 decaying bump on energy transients. */
  syllablePulse: number;
};

export function updateSpeechDriveFromUnifiedEnergy(params: {
  speaking: boolean;
  unifiedSmoothed: number;
  delta: number;
}): void {
  const dt = Math.min(Math.max(params.delta, 0), 0.1);

  if (!params.speaking) {
    smoothedEnergy *= Math.pow(0.88, dt * 60);
    if (smoothedEnergy < 0.012) smoothedEnergy = 0;
    prevSyllableTrack = 0;
    syllablePulse *= Math.pow(0.82, dt * 60);
    phrasePhase += dt * 0.12;
    phrasePhase %= 1;
    return;
  }

  const u = Math.min(1, Math.max(0, params.unifiedSmoothed));
  smoothedEnergy = u;

  const dv = Math.max(0, u - prevSyllableTrack);
  prevSyllableTrack = u * 0.35 + prevSyllableTrack * 0.65;
  if (dv > 0.055) {
    syllablePulse = Math.min(1, syllablePulse + 0.38);
  }
  syllablePulse *= Math.pow(0.86, dt * 60);

  const rate = 0.32 + smoothedEnergy * 1.05 + syllablePulse * 0.55;
  phrasePhase += dt * rate;
  while (phrasePhase >= 1) phrasePhase -= 1;
  while (phrasePhase < 0) phrasePhase += 1;
}

const PAUSE_ENERGY_THRESHOLD = 0.038;

/** Baseline energy for motion layers when not speaking — avoids frozen intent/cinematic blend. */
export const IDLE_MOTION_ENERGY_BASE = 0.15;

export function getSpeechDriveSnapshot(speaking: boolean): SpeechDriveSnapshot {
  const inPause = speaking && smoothedEnergy < PAUSE_ENERGY_THRESHOLD;
  const rawE = smoothedEnergy;
  /** Motion layers never use true zero — keeps intent/cinematic/speech coupling alive. */
  const energyForMotion = Math.max(IDLE_MOTION_ENERGY_BASE, rawE);
  return {
    active: speaking && rawE > 0.02,
    energy: energyForMotion,
    inPause,
    phrasePhase,
    syllablePulse,
  };
}
