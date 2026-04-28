/**
 * Hybrid motion driver — extra continuous, intent-shaped offsets on the final pose.
 * Additive only; does not replace VRMA or gesture play(). No events.
 */
'use client';

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import type { EmbodimentState } from '@/lib/avatar/embodimentState';
import { isBodyDrivenByVRMA } from '@/lib/avatar/vrmaBodyDrive';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

const noise3 = createNoise3D(() => Math.random());

/** Separate phase from intent motor — slower “through-line” continuity. */
let driverPhaseSec = 0;

/** Scales continuous intent-shaped bone deltas (explaining / thinking / listening). */
const DRIVER_GLOBAL_MUL = 1.0;

// ─── Variation memory: alternate styles when intent session changes (startTime) ───
let lastExplainStart = -1;
let lastThinkStart = -1;
let lastListenStart = -1;
let variantExplaining = 0;
let variantThinking = 0;
let variantListening = 0;

function syncMotionVariants(emb: EmbodimentState): void {
  const intent = emb.intent.activeIntent;
  const st = emb.intent.startTime;
  if (intent === 'explaining') {
    if (lastExplainStart >= 0 && st !== lastExplainStart) {
      variantExplaining = (variantExplaining + 1) % 3;
    }
    lastExplainStart = st;
  } else {
    lastExplainStart = -1;
  }
  if (intent === 'thinking') {
    if (lastThinkStart >= 0 && st !== lastThinkStart) {
      variantThinking = (variantThinking + 1) % 2;
    }
    lastThinkStart = st;
  } else {
    lastThinkStart = -1;
  }
  if (intent === 'listening') {
    if (lastListenStart >= 0 && st !== lastListenStart) {
      variantListening = (variantListening + 1) % 2;
    }
    lastListenStart = st;
  } else {
    lastListenStart = -1;
  }
}

/** Syllable / energy peaks → short amplitude boost (arms + head). */
function emphasisSpike(stress: number, e: number): number {
  return 1 + Math.pow(Math.max(0, stress), 1.45) * 0.52 + Math.max(0, e - 0.52) * 0.4;
}

// ─── Interaction context (EmbodimentState only) — mirrors intentMotor idle accum ───
let idleBehaviorAccumSecDriver = 0;

function behaviorDisengageTDriver(emb: EmbodimentState, dt: number): number {
  if (emb.behaviorMode === 'IDLE') idleBehaviorAccumSecDriver += dt;
  else idleBehaviorAccumSecDriver = 0;
  return THREE.MathUtils.clamp((idleBehaviorAccumSecDriver - 4) / 30, 0, 1);
}

function userFocusListeningDriver(emb: EmbodimentState): boolean {
  return emb.behaviorMode === 'LISTENING' && !emb.speech.active;
}

function strongExplainHints(emb: EmbodimentState): number {
  const h = emb.hints;
  return THREE.MathUtils.clamp(h.explanation * 0.55 + h.emphasis * 0.45, 0, 1);
}

/** Small organic jitter on top of sinusoids. */
function nDriver(t: number, u: number, v: number, amp: number): number {
  return noise3(t * 0.14 + u, u * 0.7, v * 0.9) * amp;
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

function mulFirstPresent(finalPose: BonePoseMap, keys: readonly string[], rx: number, ry: number, rz: number): void {
  for (const key of keys) {
    if (!finalPose.has(key) || isPoseKeyProcedurallySuppressed(key)) continue;
    mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
    return;
  }
}

export type MotionDriverApplyOpts = {
  motionSource: 'VRMA' | 'GESTURE' | 'IDLE';
  gestureLayerW: number;
};

/**
 * Continuous embodiment layer: spine/chest/neck/arms shaped by intent + speech.
 * Runs after presence + intent motor; additive quaternions on `finalPose`.
 */
export function applyMotionDriver(
  finalPose: BonePoseMap,
  emb: EmbodimentState,
  delta: number,
  opts: MotionDriverApplyOpts,
): void {
  if (!isBodyDrivenByVRMA(opts)) return;
  /** With VRMA globally off, gesture weight does not skip this layer — intent-shaped motion stays on without VRMA clips. */
  if (opts.gestureLayerW > 0.42 && !isVrmaPlaybackGloballyDisabled()) return;

  const intent = emb.intent.activeIntent;
  const w = Math.min(1, Math.max(0, emb.intent.intensity));
  if (!intent || w < 0.04) return;

  syncMotionVariants(emb);

  const dt = Math.min(Math.max(delta, 0), 0.08);
  driverPhaseSec += dt;
  const t = driverPhaseSec;

  const disengageT = behaviorDisengageTDriver(emb, dt);
  const disengageMul = 1 - 0.36 * disengageT;
  const userFocus = userFocusListeningDriver(emb);
  const focusArm = userFocus ? 0.74 : 1;
  const focusHead = userFocus ? 0.68 : 1;
  const focusNeck = userFocus ? 0.7 : 1;

  const m = w * DRIVER_GLOBAL_MUL * disengageMul;

  const speech = emb.speech;
  const e = Math.min(1, Math.max(0, speech.energy));
  const beat = speech.phrasePhase * Math.PI * 2;
  const stress = Math.min(1, Math.max(0, speech.syllablePulse));
  const speak = speech.active;
  const phraseGate = speak ? Math.max(0, Math.sin(beat)) : 0;
  const genMul = speak ? 0.42 + (1 - e) * 0.48 : 1;
  const spike = emphasisSpike(stress, e);
  const strongEx = intent === 'explaining' ? strongExplainHints(emb) : 0;
  const explainBurst = 1 + strongEx * 0.42 * (0.45 + 0.55 * spike);

  /** Spine leads; chest/neck/head follow with phase lag (radians in sin args). */
  const CH_S = 0;
  const CH_C = 0.14;
  const CH_N = 0.28;
  const CH_H = 0.42;
  /** Left / right arm channels — different phase so motion is not mirrored. */
  const φL = 0.71;
  const φR = -0.53;
  /** Head not perfectly centered on neck. */
  const headBiasYaw = 0.019;

  const nv = variantExplaining;
  const freqArm = nv === 0 ? 0.29 : nv === 1 ? 0.36 : 0.24;
  const freqHead = nv === 0 ? 0.55 : nv === 1 ? 0.62 : 0.48;
  const spineMul = nv === 2 ? 1.35 : nv === 1 ? 0.85 : 1;

  if (intent === 'explaining') {
    const arcWide =
      (Math.sin(t * freqArm + φL) + nDriver(t, 1, 2, 0.22)) * 0.0055 * m * genMul * spike * focusArm * explainBurst;
    const arcWideR =
      (Math.sin(t * freqArm + φR) + nDriver(t, 2, 1, 0.2)) * 0.0055 * m * genMul * spike * focusArm * explainBurst;
    const arcBeat = speak
      ? Math.sin(beat * 0.9) * (0.0042 + stress * 0.006) * e * m * phraseGate * spike * focusArm * explainBurst
      : 0;
    const armL = arcWide + arcBeat;
    const armR = arcWideR * 0.94 - arcBeat * 0.85;
    mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], armL * 0.65, 0, armL);
    mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], -armR * 0.65, 0, -armR);
    const fore =
      (Math.sin(t * 0.47 + 0.5 + φL * 0.5) * genMul + nDriver(t, 3, 2, 0.18)) * 0.0024 * m * genMul * spike * focusArm * explainBurst;
    const foreR =
      (Math.sin(t * 0.49 + 0.2 + φR * 0.5) * genMul + nDriver(t, 2, 3, 0.17)) * 0.0024 * m * genMul * spike * focusArm * explainBurst;
    mulFirstPresent(finalPose, ['lla', 'leftLowerArm'], fore * 0.45, 0, fore * 0.4);
    mulFirstPresent(finalPose, ['rla', 'rightLowerArm'], -foreR * 0.45, 0, -foreR * 0.4);

    const alignYaw = userFocus ? headBiasYaw * 0.35 : headBiasYaw;
    const dynYaw =
      Math.sin(t * freqHead + CH_N) * 0.0028 * m * genMul * spike * focusNeck
      + (speak ? Math.sin(beat * 1.1 + 0.2) * 0.002 * e * phraseGate * m * spike * focusHead : 0)
      + alignYaw
      + nDriver(t, 4, 1, 0.00035) * spike * (userFocus ? 0.55 : 1);
    const dynPitch =
      (Math.cos(t * 0.44 + 0.3 + CH_H) * 0.0026 * m * genMul * spike + nDriver(t, 1, 4, 0.0003) * spike) * focusHead;
    mulBoneDeltaEuler(finalPose, 'neck', dynYaw * 0.5, dynPitch * 0.55, dynYaw * 0.35);
    mulBoneDeltaEuler(finalPose, 'head', dynYaw * 0.85, dynPitch * 0.8, dynYaw * 0.45);

    const spineOpen = (Math.sin(t * 0.33 + CH_S) + nDriver(t, 0.5, 0.5, 0.12)) * 0.0014 * m * spineMul * (userFocus ? 0.75 : 1);
    const chestLift = (Math.sin(t * 0.27 + 0.8 - CH_C) + nDriver(t, 0.6, 0.4, 0.1)) * 0.0011 * m * spineMul * (userFocus ? 0.75 : 1);
    const pushEx = strongEx * 0.0011 * explainBurst * (speak ? phraseGate : 0.4);
    mulBoneDeltaEuler(finalPose, 'spine', spineOpen * 0.6 - pushEx * 0.5, chestLift * 0.35, spineOpen * 0.25);
    mulBoneDeltaEuler(finalPose, 'chest', spineOpen * 0.35 - pushEx * 0.45, chestLift * 0.5, -spineOpen * 0.2);
    mulBoneDeltaEuler(finalPose, 'leftShoulder', strongEx * 0.00055 * explainBurst * focusArm, 0, strongEx * 0.0004 * explainBurst);
    mulBoneDeltaEuler(finalPose, 'rightShoulder', -strongEx * 0.0005 * explainBurst * focusArm, 0, -strongEx * 0.00035 * explainBurst);

    const legL =
      (Math.sin(t * 0.21 + φL * 0.85) + nDriver(t, 2.1, 1.9, 0.1)) * 0.0015 * m * genMul * spike * focusArm * explainBurst;
    const legR =
      (Math.sin(t * 0.19 + φR * 0.85) + nDriver(t, 1.9, 2.1, 0.1)) * 0.0015 * m * genMul * spike * focusArm * explainBurst;
    mulFirstPresent(finalPose, ['leftUpperLeg'], legL * 0.55, 0, legL * 0.45);
    mulFirstPresent(finalPose, ['rightUpperLeg'], -legR * 0.55, 0, -legR * 0.45);
    mulFirstPresent(finalPose, ['leftLowerLeg'], legL * 0.38, 0, legL * 0.32);
    mulFirstPresent(finalPose, ['rightLowerLeg'], -legR * 0.38, 0, -legR * 0.32);
    mulFirstPresent(finalPose, ['leftFoot'], legL * 0.22, 0, legL * 0.18);
    mulFirstPresent(finalPose, ['rightFoot'], -legR * 0.22, 0, -legR * 0.18);
    return;
  }

  if (intent === 'thinking') {
    const vt = variantThinking;
    const slowFreq = vt === 0 ? 0.07 : 0.055;
    const slow = t * slowFreq;
    const tilt = (Math.sin(slow) + nDriver(t, 5, 2, 0.15)) * 0.0042 * m * focusNeck;
    const rollAsym = (Math.sin(t * 0.11 + 1.2 + vt * 0.4) + nDriver(t, 2, 5, 0.12)) * 0.0016 * m;
    const asymNeck = vt === 0 ? 0.0011 : -0.0009;
    mulBoneDeltaEuler(
      finalPose,
      'neck',
      tilt * 0.55 + rollAsym * 0.3 + asymNeck,
      tilt * 0.4,
      tilt * 0.35 + rollAsym,
    );
    mulBoneDeltaEuler(finalPose, 'head', tilt * 0.85 + headBiasYaw * 0.6 * focusHead, tilt * 0.4, tilt * 0.28 + rollAsym * 0.6);

    mulBoneDeltaEuler(finalPose, 'spine', rollAsym * 0.3, tilt * 0.2, rollAsym * 0.25);
    mulBoneDeltaEuler(finalPose, 'chest', -rollAsym * 0.25, tilt * 0.15, -rollAsym * 0.2);

    const aL = (Math.sin(t * 0.19 + 0.4 + φL) + nDriver(t, 1, 1, 0.1)) * 0.0019 * m * spike * focusArm;
    const aR = (Math.sin(t * 0.17 + 1.1 + φR) + nDriver(t, 3, 3, 0.1)) * 0.0016 * m * spike * focusArm;
    mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], aL, aL * 0.35, rollAsym * 0.4);
    mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], -aR, -aR * 0.35, -rollAsym * 0.35);

    const legTL = (Math.sin(t * 0.12 + φL) + nDriver(t, 2.2, 2.2, 0.09)) * 0.0011 * m * spike * focusArm;
    const legTR = (Math.sin(t * 0.11 + φR) + nDriver(t, 2.3, 2.1, 0.09)) * 0.0011 * m * spike * focusArm;
    mulFirstPresent(finalPose, ['leftUpperLeg'], legTL * 0.45, 0, legTL * 0.4);
    mulFirstPresent(finalPose, ['rightUpperLeg'], -legTR * 0.45, 0, -legTR * 0.4);
    mulFirstPresent(finalPose, ['leftLowerLeg'], legTL * 0.3, 0, legTL * 0.25);
    mulFirstPresent(finalPose, ['rightLowerLeg'], -legTR * 0.3, 0, -legTR * 0.25);
    return;
  }

  if (intent === 'listening') {
    const vl = variantListening;
    const driftFreq = vl === 0 ? 0.11 : 0.095;
    const drift = (Math.sin(t * driftFreq + 0.6) + nDriver(t, 4, 4, 0.14)) * 0.0015 * m * genMul * focusNeck;
    const agreeBeat =
      emb.behaviorMode === 'LISTENING' && !speak
        ? Math.sin(t * 3.2) * 0.00085 * m + Math.sin(t * 6.5) * 0.00035 * m
        : 0;
    const nod =
      (Math.sin(t * 0.15 + CH_N * 0.2) + nDriver(t, 0.2, 0.8, 0.08)) * 0.0016 * m * focusNeck
      + (speak ? Math.sin(beat * 0.65) * 0.0008 * e * m * spike * focusHead : 0)
      + agreeBeat;
    mulBoneDeltaEuler(finalPose, 'neck', drift * 0.35, nod * 0.55, drift * 0.2);
    mulBoneDeltaEuler(
      finalPose,
      'head',
      drift * 0.4 + headBiasYaw * 0.45 * focusHead,
      nod * 0.65,
      drift * 0.15 * (userFocus ? 0.55 : 1),
    );
    mulBoneDeltaEuler(finalPose, 'chest', -nod * 0.12, 0, 0);
    mulBoneDeltaEuler(finalPose, 'spine', -nod * 0.08, 0, 0);
    const micro =
      (Math.sin(t * 0.22 + φL) + nDriver(t, 6, 1, 0.07)) * 0.0009 * m * focusArm;
    const microR =
      (Math.sin(t * 0.23 + φR) + nDriver(t, 1, 6, 0.07)) * 0.0009 * m * focusArm;
    mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], micro, 0, micro * 0.5);
    mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], -microR * 0.85, 0, -microR * 0.45);

    const microLeg =
      (Math.sin(t * 0.18 + φL * 0.6) + nDriver(t, 2.4, 2.5, 0.06)) * 0.00075 * m * genMul * focusArm;
    const microLegR =
      (Math.sin(t * 0.17 + φR * 0.6) + nDriver(t, 2.5, 2.4, 0.06)) * 0.00075 * m * genMul * focusArm;
    mulFirstPresent(finalPose, ['leftUpperLeg'], microLeg * 0.4, 0, microLeg * 0.35);
    mulFirstPresent(finalPose, ['rightUpperLeg'], -microLegR * 0.4, 0, -microLegR * 0.35);
    mulFirstPresent(finalPose, ['leftLowerLeg'], microLeg * 0.28, 0, microLeg * 0.22);
    mulFirstPresent(finalPose, ['rightLowerLeg'], -microLegR * 0.28, 0, -microLegR * 0.22);
  }
}
