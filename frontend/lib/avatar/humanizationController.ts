/**
 * Phase 4 — deterministic humanization state (breathing profile, blink edges, freeze heal, validation log).
 */
'use client';

import * as THREE from 'three';
import { nowMs } from '@/lib/avatar/masterClock';
import { deterministicNoiseUnit, getNoiseTimeSec } from '@/lib/avatar/deterministicNoiseController';
import type { BrainStatePayload } from '@/lib/avatar/brainStatePayload';
import { getBehaviorMotionState } from '@/lib/behavior/behaviorMotionBrain';

export type BreathingMode = 'idle' | 'speaking' | 'thinking';

export const EmotionConfig = {
  neutral: { amp: 1, speed: 1 },
  serious: { amp: 0.6, speed: 0.8 },
  happy: { amp: 1.2, speed: 1.1 },
  concerned: { amp: 0.7, speed: 0.9 },
} as const;

export type HumanizationSnapshot = {
  breathingMode: BreathingMode;
  breathFreqHz: number;
  breathAmpMul: number;
  noiseAmpRad: number;
  motionSpeedMul: number;
  saccadeYaw: number;
  saccadePitch: number;
  fixationYaw: number;
  fixationPitch: number;
  stabilizeDriftYaw: number;
  stabilizeDriftPitch: number;
  blinkOpen: number;
  anticipationNeckTilt: number;
  freezeHealNeckTilt: number;
  freezeHealShoulder: number;
  tSec: number;
  logEveryMs: number;
};

let _breathFreqTarget = 0.25;
let _breathFreqSmoothed = 0.25;
let _breathAmpTarget = 1;
let _breathAmpSmoothed = 1;
let _prevBlinkSignal = -1;
let _lastHealInjectAtMs = -1;
let _lastLogAtMs = 0;
let _anticipationNeckTilt = 0;
let _anticipationUntilMs = 0;
let _freezeHealPulse = 0;

export function preActionDelayMs(urgency: number): number {
  const u = THREE.MathUtils.clamp(urgency, 0, 1);
  return THREE.MathUtils.lerp(220, 120, u);
}

export function beginAnticipationPhase(durationMs: number, microNeckTiltRad: number): void {
  _anticipationNeckTilt = microNeckTiltRad;
  _anticipationUntilMs = nowMs() + durationMs;
}

export function cancelAnticipationPhase(): void {
  _anticipationNeckTilt = 0;
  _anticipationUntilMs = 0;
}

export function isAnticipationHumanizationActive(now: number): boolean {
  return now < _anticipationUntilMs;
}

function emotionKeys(em: BrainStatePayload['emotion']): keyof typeof EmotionConfig {
  if (em === 'serious' || em === 'happy' || em === 'concerned') return em;
  return 'neutral';
}

function smoothToward(current: number, target: number, delta: number, lambda: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

export function tickHumanization(args: {
  delta: number;
  nowMs: number;
  speaking: boolean;
  thinking: boolean;
  payload: BrainStatePayload | null;
}): HumanizationSnapshot {
  const tSec = getNoiseTimeSec();
  const em = args.payload?.emotion ?? 'neutral';
  const calm = THREE.MathUtils.clamp(args.payload?.personality.calmness ?? 0.5, 0, 1);
  const expr = THREE.MathUtils.clamp(args.payload?.personality.expressiveness ?? 0.5, 0, 1);
  const ec = EmotionConfig[emotionKeys(em)];

  let mode: BreathingMode = 'idle';
  if (args.speaking) mode = 'speaking';
  else if (args.thinking) mode = 'thinking';

  if (mode === 'idle') {
    _breathFreqTarget = 0.25 * (0.85 + calm * 0.15);
    _breathAmpTarget = 1.1 * ec.amp * (0.75 + expr * 0.45);
  } else if (mode === 'speaking') {
    _breathFreqTarget = 0.625 * ec.speed;
    _breathAmpTarget = 0.55 * ec.amp * (0.7 + expr * 0.25);
  } else {
    _breathFreqTarget = 0.31 * (0.9 + calm * 0.1);
    _breathAmpTarget = 0.88 * ec.amp;
  }

  _breathFreqSmoothed = smoothToward(_breathFreqSmoothed, _breathFreqTarget, args.delta, 5.5);
  _breathAmpSmoothed = smoothToward(_breathAmpSmoothed, _breathAmpTarget, args.delta, 4.5);

  const noiseBase = 0.018 * ec.amp * (0.6 + expr * 0.5) * (1 - calm * 0.35);
  const noiseAmpRad = Math.min(0.02, noiseBase);

  const saccade =
    (Math.sin(tSec * 8.7) * 0.14 + deterministicNoiseUnit(tSec * 0.17 + 0.31) * 0.86) *
    0.002 *
    ec.amp;
  const fixWindow = Math.floor(tSec / 2.718281828);
  const fixationYaw = Math.sin(fixWindow * 1.414213562) * 0.004;
  const fixationPitch = Math.cos(fixWindow * 1.732050808) * 0.003;
  const stab = deterministicNoiseUnit(tSec * 0.08);
  const stabilizeDriftYaw = stab * 0.003;
  const stabilizeDriftPitch = deterministicNoiseUnit(tSec * 0.06 + 0.5) * 0.0025;

  const blinkFreq = 0.35 + (1 - calm) * 0.25 + (em === 'concerned' ? 0.12 : 0);
  const blinkOpen = Math.sin(tSec * blinkFreq * Math.PI * 2);

  const bm = getBehaviorMotionState();
  const motionStale = bm.lastActionTime > 0 && args.nowMs - bm.lastActionTime > 2000;
  if (motionStale && args.nowMs - _lastHealInjectAtMs > 4000) {
    _lastHealInjectAtMs = args.nowMs;
    _freezeHealPulse = 1;
  }
  _freezeHealPulse = smoothToward(_freezeHealPulse, 0, args.delta, 4);

  let antTilt = 0;
  if (args.nowMs < _anticipationUntilMs) {
    antTilt = _anticipationNeckTilt;
  } else if (_anticipationNeckTilt !== 0) {
    _anticipationNeckTilt = smoothToward(_anticipationNeckTilt, 0, args.delta, 8);
    antTilt = _anticipationNeckTilt;
  }

  const motionDebugLog =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_MOTION === 'true';
  if (motionDebugLog && args.nowMs - _lastLogAtMs > 900) {
    _lastLogAtMs = args.nowMs;
    // eslint-disable-next-line no-console
    console.log('[Humanization]', JSON.stringify({
      anticipationMs: Math.max(0, _anticipationUntilMs - args.nowMs),
      noiseAmp: Number(noiseAmpRad.toFixed(5)),
      breathingMode: mode,
      gazeMode: args.payload?.gazeMode ?? 'direct',
      emotion: em,
      personality: args.payload?.personality ?? { calmness: calm, expressiveness: expr },
      t: Number(tSec.toFixed(3)),
    }));
  }

  return {
    breathingMode: mode,
    breathFreqHz: _breathFreqSmoothed,
    breathAmpMul: _breathAmpSmoothed,
    noiseAmpRad,
    motionSpeedMul: ec.speed * (1 - calm * 0.15),
    saccadeYaw: saccade,
    saccadePitch: saccade * 0.65,
    fixationYaw,
    fixationPitch,
    stabilizeDriftYaw,
    stabilizeDriftPitch,
    blinkOpen,
    anticipationNeckTilt: antTilt,
    freezeHealNeckTilt: 0.012 * _freezeHealPulse,
    freezeHealShoulder: 0.008 * _freezeHealPulse,
    tSec,
    logEveryMs: 900,
  };
}

export function shouldTriggerBlinkEdge(snapshot: HumanizationSnapshot): boolean {
  const th = 0.92;
  const crossed = _prevBlinkSignal < th && snapshot.blinkOpen >= th;
  _prevBlinkSignal = snapshot.blinkOpen;
  return crossed;
}

export function blinkDurationMsForEmotion(em: BrainStatePayload['emotion']): number {
  const base = em === 'concerned' ? 140 : em === 'happy' ? 160 : 150;
  return THREE.MathUtils.clamp(base, 120, 180);
}
