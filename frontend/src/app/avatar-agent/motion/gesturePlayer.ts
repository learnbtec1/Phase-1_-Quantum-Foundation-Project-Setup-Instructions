/**
 * Secondary gesture clip layer: samples library poses, blends with current finalPose, cooldown + smooth weights.
 * Does not replace intent motor — runs after procedural layers in applyIntentMotor.
 */
'use client';

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { GestureLibrary, type GestureClipDef } from './gestureLibrary';
import { getCinematicGestureWeightFactor } from '@/ai/avatar/avatarPersonality';
import { getSpeechEmotionSnapshot } from '@/ai/voice/speechEmotionBridge';
import { getSpeechGestureWeightMul } from '@/ai/voice/emotionalCoupling';
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

/** Max contribution vs base pose — hard cap 0.25 (subtle, non-exaggerated). */
const GLOBAL_CLIP_WEIGHT = 0.18;
const GESTURE_WEIGHT_MIN = 0.08;
const GESTURE_WEIGHT_MAX = 0.25;

/** Fade edges inside [0,1] phase to avoid snaps */
const FADE_IN = 0.12;
const FADE_OUT = 0.18;

let activeClip: GestureClipDef | null = null;
let phase = 0;
let smoothedWeight = 0;
let lastClipId: string | null = null;
/** Stagger first clip so the avatar doesn’t gesture immediately on mount. */
let nextAllowedAt = masterClockNowMs() + 500 + Math.random() * 1500;

function randomCooldownMs(): number {
  const t = masterClockNowMs();
  return 1100 + Math.random() * 1700 + Math.sin(t * 0.001) * 80;
}

function easePhase(t: GestureClipDef['easing'], u: number): number {
  const x = THREE.MathUtils.clamp(u, 0, 1);
  if (t === 'linear') return x;
  if (t === 'easeInOut') {
    return x * x * (3 - 2 * x);
  }
  // sineBell — single smooth pulse
  return Math.sin(x * Math.PI);
}

function envelopeNoSnap(u: number): number {
  let m = 1;
  if (u < FADE_IN) m *= u / FADE_IN;
  if (u > 1 - FADE_OUT) m *= (1 - u) / FADE_OUT;
  return THREE.MathUtils.clamp(m, 0, 1);
}

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function mulFirstPresent(
  finalPose: BonePoseMap,
  keys: readonly string[],
  rx: number,
  ry: number,
  rz: number,
): void {
  for (const key of keys) {
    if (finalPose.has(key)) {
      mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
      return;
    }
  }
}

function pickClipForIntent(
  intent: 'explaining' | 'thinking' | 'listening',
  emphasis: number,
): GestureClipDef {
  if (intent === 'explaining' && emphasis > 0.78 && Math.random() < 0.12) {
    return GestureLibrary.emphasis;
  }
  switch (intent) {
    case 'explaining':
      return GestureLibrary.explain;
    case 'thinking':
      return GestureLibrary.thinking;
    case 'listening':
      return GestureLibrary.listening;
    default:
      return GestureLibrary.explain;
  }
}

export type IntentGestureStepParams = {
  dt: number;
  intent: 'explaining' | 'thinking' | 'listening';
  /** intent intensity 0..1 */
  intentW: number;
  /** blended motor scale (s) — attenuates clips when motion is weak */
  motorScale: number;
  emphasis: number;
  /** When false, existing clip still advances; new clips are not started (idle / secondary layers). Default true. */
  allowStartNewClip?: boolean;
};

/**
 * Advance playback and optionally start a new clip when idle + cooldown elapsed.
 */
export function stepIntentGesturePlayer(p: IntentGestureStepParams): void {
  const { dt, intent, intentW, motorScale, emphasis } = p;
  const allowStart = p.allowStartNewClip !== false;
  const t = masterClockNowMs();

  if (activeClip) {
    const dur = Math.max(0.25, activeClip.durationSec);
    phase += dt / dur;
    if (phase >= 1) {
      activeClip = null;
      phase = 0;
      nextAllowedAt = t + randomCooldownMs();
    }
  }

  if (!activeClip) {
    const fadeAlpha = THREE.MathUtils.clamp(1 - Math.exp(-dt * 10), 0.1, 0.2);
    smoothedWeight = THREE.MathUtils.lerp(smoothedWeight, 0, fadeAlpha);
    if (!allowStart) {
      return;
    }
    if (t < nextAllowedAt || intentW < 0.1 || motorScale < 0.03) {
      return;
    }
    const clip = pickClipForIntent(intent, emphasis);
    if (clip.id === lastClipId && Math.random() < 0.62) {
      nextAllowedAt = t + randomCooldownMs() * 0.45;
      return;
    }
    activeClip = clip;
    lastClipId = clip.id;
    phase = 0;
  }

  if (!activeClip) return;

  const u = THREE.MathUtils.clamp(phase, 0, 1);
  const ease = easePhase(activeClip.easing, u) * envelopeNoSnap(u);
  const personalityFactor = getCinematicGestureWeightFactor();
  const speechMul = getSpeechGestureWeightMul(getSpeechEmotionSnapshot());
  const targetW = THREE.MathUtils.clamp(
    GLOBAL_CLIP_WEIGHT
      * personalityFactor
      * speechMul
      * ease
      * THREE.MathUtils.clamp(intentW, 0, 1)
      * THREE.MathUtils.clamp(motorScale * 1.05, 0, 1),
    GESTURE_WEIGHT_MIN,
    GESTURE_WEIGHT_MAX,
  );
  const towardAlpha = THREE.MathUtils.clamp(1 - Math.exp(-dt * 6.8), 0.1, 0.2);
  smoothedWeight = THREE.MathUtils.lerp(smoothedWeight, targetW, towardAlpha);
  smoothedWeight = THREE.MathUtils.clamp(smoothedWeight, GESTURE_WEIGHT_MIN, GESTURE_WEIGHT_MAX);
}

/**
 * Apply current gesture sample as additive deltas to finalPose (call after intent motor overlays).
 */
export function applyIntentGestureClipToPose(finalPose: BonePoseMap, motorScale: number): void {
  if (!activeClip || smoothedWeight < 1e-5) return;
  const w = THREE.MathUtils.clamp(
    smoothedWeight * THREE.MathUtils.clamp(motorScale, 0.12, 1.05),
    GESTURE_WEIGHT_MIN,
    GESTURE_WEIGHT_MAX,
  );

  for (const [key, d] of Object.entries(activeClip.bones)) {
    if (!d) continue;
    const rx = d.rx * w;
    const ry = d.ry * w;
    const rz = d.rz * w;
    if (key === 'lua') {
      mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], rx, ry, rz);
      continue;
    }
    if (key === 'rua') {
      mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], rx, ry, rz);
      continue;
    }
    if (key === 'lla') {
      mulFirstPresent(finalPose, ['lla', 'leftLowerArm'], rx, ry, rz);
      continue;
    }
    if (key === 'rla') {
      mulFirstPresent(finalPose, ['rla', 'rightLowerArm'], rx, ry, rz);
      continue;
    }
    mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
  }
}

/** Test / debug: reset singleton state */
export function resetIntentGesturePlayerForTests(): void {
  activeClip = null;
  phase = 0;
  smoothedWeight = 0;
  lastClipId = null;
  nextAllowedAt = masterClockNowMs();
}
