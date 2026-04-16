/**
 * Intent motor — continuous sine/time bone offsets from motion intent (final pose only).
 * Camera-based eye contact blends with attention (no second animation layer).
 */
'use client';

import * as THREE from 'three';
import type { EmbodimentState, EmotionHint } from '@/lib/avatar/embodimentState';
import { getCognitiveOrchestratorLLMOutput } from '@/lib/ai/cognitiveOrchestrator';
import { isBodyDrivenByVRMA } from '@/lib/avatar/vrmaBodyDrive';
import type { BonePoseMap } from './PoseComposer';
import { applyIntentGestureClipToPose, stepIntentGesturePlayer } from './gesturePlayer';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _dirToCam = new THREE.Vector3();

export type IntentMotorApplyOpts = {
  motionSource: 'VRMA' | 'GESTURE' | 'IDLE';
  gestureLayerW: number;
  /** Fired when intent motor applied meaningful motion this frame (threshold-gated). */
  onMotionApplied?: () => void;
  eyeContact?: {
    cameraPosition: THREE.Vector3;
    headWorldPosition: THREE.Vector3;
  };
};

/** Min blended scale (`s`) before `onMotionApplied` runs — avoids noise from near-zero motion. */
const INTENT_MOTOR_ACTIVITY_NOTIFY_MIN = 0.012;

function notifyIntentMotorApplied(opts: IntentMotorApplyOpts, activityScale: number): void {
  if (activityScale < INTENT_MOTOR_ACTIVITY_NOTIFY_MIN) return;
  opts.onMotionApplied?.();
}

let motorPhaseSec = 0;

function hash01Motor(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 10000) / 10000;
}

let attYawSm = 0;
let attPitchSm = 0;
let gazeFocusSm = 0.88;
let lastIntentMotorKey = '';
let intentChangeMotorT = 0;
let powerSmoothed = 0.45;
let eyeCamYawSm = 0;
let eyeCamPitchSm = 0;

function mulBoneDeltaEuler(finalPose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  const q = finalPose.get(key);
  if (!q) return;
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  finalPose.set(key, _qOut.clone());
}

function mulFirstPresent(finalPose: BonePoseMap, keys: readonly string[], rx: number, ry: number, rz: number): void {
  for (const key of keys) {
    if (finalPose.has(key)) {
      mulBoneDeltaEuler(finalPose, key, rx, ry, rz);
      return;
    }
  }
}

function emphasisSpikeIntent(stress: number, e: number): number {
  return 1 + Math.pow(stress, 1.35) * 0.14 + Math.max(0, e - 0.45) * 0.1;
}

function microNoiseIntent(t: number, seed: number): number {
  return Math.sin(t * 17.3 + seed) * Math.sin(t * 11.9 + seed * 1.9) * 0.00055;
}

type EmotionMul = { amp: number; freq: number; head: number; arms: number; spine: number; asym: number };

function resolveEmotionLabel(emb: EmbodimentState): EmotionHint {
  const ex = emb.hints.emotion;
  if (typeof ex === 'string') {
    const k = ex.toLowerCase().trim();
    if (k === 'happy' || k === 'focused' || k === 'thinking' || k === 'calm' || k === 'intense' || k === 'neutral') {
      return k;
    }
  }
  const tone = getCognitiveOrchestratorLLMOutput()?.tone?.toLowerCase() ?? '';
  if (/warm|happy|posit|joy|encourag|light/u.test(tone)) return 'happy';
  if (/serious|focus|strict|firm|critical/u.test(tone)) return 'focused';
  if (/uncertain|tentative|hesitat|think|wonder/u.test(tone)) return 'thinking';
  if (/calm|soft|slow|gentle|peace/u.test(tone)) return 'calm';
  if (/strong|urgent|intense|emphat|important/u.test(tone)) return 'intense';
  return 'neutral';
}

function emotionProfile(label: EmotionHint): EmotionMul {
  const emotionMul: EmotionMul = { amp: 1, freq: 1, head: 1, arms: 1, spine: 1, asym: 0 };
  switch (label) {
    case 'happy':
      emotionMul.amp = 0.95;
      emotionMul.freq = 1.02;
      emotionMul.head = 1.08;
      emotionMul.arms = 0.95;
      emotionMul.asym = 0.08;
      break;
    case 'focused':
      emotionMul.amp = 0.7;
      emotionMul.freq = 0.8;
      emotionMul.head = 0.6;
      emotionMul.arms = 0.5;
      emotionMul.spine = 1.1;
      break;
    case 'thinking':
      emotionMul.amp = 0.6;
      emotionMul.freq = 0.7;
      emotionMul.head = 1.2;
      emotionMul.asym = 0.4;
      break;
    case 'calm':
      emotionMul.amp = 0.5;
      emotionMul.freq = 0.6;
      break;
    case 'intense':
      emotionMul.amp = 1.05;
      emotionMul.freq = 1.08;
      emotionMul.arms = 1.12;
      emotionMul.head = 1.05;
      break;
    default:
      break;
  }
  return emotionMul;
}

function contextToneMultipliers(emb: EmbodimentState): { amp: number; freq: number } {
  const tone = getCognitiveOrchestratorLLMOutput()?.tone?.toLowerCase() ?? '';
  let amp = 1;
  let freq = 1;
  if (/serious|firm|critical|strict|grave|solemn/u.test(tone)) {
    amp *= 0.85;
    freq *= 0.9;
  }
  if (/excit|enthus|energ|joy|great|fantastic|wow/u.test(tone)) {
    amp *= 1.04;
    freq *= 1.03;
  }
  return { amp, freq };
}

type BehaviorIntel = {
  timingMul: number;
  attYaw: number;
  attPitch: number;
  microBreath: number;
  microShoulder: number;
};

function stepBehaviorIntel(
  emb: EmbodimentState,
  intent: NonNullable<EmbodimentState['intent']['activeIntent']>,
  speak: boolean,
  dt: number,
  tScaled: number,
): BehaviorIntel {
  const key = `${intent}|${speak ? 1 : 0}|${emb.behaviorMode}`;
  if (key !== lastIntentMotorKey) {
    lastIntentMotorKey = key;
    intentChangeMotorT = motorPhaseSec;
  }
  const delaySec = 0.05 + hash01Motor(key + 'delay') * 0.15;
  const since = motorPhaseSec - intentChangeMotorT;
  const timingMul =
    since < delaySec ? 0.28 + 0.72 * Math.min(1, since / delaySec) : 1;

  let yawT = 0;
  let pitchT = 0.008;
  let wt = 0.78;
  if (speak) {
    yawT = 0;
    pitchT = 0.015;
    wt = 1;
  } else if (intent === 'thinking') {
    const ph = motorPhaseSec * 0.14;
    yawT = Math.sin(ph) * 0.044 + Math.sin(ph * 0.63) * 0.024;
    pitchT = 0.012 + Math.sin(ph * 0.41) * 0.029;
    wt = 0.52;
  } else if (intent === 'listening') {
    yawT = Math.sin(motorPhaseSec * 0.088) * 0.012;
    pitchT = 0.021;
    wt = 0.74;
  } else {
    const ph = motorPhaseSec * 0.1;
    yawT = Math.sin(ph) * 0.017;
    pitchT = 0.009;
    wt = 0.4;
  }

  const k = 1 - Math.exp(-dt * 2.6);
  attYawSm = THREE.MathUtils.lerp(attYawSm, yawT * wt, k);
  attPitchSm = THREE.MathUtils.lerp(attPitchSm, pitchT * wt, k);

  let gazeT = 0.9;
  if (speak) gazeT = 0.96;
  else if (intent === 'thinking') gazeT = 0.44;
  else if (intent === 'listening') gazeT = 0.92;
  const gazeWave = 0.82 + 0.18 * Math.sin(tScaled * 0.19);
  const gazeBreak = Math.sin(tScaled * 0.37) > 0.74 ? 0.79 : 1;
  gazeT *= gazeWave * gazeBreak;
  gazeFocusSm = THREE.MathUtils.lerp(gazeFocusSm, gazeT, 1 - Math.exp(-dt * 2.9));

  const microBreath =
    Math.sin(tScaled * 1.08 + 0.4) * 0.0004 + Math.sin(tScaled * 2.31) * 0.00013;
  const microShoulder = Math.sin(tScaled * 0.67 + 1.1) * 0.00052;

  return {
    timingMul,
    attYaw: attYawSm * gazeFocusSm,
    attPitch: attPitchSm * gazeFocusSm,
    microBreath,
    microShoulder,
  };
}

/** World dir → small local yaw/pitch; blend with attention (not override). */
function stepEyeContact(
  opts: IntentMotorApplyOpts,
  intent: NonNullable<EmbodimentState['intent']['activeIntent']>,
  speak: boolean,
  dt: number,
  tScaled: number,
  gazeMul: number,
): { yaw: number; pitch: number } {
  const decay = 1 - Math.exp(-dt * 1.9);
  if (!opts.eyeContact) {
    eyeCamYawSm = THREE.MathUtils.lerp(eyeCamYawSm, 0, decay);
    eyeCamPitchSm = THREE.MathUtils.lerp(eyeCamPitchSm, 0, decay);
    return { yaw: eyeCamYawSm, pitch: eyeCamPitchSm };
  }
  const { cameraPosition, headWorldPosition } = opts.eyeContact;
  _dirToCam.copy(cameraPosition).sub(headWorldPosition);
  if (_dirToCam.lengthSq() < 1e-12) {
    eyeCamYawSm = THREE.MathUtils.lerp(eyeCamYawSm, 0, decay);
    eyeCamPitchSm = THREE.MathUtils.lerp(eyeCamPitchSm, 0, decay);
    return { yaw: eyeCamYawSm, pitch: eyeCamPitchSm };
  }
  _dirToCam.normalize();
  const rawYaw = Math.atan2(_dirToCam.x, _dirToCam.z);
  const rawPitch = Math.asin(THREE.MathUtils.clamp(-_dirToCam.y, -1, 1));
  const eyeDrift =
    Math.sin(tScaled * 0.8) * 0.01 + Math.sin(tScaled * 1.3) * 0.005;
  const holdBreak = 0.7 + 0.3 * Math.sin(tScaled * 0.29);
  let wBlend = 0.22;
  if (speak) wBlend = 0.42;
  else if (intent === 'listening') wBlend = 0.3;
  else if (intent === 'thinking') wBlend = 0.1;
  wBlend *= gazeMul * holdBreak * (0.55 + 0.45 * gazeMul);
  const attW = 0.62 + 0.38 * gazeMul;
  const tgtYaw = rawYaw * wBlend * attW + eyeDrift * 0.016;
  const tgtPitch = rawPitch * wBlend * attW * 0.9 + eyeDrift * 0.012;
  const k = 1 - Math.exp(-dt * 2.4);
  eyeCamYawSm = THREE.MathUtils.lerp(eyeCamYawSm, tgtYaw, k);
  eyeCamPitchSm = THREE.MathUtils.lerp(eyeCamPitchSm, tgtPitch, k);
  return { yaw: eyeCamYawSm, pitch: eyeCamPitchSm };
}

function applyBehaviorOverlay(
  finalPose: BonePoseMap,
  bi: BehaviorIntel,
  s: number,
  eye: { yaw: number; pitch: number },
): void {
  const ay = bi.attYaw + eye.yaw;
  const ap = bi.attPitch + eye.pitch;
  mulBoneDeltaEuler(finalPose, 'neck', ay * 0.48, ap * 0.45, 0);
  mulBoneDeltaEuler(finalPose, 'head', ay * 0.88, ap * 0.9, 0);
  const b = bi.microBreath * (0.55 + 0.45 * s);
  mulBoneDeltaEuler(finalPose, 'spine', b * 0.52, 0, 0);
  mulBoneDeltaEuler(finalPose, 'chest', b * 0.4, 0, b * 0.12);
  const sh = bi.microShoulder * (0.65 + 0.35 * s);
  mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, sh);
  mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -sh * 0.94);
}

let idleBehaviorAccumSec = 0;

function behaviorDisengageT(emb: EmbodimentState, dt: number): number {
  if (emb.behaviorMode === 'IDLE') idleBehaviorAccumSec += dt;
  else idleBehaviorAccumSec = 0;
  return THREE.MathUtils.clamp((idleBehaviorAccumSec - 4) / 30, 0, 1);
}

function userFocusListening(emb: EmbodimentState): boolean {
  return emb.behaviorMode === 'LISTENING' && !emb.speech.active;
}

function strongExplainBurst(emb: EmbodimentState): number {
  const h = emb.hints;
  return THREE.MathUtils.clamp(h.explanation * 0.55 + h.emphasis * 0.45, 0, 1);
}

function applySemanticEmbodimentDeltas(
  finalPose: BonePoseMap,
  emb: EmbodimentState,
  t: number,
  intentScale: number,
  speak: boolean,
  phraseGate: number,
): void {
  const { emphasis, question, uncertainty, explanation } = emb.hints;
  const m = Math.min(1, Math.max(0, intentScale));
  const gateEmEx = speak ? phraseGate : 0;
  const gateQ = speak ? 0.2 + 0.8 * phraseGate : 1;
  const gateUnc = speak ? 0.35 + 0.65 * phraseGate : 1;

  const headPitchAdd =
    emphasis * 0.022 * m * gateEmEx
    + (question > 0.5 ? 0.05 * question * m : 0.03 * question * m) * gateQ
    + explanation * 0.008 * m * gateEmEx;
  const headPitchSub = uncertainty * 0.012 * m * gateUnc;
  mulBoneDeltaEuler(finalPose, 'head', 0, headPitchAdd - headPitchSub, 0);

  if (uncertainty > 0.4) {
    mulBoneDeltaEuler(
      finalPose,
      'head',
      (Math.sin(t * 1.03 + 0.2) * 0.016 + microNoiseIntent(t, 8) * 0.35) * uncertainty * m * gateUnc,
      0,
      0,
    );
  }
  if (explanation > 0.5) {
    const pulse = gateEmEx;
    mulBoneDeltaEuler(finalPose, 'spine', -0.03 * explanation * m * pulse, 0, 0);
    mulBoneDeltaEuler(finalPose, 'chest', -0.012 * explanation * m * pulse, 0, 0);
  }
}

export function applyIntentMotor(
  finalPose: BonePoseMap,
  emb: EmbodimentState,
  delta: number,
  opts: IntentMotorApplyOpts,
): void {
  const dt = Math.min(Math.max(delta, 0), 0.08);
  motorPhaseSec += dt;

  const intent = emb.intent.activeIntent;
  const w = Math.min(1, Math.max(0, emb.intent.intensity));
  if (!intent || w < 0.04) return;

  if (!isBodyDrivenByVRMA(opts)) return;
  if (opts.gestureLayerW > 0.42) return;

  const emotionMul = emotionProfile(resolveEmotionLabel(emb));
  const ctxT = contextToneMultipliers(emb);
  emotionMul.amp *= ctxT.amp;
  emotionMul.freq *= ctxT.freq;
  const tScaled = motorPhaseSec * emotionMul.freq;
  const microVar = Math.sin(tScaled * 1.9) * 0.00055;

  const disengageT = behaviorDisengageT(emb, dt);
  const disengageMul = 1 - 0.38 * disengageT;
  const userFocus = userFocusListening(emb);
  const focusArm = userFocus ? 0.58 : 1;
  const focusNeck = userFocus ? 0.56 : 1;
  const focusHead = userFocus ? 0.62 : 1;

  const speech = emb.speech;
  const e = Math.min(1, Math.max(0, speech.energy));
  const speak = speech.active;
  let energyMul = 0.6 + e * 0.4;
  if (!speak) {
    if (intent === 'thinking') {
      energyMul = Math.max(energyMul, 0.75);
    } else if (intent === 'listening') {
      energyMul = Math.max(energyMul, 0.7);
    }
  }
  const power = w * energyMul;
  powerSmoothed = THREE.MathUtils.lerp(powerSmoothed, power, 1 - Math.exp(-dt * 3.8));
  const bi = stepBehaviorIntel(emb, intent, speak, dt, tScaled);
  const s = powerSmoothed * emotionMul.amp * disengageMul * bi.timingMul;
  const eye = stepEyeContact(opts, intent, speak, dt, tScaled, gazeFocusSm);

  const beat = speech.phrasePhase * Math.PI * 2;
  const stress = Math.min(1, Math.max(0, speech.syllablePulse));
  const genMul = speak ? 0.38 + (1 - e) * 0.52 : 1;
  const phraseMul = speak ? (0.22 + e * 0.78 + stress * 0.5) : 0;
  const phraseGate = speak ? Math.max(0, Math.sin(beat)) : 0;

  const { emphasis, question, uncertainty, explanation } = emb.hints;
  const armSemanticsMul = Math.min(1.35, 1 + emphasis * 0.35 * phraseGate);
  const armExplainMul =
    armSemanticsMul * (1 + explanation * 0.06 * phraseGate) * (1 + Math.max(0, emphasis - 0.25) * 0.1 * phraseGate);

  const mode = emb.behaviorMode;
  const modeArmMul =
    mode === 'RESPONDING' ? 1.04
    : mode === 'ANTICIPATING' ? 1.02
    : mode === 'LISTENING' ? 0.97
    : 1;

  if (emb.behaviorMode === 'ANTICIPATING') {
    const ant = Math.sin(tScaled * 0.36) * 0.42 + 0.58;
    const ms = s * emotionMul.spine;
    mulBoneDeltaEuler(finalPose, 'spine', -0.0105 * ant * ms, 0, 0);
    mulBoneDeltaEuler(finalPose, 'chest', -0.0082 * ant * ms, 0, 0);
    mulBoneDeltaEuler(finalPose, 'neck', -0.0009 * ant * ms, 0, 0);
    mulBoneDeltaEuler(finalPose, 'head', -0.00065 * ant * ms, 0, 0);
  }

  if (intent === 'explaining') {
    const freqE = 1.16;
    const te = tScaled * freqE;
    const headEng = 1.06;
    const armAmp = 1.08;
    const spikeIm = emphasisSpikeIntent(stress, e);
    const strongEx = strongExplainBurst(emb);
    const explainBurstMul = 1 + strongEx * 0.14 * (0.5 + 0.5 * spikeIm);
    const hy =
      ((Math.sin(te * 0.52) * genMul + Math.sin(beat * 0.95) * phraseMul * 0.55) * 0.007 * s + microNoiseIntent(te, 0.4))
      * spikeIm
      * focusNeck
      * headEng;
    const hp =
      ((Math.sin(te * 0.41 + 0.4) * genMul + Math.cos(beat * 1.05) * phraseMul * 0.45) * 0.006 * s
        + emphasis * 0.018 * s * phraseGate
        + microNoiseIntent(te, 1.1))
      * spikeIm
      * focusHead
      * headEng;
    const hr = (Math.sin(te * 0.33 + 1.1) * 0.004 * s * genMul + microNoiseIntent(te, 2.2)) * spikeIm * focusHead * headEng;
    const hyE = (hy + microVar) * emotionMul.head;
    const hpE = hp * emotionMul.head;
    const hrE = hr * emotionMul.head;
    mulBoneDeltaEuler(finalPose, 'neck', hyE * 0.45, hpE * 0.4, hrE * 0.35);
    mulBoneDeltaEuler(finalPose, 'head', hyE * 0.75, hpE * 0.72, hrE * 0.5);

    const asymOffset = emotionMul.asym * Math.sin(tScaled * 0.7) * s;
    const armLoopL =
      Math.sin(te * 0.88 + 0.48) * 0.0035 * s * genMul * armExplainMul * modeArmMul * spikeIm * focusArm * explainBurstMul * armAmp;
    const armLoopR =
      Math.sin(te * 0.88 - 0.41) * 0.0035 * s * genMul * armExplainMul * modeArmMul * spikeIm * focusArm * explainBurstMul * armAmp;
    const armBeat =
      speak
        ? Math.sin(beat) * (0.0048 + stress * 0.0062) * e * s * armExplainMul * modeArmMul * spikeIm * focusArm * explainBurstMul * armAmp
        : 0;
    const forwardPush = strongEx * 0.002 * explainBurstMul * (speak ? phraseGate : 0.35);
    const spineOpen = 0.0019 * s * genMul * spikeIm * (0.55 + 0.45 * e);
    mulBoneDeltaEuler(finalPose, 'spine', (-forwardPush * 0.62 - spineOpen) * emotionMul.spine, 0, 0);
    mulBoneDeltaEuler(finalPose, 'chest', (-forwardPush * 0.52 - spineOpen * 0.85) * emotionMul.spine, 0, 0);

    const armA = (armLoopL + armBeat * 0.92 + microNoiseIntent(te, 0.3) + asymOffset) * emotionMul.arms;
    const armB = (armLoopR * 0.92 - armBeat * 0.78 - asymOffset) * emotionMul.arms;
    mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], 0, armA * 0.6, armA);
    mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], 0, -armB * 0.6, -armB);
    const fore =
      (Math.sin(te * 0.62 + 0.3) * genMul + Math.sin(beat * 2 + 0.4) * phraseMul * 0.35 * e + microNoiseIntent(te, 3.1)) *
      0.0022 *
      s *
      armExplainMul *
      modeArmMul *
      spikeIm *
      focusArm *
      explainBurstMul *
      armAmp *
      emotionMul.arms;
    mulFirstPresent(finalPose, ['lla', 'leftLowerArm'], fore * 0.4, 0, fore * 0.35);
    mulFirstPresent(finalPose, ['rla', 'rightLowerArm'], -fore * 0.4, 0, -fore * 0.35);

    const sh =
      (Math.sin(te * 0.38) * 0.0028 * s * genMul + Math.sin(beat * 1.5) * 0.0016 * phraseMul * e * s)
      * armExplainMul
      * explainBurstMul
      * (1 + strongEx * 0.45)
      * armAmp
      * emotionMul.arms;
    mulBoneDeltaEuler(finalPose, 'leftShoulder', sh * 0.35, 0, sh * 0.5);
    mulBoneDeltaEuler(finalPose, 'rightShoulder', -sh * 0.35, 0, -sh * 0.5);
    applySemanticEmbodimentDeltas(finalPose, emb, tScaled, s, speak, phraseGate);
    applyBehaviorOverlay(finalPose, bi, s, eye);
    stepIntentGesturePlayer({
      dt,
      intent: 'explaining',
      intentW: w * 0.92,
      motorScale: s,
      emphasis: emb.hints.emphasis ?? 0,
    });
    applyIntentGestureClipToPose(finalPose, s);
    notifyIntentMotorApplied(opts, s);
    return;
  }

  if (intent === 'thinking') {
    const freqT = 0.64;
    const tt = tScaled * freqT;
    const armScale = 0.48;
    const spikeIm = emphasisSpikeIntent(stress, e);
    const uncMul = 1 + uncertainty * 0.24;
    const slow = tt * 0.11;
    const tilt = (Math.sin(slow) + microNoiseIntent(tt, 4.2) * 0.6) * 0.0055 * s * uncMul * spikeIm * focusNeck;
    const osc = (Math.sin(tt * 0.72 + 0.5) + microNoiseIntent(tt, 5.1) * 0.5) * 0.0024 * s * genMul * uncMul * spikeIm * focusHead;
    const driftYaw = Math.sin(tt * 0.11 + 2.05) * 0.0026 * s * genMul * uncMul * spikeIm * focusHead;
    const rollAsym = Math.sin(tt * 0.079 + 0.33) * 0.0034 * s * uncMul * spikeIm;
    const headBeat = speak ? Math.sin(beat * 0.65) * 0.0014 * e * phraseMul * s * focusHead : 0;
    const hpExtra = (explanation * 0.006 * phraseGate + question * 0.004 * (speak ? 0.25 + 0.75 * phraseGate : 1)) * s * focusHead;
    const asymT = emotionMul.asym * Math.sin(tScaled * 0.7) * s;
    const nYaw = (tilt * 0.5 + osc * 0.25 + headBeat * 0.4 + driftYaw * 0.42 + microVar + asymT) * emotionMul.head;
    const nPt = (tilt * 0.35 + hpExtra * 0.45) * emotionMul.head;
    const nRr = (osc * 0.3 + rollAsym * 0.55) * emotionMul.head;
    const hYaw = (tilt * 0.85 + osc * 0.4 + headBeat + driftYaw * 0.88 + microVar + asymT) * emotionMul.head;
    const hPt = (tilt * 0.55 + osc * 0.25 + hpExtra) * emotionMul.head;
    const hRr = (osc * 0.35 + rollAsym * 0.92) * emotionMul.head;
    mulBoneDeltaEuler(finalPose, 'neck', nYaw, nPt, nRr);
    mulBoneDeltaEuler(finalPose, 'head', hYaw, hPt, hRr);

    const swayBaseL =
      Math.sin(tt * 0.31 + 0.52) * 0.0016 * s * genMul * uncMul * (1 + emphasis * 0.25 * (speak ? phraseGate : 0.35)) * spikeIm * focusArm * armScale;
    const swayBaseR =
      Math.sin(tt * 0.31 - 0.47) * 0.0016 * s * genMul * uncMul * (1 + emphasis * 0.25 * (speak ? phraseGate : 0.35)) * spikeIm * focusArm * armScale;
    const swayL = (swayBaseL + asymT) * emotionMul.arms;
    const swayR = (swayBaseR - asymT) * emotionMul.arms;
    mulFirstPresent(finalPose, ['lua', 'leftUpperArm'], swayL * 0.3, swayL, 0);
    mulFirstPresent(finalPose, ['rua', 'rightUpperArm'], -swayR * 0.3, -swayR, 0);
    applySemanticEmbodimentDeltas(finalPose, emb, tScaled, s, speak, phraseGate);
    applyBehaviorOverlay(finalPose, bi, s, eye);
    stepIntentGesturePlayer({
      dt,
      intent: 'thinking',
      intentW: w * 0.48,
      motorScale: s,
      emphasis: emb.hints.emphasis ?? 0,
    });
    applyIntentGestureClipToPose(finalPose, s);
    notifyIntentMotorApplied(opts, s);
    return;
  }

  if (intent === 'listening') {
    const listMul = 0.58 + 0.12 * e;
    const driftAtten = 0.48;
    const spikeIm = emphasisSpikeIntent(stress, e);
    const agreeRhythm =
      emb.behaviorMode === 'LISTENING' && !speak
        ? (Math.sin(tScaled * 3.35) * 0.00115 * s + Math.sin(tScaled * 6.8) * 0.00045 * s) * listMul
        : 0;
    const affirmMicro =
      emb.behaviorMode === 'LISTENING' && !speak
        ? Math.max(0, Math.sin(tScaled * 2.9)) * 0.00055 * s * (0.65 + emb.hints.emphasis * 0.45) * listMul
        : 0;
    const nodBase = (Math.sin(tScaled * 0.22) + microNoiseIntent(tScaled, 6.2) * 0.35) * 0.002 * s * spikeIm * focusNeck * listMul;
    const nodPhrase = speak ? Math.sin(beat * 0.88) * 0.0012 * e * s * spikeIm * listMul : 0;
    const nod =
      nodBase + nodPhrase + question * 0.0015 * s * (speak ? 0.2 + 0.8 * phraseGate : 1) * listMul + agreeRhythm;
    const leanFwd = 0.00085 * s * spikeIm * (0.7 + 0.3 * w);
    const nodNeck = (nod * 0.48 + leanFwd * 0.55) * emotionMul.head;
    const nodHead = (nod * 0.62 + affirmMicro + leanFwd) * emotionMul.head;
    mulBoneDeltaEuler(finalPose, 'neck', 0, nodNeck, 0);
    mulBoneDeltaEuler(finalPose, 'head', microVar * emotionMul.head, nodHead, 0);

    const drift =
      (Math.sin(tScaled * 0.18 + 0.7) + microNoiseIntent(tScaled, 7.0) * 0.35) * 0.0015 * s * genMul * spikeIm * focusHead * driftAtten * listMul
      * emotionMul.head;
    mulBoneDeltaEuler(finalPose, 'head', drift * 0.28, 0, 0);

    const micro =
      Math.sin(tScaled * 0.35) * 0.0011 * s * genMul * (1 + emphasis * 0.2 * (speak ? phraseGate : 0.4)) * focusArm * listMul * emotionMul.arms;
    mulBoneDeltaEuler(finalPose, 'leftShoulder', 0, 0, micro);
    mulBoneDeltaEuler(finalPose, 'rightShoulder', 0, 0, -micro);
    mulBoneDeltaEuler(finalPose, 'spine', leanFwd * 0.9 * emotionMul.spine, 0, 0);
    mulBoneDeltaEuler(finalPose, 'chest', leanFwd * 0.75 * emotionMul.spine, 0, 0);
    applySemanticEmbodimentDeltas(finalPose, emb, tScaled, s, speak, phraseGate);
    applyBehaviorOverlay(finalPose, bi, s, eye);
    stepIntentGesturePlayer({
      dt,
      intent: 'listening',
      intentW: w * 0.42,
      motorScale: s,
      emphasis: emb.hints.emphasis ?? 0,
    });
    applyIntentGestureClipToPose(finalPose, s);
    notifyIntentMotorApplied(opts, s);
  }
}
