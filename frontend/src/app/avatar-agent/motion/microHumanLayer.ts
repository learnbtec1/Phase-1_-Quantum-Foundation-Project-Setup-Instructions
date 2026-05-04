/**
 * Micro human behavior — additive Euler deltas on the final pose (no play(), no authority).
 * Sine + simplex noise mix; amplitudes ~0.002–0.01 rad. Stacks after presence / intent motor / motion driver.
 */
'use client';

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import { getLastIntentUpdateTime } from '@/lib/ai/cognitiveOrchestrator';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { nowMs as masterClockNowMs } from '@/lib/avatar/masterClock';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

/** Deterministic noise (stable session-to-session for same t). */
const noise3 = createNoise3D(() => 0.5);

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 10000) / 10000;
}

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function mulFirstPresent(
  finalPose: BonePoseMap,
  keys: string[],
  rx: number,
  ry: number,
  rz: number,
): void {
  for (const key of keys) {
    if (!finalPose.has(key) || isPoseKeyProcedurallySuppressed(key)) continue;
    mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
    return;
  }
}

// ─── Attention shift (thinking): new drift every 2–4s (deterministic) ───
let attPhase = -1;
let attYaw = 0;
let attPitch = 0;
let attYawTgt = 0;
let attPitchTgt = 0;

// ─── Rhythm break: dip ~300ms at start of each 3–6s cycle ───
const RHYTHM_PERIOD_MS = 3000 + hash01('micro-rhythm-period') * 3000;
const RHYTHM_DIP_MS = 300;

function rhythmDipMul(now: number): number {
  const w = now % RHYTHM_PERIOD_MS;
  return w < RHYTHM_DIP_MS ? 0.58 : 1;
}

/**
 * Subtle, non-deterministic-looking life on top of the composed pose.
 * @param t Elapsed time in seconds (same convention as skeleton `useFrame` clock).
 */
export function applyMicroHumanBehavior(
  finalPose: BonePoseMap,
  emb: Readonly<EmbodimentState>,
  delta: number,
  t: number,
  /** TTS / lip-sync — slightly more life; silent = calmer micro-motion */
  speaking = false,
): void {
  const dt = Math.min(Math.max(delta, 0), 0.08);
  const now = masterClockNowMs();

  const n1 = noise3(t * 0.17, 1.3, 0.2);
  const n2 = noise3(0.4, t * 0.19, 0.7);
  const n3 = noise3(t * 0.13, 2.1, 0.5);

  /** Base scale: keep within ~0.002–0.01 rad. */
  const base = 1;

  let ampMul = rhythmDipMul(now) * base;
  let noiseMul = 1;
  let jitterMul = 1;

  if (speaking) {
    ampMul *= 1.08;
    noiseMul *= 1.05;
  } else {
    ampMul *= 0.96;
    noiseMul *= 0.97;
  }

  // Cinematic dominance: when intent gesture is active, slam micro-human life.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _microIntentW = Math.min(1, Math.max(0, (globalThis as any).__intentAttenuation ?? 0));
  if (_microIntentW > 0.4) {
    ampMul *= 0.10;
    noiseMul *= 0.10;
    jitterMul *= 0.10;
  }

  const intent = emb.intent.activeIntent;
  const sinceMotionMs = emb.intent.startTime > 0 ? now - emb.intent.startTime : Number.POSITIVE_INFINITY;
  const lastCog = getLastIntentUpdateTime();
  const sinceCogMs = lastCog > 0 ? now - lastCog : Number.POSITIVE_INFINITY;
  /** Nearest “intent changed” signal — motion snapshot + cognitive lifecycle. */
  const sinceIntentChangeMs = Math.min(sinceMotionMs, sinceCogMs);

  // E. Focus lock — listening: calmer, slightly forward
  const focusListening = emb.behaviorMode === 'LISTENING';
  if (focusListening) {
    noiseMul *= 0.52;
    jitterMul *= 0.48;
    ampMul *= 0.72;
  }

  // A. Hesitation — early responding window: softer + micro jitter (not frozen)
  const hesitating =
    emb.behaviorMode === 'RESPONDING'
    && sinceIntentChangeMs < 400;
  if (hesitating) {
    const fade = 1 - sinceIntentChangeMs / 400;
    ampMul *= 0.62 + 0.18 * (1 - fade);
    jitterMul *= 1.35 * fade;
  }

  // B. Attention shift — thinking intent: slow drift, retarget on 2–4s grid
  const attPeriodMs = 2000 + hash01('micro-att-period') * 2000;
  const phase = Math.floor(now / attPeriodMs);
  if (intent === 'thinking') {
    if (phase !== attPhase) {
      attPhase = phase;
      attYawTgt = (hash01(`micro-ay${phase}`) - 0.5) * 0.016;
      attPitchTgt = (hash01(`micro-ap${phase}`) - 0.5) * 0.012;
    }
    const k = 1 - Math.exp(-dt * 0.75);
    attYaw = THREE.MathUtils.lerp(attYaw, attYawTgt, k);
    attPitch = THREE.MathUtils.lerp(attPitch, attPitchTgt, k);
  } else {
    attYaw = THREE.MathUtils.lerp(attYaw, 0, 1 - Math.exp(-dt * 1.2));
    attPitch = THREE.MathUtils.lerp(attPitch, 0, 1 - Math.exp(-dt * 1.2));
    if (Math.abs(attYaw) < 1e-4 && Math.abs(attPitch) < 1e-4) attPhase = -1;
  }

  // C. Micro decisions — uncertainty: asymmetrical wobble (non-rhythmic mix)
  const unc = emb.hints.uncertainty;
  let uncW = 0;
  if (unc > 0.4) {
    uncW = Math.min(1, (unc - 0.4) / 0.6);
  }
  const wobbleYaw =
    (Math.sin(t * 0.71 + 0.33) * 0.004 + n1 * 0.005 + Math.sin(t * 2.17) * 0.0012)
    * uncW
    * ampMul;
  const wobblePitch =
    (Math.cos(t * 0.58 + 1.1) * 0.0035 + n2 * 0.0045)
    * uncW
    * ampMul;
  const wobbleRoll =
    (n3 * 0.006 + Math.sin(t * 0.91 + 0.05) * 0.002)
    * uncW
    * 0.55
    * ampMul;
  const asym = (hash01('micro-unc-asym') - 0.5) * 0.002 * uncW * ampMul;

  // Compose head/neck deltas
  const jx = (n2 * 0.007 + Math.sin(t * 5.3 + n1 * 2)) * jitterMul * ampMul * (hesitating ? 0.85 : 0.35);
  const jy = (n3 * 0.006 + Math.sin(t * 4.7 + 0.4)) * jitterMul * ampMul * (hesitating ? 0.85 : 0.35);
  const jz = (n1 * 0.005 + Math.sin(t * 6.1)) * jitterMul * ampMul * (hesitating ? 0.7 : 0.3);

  let headYaw =
    attYaw * ampMul * (intent === 'thinking' ? 1 : 0)
    + wobbleYaw
    + jy * noiseMul;
  let headPitch =
    attPitch * ampMul * (intent === 'thinking' ? 1 : 0)
    + wobblePitch
    + jx * noiseMul;
  let headRoll = wobbleRoll + jz * noiseMul + asym;

  /** Slow head/neck drift when fully idle — independent of uncertainty (anti-freeze). */
  const idleAlive = emb.behaviorMode === 'IDLE' && !speaking;
  if (idleAlive) {
    const drift = ampMul * 0.9;
    headYaw += Math.sin(t * 0.29 + 0.2) * 0.00125 * drift;
    headPitch += Math.cos(t * 0.33 + 0.6) * 0.00105 * drift;
    headRoll += Math.sin(t * 0.21 + 1.1) * 0.0009 * drift;
  }

  if (focusListening) {
    headPitch += 0.0012 * ampMul;
    headYaw *= 0.82;
    headRoll *= 0.65;
  }

  // Clamp micro channel to requested band
  const clampMicro = (v: number) => THREE.MathUtils.clamp(v, -0.01, 0.01);
  headYaw = clampMicro(headYaw);
  headPitch = clampMicro(headPitch);
  headRoll = clampMicro(headRoll);

  mulBoneDeltaEuler(finalPose, 'neck', headYaw * 0.48, headPitch * 0.5, headRoll * 0.42);
  mulBoneDeltaEuler(finalPose, 'head', headYaw * 0.92, headPitch * 0.88, headRoll * 0.72);

  // Subtle torso coupling (hesitation / rhythm / uncertainty only — not a new animation)
  const spineTw =
    (wobbleYaw * 0.22 + (hesitating ? -jx * 0.15 : 0)) * ampMul
    + (focusListening ? 0 : n2 * 0.001 * noiseMul * ampMul)
    + (idleAlive ? Math.sin(t * 0.18) * 0.00045 * ampMul : 0);
  const chestT =
    (wobblePitch * 0.18 + (hesitating ? -jy * 0.12 : 0)) * ampMul
    + (idleAlive ? Math.cos(t * 0.22 + 0.4) * 0.00038 * ampMul : 0);

  mulBoneDeltaEuler(finalPose, 'spine', spineTw * 0.55, chestT * 0.35, spineTw * 0.2);
  mulBoneDeltaEuler(finalPose, 'chest', spineTw * 0.35, chestT * 0.45, -spineTw * 0.15);

  if (uncW > 0.08) {
    mulFirstPresent(
      finalPose,
      ['lua', 'leftUpperArm'],
      asym * 0.45,
      wobblePitch * 0.35 * uncW,
      wobbleRoll * 0.3 * uncW,
    );
    mulFirstPresent(
      finalPose,
      ['rua', 'rightUpperArm'],
      -asym * 0.42,
      -wobblePitch * 0.28 * uncW,
      -wobbleRoll * 0.25 * uncW,
    );
  }
}
