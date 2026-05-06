'use client';

/**
 * Lip/jaw forensics — cheap probe (≈4 Hz effective) updated from LipSyncManager useFrame.
 */

import type { ActiveFailure } from './types';
import { GESTURE_COLLAPSE_INSPECT_TARGETS } from './EmbodiedDependencyGraph';

let _sampleTick = 0;

let _mouthOpenApprox = 0;
let _lipRms = 0;
let _mouthMeanEma = 0;
let _mouthVarEma = 0;
let _speaking = false;
let _visemeQueueLen = 0;
let _playheadSec = 0;
let _lastCueTSec = 0;
let _driftMs = 0;

export function tickFacialEmbodimentProbe(p: {
  mouthOpenApprox: number;
  lipRms: number;
  speaking: boolean;
  visemeQueueLen: number;
  playheadSec: number;
  lastCueTSec: number;
}): void {
  _sampleTick++;
  if ((_sampleTick & 15) !== 0) return;

  _mouthOpenApprox = p.mouthOpenApprox;
  _lipRms = p.lipRms;
  _speaking = p.speaking;
  _visemeQueueLen = p.visemeQueueLen;
  _playheadSec = p.playheadSec;
  _lastCueTSec = p.lastCueTSec;
  const driftSec =
    p.visemeQueueLen > 0 && p.lastCueTSec >= 0 ? Math.abs(p.playheadSec - p.lastCueTSec) : 0;
  _driftMs = driftSec * 1000;

  _mouthMeanEma = _mouthMeanEma * 0.88 + p.mouthOpenApprox * 0.12;
  const delta = p.mouthOpenApprox - _mouthMeanEma;
  _mouthVarEma = _mouthVarEma * 0.92 + delta * delta * 0.08;
}

export function getFacialProbeSnapshot(): {
  mouthOpenApprox: number;
  lipRms: number;
  speaking: boolean;
  visemeQueueLen: number;
  playheadSec: number;
  lastCueTSec: number;
  driftMs: number;
  jawVarianceEma: number;
} {
  return {
    mouthOpenApprox: _mouthOpenApprox,
    lipRms: _lipRms,
    speaking: _speaking,
    visemeQueueLen: _visemeQueueLen,
    playheadSec: _playheadSec,
    lastCueTSec: _lastCueTSec,
    driftMs: _driftMs,
    jawVarianceEma: _mouthVarEma,
  };
}

const LIP_TARGETS = ['frontend/src/app/avatar-agent/LipSyncManager.tsx'];

export function analyzeFacialEmbodimentFailures(args: {
  speakingTelemetry: boolean;
  speakingZeroEnergy: boolean;
  motionEnergyUnified: number;
}): ActiveFailure[] {
  const p = getFacialProbeSnapshot();
  const out: ActiveFailure[] = [];

  if (args.speakingTelemetry && p.mouthOpenApprox < 0.04 && p.lipRms < 0.004) {
    out.push({
      id: 'lipsync_desync_low_mouth',
      subsystem: 'facial',
      severity: 'warn',
      summary: 'Speech active but mouth opening / RMS remain depressed',
      evidence: [`mouthOpen≈${p.mouthOpenApprox.toFixed(3)}`, `lipRms≈${p.lipRms.toFixed(4)}`],
      inspectTargets: [...LIP_TARGETS],
      confidence: 0.62,
    });
  }

  if (p.visemeQueueLen > 2 && p.driftMs > 220) {
    out.push({
      id: 'phoneme_viseme_misalignment',
      subsystem: 'phoneme_viseme',
      severity: 'warn',
      summary: 'Large viseme cue vs playhead drift',
      evidence: [`driftMs≈${Math.round(p.driftMs)}`, `cues=${p.visemeQueueLen}`],
      inspectTargets: [...LIP_TARGETS, 'frontend/src/lib/avatar/audioTimeline.ts'],
      confidence: Math.min(0.9, 0.45 + p.driftMs / 800),
    });
  }

  if (args.speakingTelemetry && p.jawVarianceEma < 1e-8 && p.lipRms > 0.002) {
    out.push({
      id: 'jaw_freeze_variance',
      subsystem: 'facial',
      severity: 'info',
      summary: 'Low jaw morph variance during voiced audio — possible frozen blend channel',
      evidence: [`jawVarEma≈${p.jawVarianceEma.toExponential(2)}`],
      inspectTargets: [...LIP_TARGETS],
      confidence: 0.48,
    });
  }

  if (args.speakingTelemetry && args.motionEnergyUnified > 0.25 && p.mouthOpenApprox < 0.03) {
    out.push({
      id: 'face_body_contradiction',
      subsystem: 'facial',
      severity: 'warn',
      summary: 'Body motion energy present while facial mouth channel reads idle',
      evidence: [`motionEnergy=${args.motionEnergyUnified.toFixed(2)}`, `mouthOpen=${p.mouthOpenApprox.toFixed(3)}`],
      inspectTargets: [...LIP_TARGETS, ...GESTURE_COLLAPSE_INSPECT_TARGETS],
      confidence: 0.55,
    });
  }

  if (args.speakingTelemetry && args.speakingZeroEnergy && p.mouthOpenApprox < 0.02) {
    out.push({
      id: 'faceless_speech',
      subsystem: 'facial',
      severity: 'critical',
      summary: 'Speaking flag set but unified energy and face embodiment appear dead',
      evidence: ['speakingZeroEnergy telemetry', `mouthOpen=${p.mouthOpenApprox.toFixed(3)}`],
      inspectTargets: [...LIP_TARGETS, 'frontend/src/lib/avatar/unifiedEnergyModel.ts'],
      confidence: 0.72,
    });
  }

  return out;
}
