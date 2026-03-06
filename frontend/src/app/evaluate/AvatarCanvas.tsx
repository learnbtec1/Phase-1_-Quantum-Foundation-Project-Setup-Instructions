'use client';

/**
 * AvatarCanvas v2 — Self-contained R3F canvas with full humanization.
 *
 * HUMANIZATION FEATURES:
 *   • Natural wave: shoulder raise → wrist oscillation → elbow follow-through → smooth lower
 *   • Smooth pose blending: all gestures lerp from current rendered pose (no snapping)
 *   • Organic idle: multi-frequency sway + unique noise phase per instance
 *   • Smooth emotion blending: lerp expression weights over ~300ms (no hard switching)
 *   • Enhanced lip-sync: low-pass filtered, variable frequency (natural syllable variation)
 *   • Torso humanization: spine sway, chest breathing, subtle group drift
 *   • Organic head tracking: lagged lookAt + micro-saccades
 *   • Micro-gestures: Poisson-process (every 4–9s) random head tilt / nod
 *   • Per-gesture randomness: variance parameter alters speed/amplitude each time
 *   • teach.vrm is VRM 0.0 — do NOT call rotateVRM0 (already facing camera)
 */

import React, {
  useRef, useCallback, useState, useEffect, Suspense,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import styles from './AvatarCanvas.module.css';
import type { WordTiming } from '@/ai/lipsync/timing';
import { timingsToVisemeAt, lerpViseme } from '@/ai/lipsync/timing';
import type { VisemeWeights } from '@/ai/lipsync/viseme';
import { PhonemeManager } from '@/ai/avatar/managers';
import { gestureEngine } from '@/ai/cognitive/GestureEngine';
import type { ScheduledGesture } from '@/ai/cognitive/GestureEngine';
import { classifyReplyType, selectMicroExpression } from '@/ai/cognitive/CognitiveEngine';

// ─── Public interface ────────────────────────────────────────────────────────
export interface AvatarCanvasRef {
  speak: (text: string) => void;
}

// ─── Scene constants ─────────────────────────────────────────────────────────
const AVATAR_BASE_Y        = -1.0;
const BREATHE_AMP          = 0.12;  // ↑ visible chest heave (was 0.055)
const BLINK_MIN            = 2.0;
const BLINK_MAX            = 4.5;   // blink more often (was 5.0)
const POSE_BLEND_SPEED     = 6.5;   // ↑ snappier arm transitions (was 5.5)
const EMOTION_BLEND_SPEED  = 5.5;   // ↑ faster emotion switch (was 3.5)
const ZOOM_MIN             = 1.2;
const ZOOM_MAX             = 5.5;
const ZOOM_SPEED           = 0.18;

// ─── Arm-pose types ──────────────────────────────────────────────────────────
/** XYZ Euler angles in radians */
type Rot3 = [number, number, number];

interface ArmPose {
  /** right: upper arm, lower arm, hand */
  rua: Rot3; rla: Rot3; rh: Rot3;
  /** left:  upper arm, lower arm, hand */
  lua: Rot3; lla: Rot3; lh: Rot3;
}

interface ActiveGesture {
  type:       'wave' | 'point' | 'openHand' | 'beat';
  side:       'left' | 'right' | 'both';
  startMs:    number;
  durationMs: number;
  variance:   number;   // 0–1, randomized each dispatch
}

// ─── Phase 4: finger bone names ───────────────────────────────────────────────
const FINGER_BONES = {
  right: {
    thumb:  ['rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal'],
    index:  ['rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal'],
    middle: ['rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal'],
    ring:   ['rightRingProximal',  'rightRingIntermediate',  'rightRingDistal' ],
    little: ['rightLittleProximal','rightLittleIntermediate','rightLittleDistal'],
  },
  left: {
    thumb:  ['leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal'],
    index:  ['leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal'],
    middle: ['leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal'],
    ring:   ['leftRingProximal',  'leftRingIntermediate',  'leftRingDistal' ],
    little: ['leftLittleProximal','leftLittleIntermediate','leftLittleDistal'],
  },
} as const;

type FingerName = keyof typeof FINGER_BONES.right;
type HandSide   = 'left' | 'right';

/**
 * Apply a curl value (0 = open, 1 = fully curled) to all phalanges of a finger.
 * thumb curls slightly differently (Y-axis rotation).
 */
function setFingerCurl(
  humanoid: NonNullable<VRM['humanoid']>,
  side: HandSide,
  finger: FingerName,
  curl: number,
): void {
  const bones = FINGER_BONES[side][finger];
  for (const name of bones) {
    try {
      const bone = humanoid.getNormalizedBoneNode(name as never);
      if (!bone) continue;
      if (finger === 'thumb') {
        bone.rotation.set(0, curl * 0.6, curl * 0.5, 'XYZ');
      } else {
        bone.rotation.set(curl * 1.4, 0, 0, 'XYZ');
      }
    } catch { /* bone absent */ }
  }
}

/**
 * Apply a finger shape to one or both hands:
 *   'open'  — fingers extended (open palm, wave, greet)
 *   'point' — index extended, others curled (point gesture)
 *   'fist'  — all curled (holding / emphasis)
 *   'relax' — gentle idle curl (natural resting hand)
 */
function applyFingerShape(
  humanoid: NonNullable<VRM['humanoid']>,
  side: HandSide,
  shape: 'open' | 'point' | 'fist' | 'relax',
  blend: number,   // 0→no change, 1→full shape
): void {
  const shapes: Record<FingerName, number> = (() => {
    switch (shape) {
      case 'open':  return { thumb: 0.0, index: 0.0, middle: 0.0, ring: 0.0, little: 0.0 };
      case 'point': return { thumb: 0.8, index: 0.0, middle: 0.7, ring: 0.8, little: 0.8 };
      case 'fist':  return { thumb: 0.9, index: 1.0, middle: 1.0, ring: 1.0, little: 1.0 };
      case 'relax': return { thumb: 0.1, index: 0.2, middle: 0.25,ring: 0.28,little: 0.30 };
    }
  })();
  for (const [finger, targetCurl] of Object.entries(shapes) as Array<[FingerName, number]>) {
    setFingerCurl(humanoid, side, finger, targetCurl * blend);
  }
}

// ─── Emotion blend weights ────────────────────────────────────────────────────
type ExprKey = 'happy' | 'sad' | 'angry' | 'relaxed' | 'surprised';
type EmotionWeights = Record<ExprKey, number>;

const EMOTION_WEIGHTS: Record<string, EmotionWeights> = {
  neutral:          { happy: 0,    sad: 0,    angry: 0,    relaxed: 0.25, surprised: 0    },
  friendly:         { happy: 0.70, sad: 0,    angry: 0,    relaxed: 0.20, surprised: 0    },
  happy:            { happy: 0.85, sad: 0,    angry: 0,    relaxed: 0,    surprised: 0    },
  sad:              { happy: 0,    sad: 0.65, angry: 0,    relaxed: 0.10, surprised: 0    },
  angry:            { happy: 0,    sad: 0,    angry: 0.55, relaxed: 0,    surprised: 0    },
  thinking:         { happy: 0,    sad: 0.10, angry: 0,    relaxed: 0.40, surprised: 0    },
  surprised:        { happy: 0.20, sad: 0,    angry: 0,    relaxed: 0,    surprised: 0.80 },
  celebration:      { happy: 1.00, sad: 0,    angry: 0,    relaxed: 0,    surprised: 0.30 },
  strictEvaluation: { happy: 0,    sad: 0,    angry: 0.45, relaxed: 0.20, surprised: 0    },
  encouraging:      { happy: 0.60, sad: 0,    angry: 0,    relaxed: 0.30, surprised: 0    },
  // Full Human Persona Kernel — new emotion blends
  proud:            { happy: 0.75, sad: 0,    angry: 0,    relaxed: 0.30, surprised: 0    },
  curious:          { happy: 0.20, sad: 0,    angry: 0,    relaxed: 0.20, surprised: 0.35 },
  attentive:        { happy: 0.10, sad: 0,    angry: 0,    relaxed: 0.15, surprised: 0.15 },
  concerned:        { happy: 0,    sad: 0.35, angry: 0,    relaxed: 0.25, surprised: 0    },
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
const Z3: Rot3 = [0, 0, 0];

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
function lerp3(a: Rot3, b: Rot3, t: number): Rot3 {
  const c = Math.max(0, Math.min(1, t));
  return [a[0]+(b[0]-a[0])*c, a[1]+(b[1]-a[1])*c, a[2]+(b[2]-a[2])*c];
}
function lerpArmPose(a: ArmPose, b: ArmPose, t: number): ArmPose {
  return {
    rua: lerp3(a.rua, b.rua, t), rla: lerp3(a.rla, b.rla, t), rh: lerp3(a.rh, b.rh, t),
    lua: lerp3(a.lua, b.lua, t), lla: lerp3(a.lla, b.lla, t), lh: lerp3(a.lh, b.lh, t),
  };
}
function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2*c*c : -1+(4-2*c)*c;
}
function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1-(1-c)*(1-c);
}

// ─── Pose calculators ─────────────────────────────────────────────────────────

/**
 * Organic idle pose — multi-frequency sway so motion never repeats exactly.
 * noisePhase is unique per VRMScene instance (prevents synchronized clones).
 */
function idlePose(t: number, noisePhase: number): ArmPose {
  const a   = Math.sin(t * 0.37 + noisePhase) * 0.055;
  const b   = Math.sin(t * 0.73 + noisePhase * 1.7) * 0.022;
  const mic = Math.sin(t * 2.30 + noisePhase * 3.1) * 0.008;
  const r   =  a + b + mic;
  const l   = -(a + b + mic);
  return {
    rua: [r, 0,  0.04], rla: Z3, rh: Z3,
    lua: [l, 0, -0.04], lla: Z3, lh: Z3,
  };
}

/**
 * Natural wave — shoulder raise + wrist oscillation + elbow follow-through.
 * Supports side: 'right' | 'left' | 'both'.
 * For 'both', left arm starts 220 ms behind right for natural stagger.
 */
function wavePose(waveT: number, durSec: number, variance: number, side: 'left' | 'right' | 'both' = 'right'): ArmPose {
  // Shared arm-component calculator for a given time offset
  const computeArm = (t: number) => {
    const speed     = 4.6 + variance * 1.6;
    const amp       = 0.85 + variance * 0.30;
    const armRaise  = easeInOut(Math.min(1, t / 0.5));
    const elbowBend = easeOut(Math.min(1, Math.max(0, (t - 0.15) / 0.45)));
    const wristEnv  = t > 0.35 ? easeInOut(Math.min(1, (t - 0.35) / 0.20)) : 0;
    const wristWave = Math.sin((t - 0.35) * speed) * amp * wristEnv;
    const lowerStart = Math.max(0.5, durSec - 0.60);
    const lowerEase  = t > lowerStart ? easeInOut(Math.min(1, (t - lowerStart) / 0.60)) : 0;
    return {
      raise: armRaise  * (1 - lowerEase),
      elbow: elbowBend * (1 - lowerEase),
      wrist: wristWave * (1 - lowerEase),
    };
  };

  if (side === 'both') {
    const r = computeArm(waveT);
    const l = computeArm(Math.max(0, waveT - 0.22)); // 220 ms natural stagger
    return {
      rua: [-1.05 * r.raise,  0.12 * r.raise,  r.wrist * 0.18],
      rla: [-0.65 * r.elbow,  0,               r.wrist * 0.25],
      rh:  [ 0,               0,               r.wrist        ],
      lua: [-1.05 * l.raise, -0.12 * l.raise, -l.wrist * 0.18],
      lla: [-0.65 * l.elbow,  0,              -l.wrist * 0.25],
      lh:  [ 0,               0,              -l.wrist        ],
    };
  }

  const { raise, elbow, wrist } = computeArm(waveT);
  if (side === 'left') {
    return {
      rua: [0.05 * raise, 0, 0.06 * raise], rla: Z3, rh: Z3,
      lua: [-1.05 * raise, -0.12 * raise, -wrist * 0.18],
      lla: [-0.65 * elbow,  0,            -wrist * 0.25],
      lh:  [ 0,             0,            -wrist        ],
    };
  }
  // default: 'right'
  return {
    rua: [-1.05 * raise,  0.12 * raise,  wrist * 0.18],
    rla: [-0.65 * elbow,  0,             wrist * 0.25],
    rh:  [ 0,             0,             wrist        ],
    lua: [0.05 * raise, 0, -0.06 * raise], lla: Z3, lh: Z3,
  };
}

/** Pointing gesture — shoulder + elbow + wrist alignment, with subtle hold tremor */
function pointPose(progress: number, side: 'left'|'right'|'both', t: number): ArmPose {
  const e    = easeOut(Math.min(1, progress * 3)) * (1 - easeOut(Math.max(0, (progress - 0.80) * 5)));
  const hold = Math.sin(t * 11.3) * 0.012 * e;  // lifelike hold tremor
  const applyArm = (dir: 1|-1): [Rot3, Rot3, Rot3] => [
    [-0.58*e, dir*0.08*e,       dir*0.14*e + hold],
    [-0.38*e, 0,                            0     ],
    [0.05*e,  dir*0.12*e,                   hold  ],
  ];
  const r = applyArm(1); const l = applyArm(-1);
  const idle = idlePose(t, 0);
  return {
    rua: side === 'left'  ? idle.rua : r[0], rla: side === 'left'  ? idle.rla : r[1], rh: side === 'left'  ? idle.rh  : r[2],
    lua: side === 'right' ? idle.lua : l[0], lla: side === 'right' ? idle.lla : l[1], lh: side === 'right' ? idle.lh  : l[2],
  };
}

/** Open-palm / welcoming gesture — arm spread with wrist rotation */
function openHandPose(progress: number, side: 'left'|'right'|'both', t: number): ArmPose {
  const e       = easeInOut(Math.min(1, progress * 2.5)) * (1 - easeOut(Math.max(0, (progress - 0.75) * 4)));
  const breathe = Math.sin(t * 1.3) * 0.018 * e;  // subtle living motion
  const applyArm = (dir: 1|-1): [Rot3, Rot3, Rot3] => [
    [(-0.48+breathe)*e, dir*0.28*e, dir*0.10*e],
    [   -0.18*e,        0,                   0 ],
    [ 0.08*e,           dir*0.35*e,   0.04*e  ],  // wrist rotates palm up/fwd
  ];
  const r = applyArm(1); const l = applyArm(-1);
  const idle = idlePose(t, 0);
  return {
    rua: side === 'left'  ? idle.rua : r[0], rla: side === 'left'  ? idle.rla : r[1], rh: side === 'left'  ? idle.rh  : r[2],
    lua: side === 'right' ? idle.lua : l[0], lla: side === 'right' ? idle.lla : l[1], lh: side === 'right' ? idle.lh  : l[2],
  };
}

/** Rhythmic beat — emphasis gesture with wrist snap, variance-driven speed */
function beatPose(progress: number, side: 'left'|'right'|'both', t: number, variance: number): ArmPose {
  const env      = easeOut(Math.min(1, progress*4)) * (1 - easeOut(Math.max(0, (progress-0.65)*2.9)));
  const freq     = 8.0 + variance * 2.5;
  const beat     = Math.sin(t * freq)            * 0.22 * env;
  const wrist    = Math.sin(t * freq * 1.1 + 0.3) * 0.18 * env;
  const applyArm = (dir: 1|-1): [Rot3, Rot3, Rot3] => [
    [(-0.38 + beat*0.55)*env, 0, dir*0.12],
    [(-0.22 + beat     )*env, 0, 0       ],
    [0,                       0, wrist   ],
  ];
  const r = applyArm(1); const l = applyArm(-1);
  const idle = idlePose(t, 0);
  return {
    rua: side === 'left'  ? idle.rua : r[0], rla: side === 'left'  ? idle.rla : r[1], rh: side === 'left'  ? idle.rh  : r[2],
    lua: side === 'right' ? idle.lua : l[0], lla: side === 'right' ? idle.lla : l[1], lh: side === 'right' ? idle.lh  : l[2],
  };
}

// ─── Apply pose to humanoid bones ────────────────────────────────────────────
function applyArmPose(humanoid: NonNullable<VRM['humanoid']>, pose: ArmPose): void {
  const set = (name: string, r: Rot3) => {
    try {
      const bone = humanoid.getNormalizedBoneNode(name as never);
      if (bone) bone.rotation.set(r[0], r[1], r[2], 'XYZ');
    } catch { /* bone absent in this VRM */ }
  };
  set('rightUpperArm', pose.rua); set('rightLowerArm', pose.rla); set('rightHand', pose.rh);
  set('leftUpperArm',  pose.lua); set('leftLowerArm',  pose.lla); set('leftHand',  pose.lh);
}

// ─── Fallback: Web Speech API ─────────────────────────────────────────────────
function fallbackSpeak(text: string, onStart?: () => void, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) { onEnd?.(); return; }
  try {
    window.speechSynthesis.cancel();
    const u   = new SpeechSynthesisUtterance(text);
    u.lang    = 'ar-SA';
    u.rate    = 0.9;
    u.onstart = () => onStart?.();
    u.onend   = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  } catch { onEnd?.(); }
}

// ─── Verona parser ────────────────────────────────────────────────────────────
function parseVerona(raw: string): { text: string; emotion: string; action: string } {
  let text = raw, emotion = 'neutral', action = '';
  try {
    const mA = text.match(/\*([^*]+)\*/);
    if (mA) { action = mA[1]; text = text.replace(/\*[^*]+\*/g, '').trim(); }
    const mE = text.match(/\[EMOTION:([^\]]+)\]/i);
    if (mE) { emotion = mE[1].toLowerCase(); text = text.replace(/\[EMOTION:[^\]]+\]/gi, '').trim(); }
  } catch { /* never fatal */ }
  return { text: text || raw, emotion, action };
}

function inferEmotion(text: string): string {
  if (/أحسنت|مبروك|إبداع|ممتاز جداً|ممتاز جدا|ممتاز!/i.test(text)) return 'celebration';
  if (/ممتاز|رائع|صحيح|تمام|عظيم/i.test(text))                      return 'friendly';
  if (/خطأ|ناقص|راجع|غير صحيح|لا يكفي/i.test(text))                 return 'thinking';
  return 'neutral';
}

function actionToGestureEvent(action: string): Record<string, unknown> {
  if (/wave|تلويح|تحية|وداع/i.test(action))  return { type: 'wave',     side: 'right', duration: 2.5, intensity: 1.0, variance: Math.random() };
  if (/point|إشارة|انظر|يشير/i.test(action)) return { type: 'point',    side: 'right', duration: 1.5, intensity: 0.9, variance: Math.random() };
  if (/nod|موافق|هز/i.test(action))           return { type: 'beat',     side: 'both',  duration: 1.2, intensity: 0.7, variance: Math.random() };
  if (/open.*hand|يد مفتوحة/i.test(action))   return { type: 'openHand', side: 'both',  duration: 1.8, intensity: 0.9, variance: Math.random() };
  return { type: 'wave', side: 'right', duration: 1.2, intensity: 0.8, variance: Math.random() };
}

// ─────────────────────────────────────────────────────────────────────────────
// VRMScene — lives inside the Canvas
// ─────────────────────────────────────────────────────────────────────────────
interface VRMSceneProps {
  vrmUrl:   string;
  speakRef: React.MutableRefObject<((text: string) => void) | null>;
  onLoad:   () => void;
}

function VRMScene({ vrmUrl, speakRef, onLoad }: VRMSceneProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const vrmRef        = useRef<VRM | null>(null);
  const groupRef      = useRef<THREE.Group>(null);

  // ── Speaking ─────────────────────────────────────────────────────────────
  const isTalkingRef    = useRef(false);
  const talkElapsedRef  = useRef(0);
  const lipSmoothRef    = useRef(0);    // low-pass smoothed jaw value

  // ── Phase 2: phoneme lip-sync from word timings ───────────────────────────
  const wordTimingsRef   = useRef<WordTiming[]>([]);
  const speechAudioRef   = useRef<HTMLAudioElement | null>(null);
  const visemeRef        = useRef<VisemeWeights>({ aa: 0, ih: 0, ou: 0 });
  const phonemeManagerRef = useRef<PhonemeManager | null>(null);

  // ── Phase 3: pre-roll scheduled gestures ──────────────────────────────
  const scheduledGesturesRef = useRef<ScheduledGesture[]>([]);

  // ── Phase 5: triggered micro-expressions ─────────────────────────────
  const microExprRef = useRef<{
    type: string; intensity: number; startMs: number; holdMs: number; fadeMs: number;
  } | null>(null);
  const nextIdleMicroRef = useRef(Date.now() + 5000 + Math.random() * 5000);

  // ── Emotion blending ──────────────────────────────────────────────────────
  const emotionRef = useRef<string>('neutral');
  const emotionCW  = useRef<Record<ExprKey, number>>({
    happy: 0, sad: 0, angry: 0, relaxed: 0.25, surprised: 0,
  });

  // ── Gesture ───────────────────────────────────────────────────────────────
  const gestureRef = useRef<ActiveGesture | null>(null);

  // ── Hybrid Persona Kernel: prosody hint from avatar:voice event ──────────
  const voiceRef = useRef<{ rate: number; pitch: string }>({ rate: 0.97, pitch: '0st' });

  // ── Smooth pose (actual rendered — lerps toward target) ───────────────────
  const renderedPoseRef = useRef<ArmPose>(idlePose(0, 0));

  // ── AI Director refs ───────────────────────────────────────────────────────
  /** Forced blink: style overrides natural blink speed/count */
  const forcedBlinkRef   = useRef<{ style: string; remaining: number } | null>(null);
  /** AI nod: rapid head nod with arc envelope */
  const nodRef           = useRef<{ startMs: number; durationMs: number; intensity: number } | null>(null);
  /** AI laugh: whole-body laugh bouncing chest + head */
  const laughRef         = useRef<{ startMs: number; durationMs: number; intensity: number } | null>(null);
  /** AI headpose: desired yaw/pitch held until endMs */
  const headPoseRef      = useRef<{ yaw: number; pitch: number; endMs: number } | null>(null);
  /** Smoothed current head yaw/pitch (lerped toward headPoseRef target) */
  const headCurrYawRef   = useRef(0);
  const headCurrPitchRef = useRef(0);

  // ── Per-instance noise (prevents two avatars moving identically) ──────────
  const noisePhase    = useRef(Math.random() * Math.PI * 2);
  const spinePhase          = useRef(Math.random() * Math.PI * 2);
  const weightShiftPhaseRef = useRef(Math.random() * Math.PI * 2);
  const hipShiftRef         = useRef(0);   // smoothed hip lateral offset (rad)

  // ── Blink ─────────────────────────────────────────────────────────────────
  const nextBlinkRef  = useRef(Date.now() + 3000);
  const blinkPhaseRef = useRef(0);

  // ── Head LookAt with organic lag ──────────────────────────────────────────
  const lookTargetRef  = useRef(new THREE.Vector3(0, 1.0, 3.0));
  const saccadeRef     = useRef(0);    // micro-saccade phase accumulator

  // ── Listening state (Phase 1: STT) ───────────────────────────────────────
  const isListeningRef      = useRef(false);
  const listeningStartRef   = useRef(0); // Date.now() when listening began

  // ── Micro-gestures (Poisson process ~every 4–9 s) ─────────────────────────
  const nextMicroRef    = useRef(Date.now() + 5000 + Math.random() * 4000);
  const microTypeRef    = useRef<'tilt' | 'nod' | null>(null);
  const microStartRef   = useRef(0);
  const microDurRef     = useRef(0);

  // ── VRM Load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((p: unknown) => new VRMLoaderPlugin(p as never));

    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => {
      if (String(a[0] ?? '').includes('LookAtDegreeMap')) return;
      origWarn.apply(console, a);
    };

    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) { setTimeout(() => { console.warn = origWarn; }, 0); return; }
        setTimeout(() => { console.warn = origWarn; }, 0);

        const model = gltf.userData.vrm as VRM;
        if (!model?.scene) {
          console.warn('[AvatarCanvas] ❌ No VRM in userData.vrm:', vrmUrl);
          return;
        }
        try { VRMUtils.removeUnnecessaryVertices(model.scene); } catch { /* non-fatal */ }
        try { VRMUtils.combineSkeletons(model.scene);          } catch { /* non-fatal */ }

        let meshCount = 0;
        model.scene.traverse((o) => {
          o.frustumCulled = false;
          if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).visible = true; meshCount++; }
        });
        console.log(`%c[AvatarCanvas] ✅ Loaded — ${meshCount} meshes`, 'color:lime;font-weight:bold');

        // Greeting wave on load
        gestureRef.current = {
          type: 'wave', side: 'right',
          startMs: Date.now(), durationMs: 3500, variance: Math.random(),
        };

        vrmRef.current = model;
        setVrm(model);
        phonemeManagerRef.current = new PhonemeManager(model);
        onLoad();
      },
      undefined,
      (err) => {
        if (!cancelled) {
          console.warn = origWarn;
          console.error('[AvatarCanvas] ❌ VRM load error:', (err as Error)?.message ?? err);
        }
      },
    );

    return () => { cancelled = true; console.warn = origWarn; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrmUrl]);

  // ── speak() registration ──────────────────────────────────────────────────
  useEffect(() => {
    speakRef.current = (rawText: string) => {
      if (!rawText?.trim()) return;

      const { text, emotion, action } = parseVerona(rawText);
      // Preserve director-set emotion (celebration, thinking, etc.) that was dispatched
      // synchronously via avatar:emotion before speak() runs. Only overwrite if neutral.
      const inferredEmotion = emotion !== 'neutral' ? emotion : inferEmotion(text);
      if (emotionRef.current === 'neutral' || emotionRef.current === 'normal') {
        emotionRef.current = inferredEmotion;
      }

      if (action) {
        try {
          window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: actionToGestureEvent(action) }));
        } catch { /* ignore */ }
      }

      const onStart = () => {
        isTalkingRef.current   = true;
        talkElapsedRef.current = 0;
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      };
      const onEnd = () => {
        isTalkingRef.current = false;
        emotionRef.current   = 'neutral';
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };

      import('@/ai/io/tts')
        .then(({ speakWithTTS }) =>
          speakWithTTS(text, { onStart, onEnd, emotion: emotionRef.current, rate: voiceRef.current.rate }).then((ok) => {
            if (!ok) fallbackSpeak(text, onStart, onEnd);
          }),
        )
        .catch(() => fallbackSpeak(text, onStart, onEnd));
    };

    return () => { speakRef.current = null; };
  }, [speakRef]);

  // ── Event listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    // [EVT][RIG] debug-once guard — prints normalised payload on first receipt per type
    const _evtSeen = new Set<string>();
    function dbgOnce(type: string, detail: unknown) {
      if (process.env.NODE_ENV !== 'development' || _evtSeen.has(type)) return;
      _evtSeen.add(type);
      // eslint-disable-next-line no-console
      console.log('[EVT][RIG]', type, { keys: Object.keys(detail as object), sample: detail });
    }

    const onGesture = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        type?: string; side?: string; duration?: number; intensity?: number; variance?: number;
        preroll?: number;  // Phase 3: ms to back-date the startMs for pre-roll
      };
      // RIG contract: reads d.type (camelCase) | tokens: wave/openHand/point/beat
      dbgOnce('avatar:gesture', d);
      if (!d?.type) return;
      gestureRef.current = {
        type:       (d.type as ActiveGesture['type']),
        side:       ((d.side ?? 'right') as ActiveGesture['side']),
        startMs:    Date.now() - (d.preroll ?? 0),   // Phase 3: pre-roll
        durationMs: (d.duration ?? 2) * 1000,
        variance:   d.variance ?? Math.random(),
      };
    };

    const onEmotion    = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      // RIG contract: reads detail.emotion (string)
      dbgOnce('avatar:emotion', (e as CustomEvent).detail);
      if (em) emotionRef.current = em;
    };
    const onSpeakStart = () => { isTalkingRef.current = true;  talkElapsedRef.current = 0; };
    const onSpeakEnd   = () => {
      isTalkingRef.current = false;
      emotionRef.current = 'neutral';
      wordTimingsRef.current = [];
      speechAudioRef.current = null;
      phonemeManagerRef.current?.stop();
      scheduledGesturesRef.current = [];   // Phase 3: clear pending
    };
    // Phase 2 + 3 + 5: capture word timings + audio, schedule pre-roll gestures, auto micro-expr
    const onSpeak = (e: Event) => {
      const d = (e as CustomEvent<{ timings?: WordTiming[]; text?: string; audio?: HTMLAudioElement }>).detail;
      if (d?.timings?.length) wordTimingsRef.current = d.timings;
      if (d?.audio)           speechAudioRef.current = d.audio;
      // Phase 3: build pre-roll gesture schedule from word timings
      scheduledGesturesRef.current = gestureEngine.scheduleGesturesForText(
        d?.text ?? '', d?.timings ?? [], emotionRef.current,
      );
      // Phase 2 phoneme: feed timings into PhonemeManager
      if (d?.timings?.length) {
        phonemeManagerRef.current?.setTimings(d.timings);
      } else {
        phonemeManagerRef.current?.startProcedural();
      }
      // Phase 5: auto-trigger micro-expression based on reply content
      if (d?.text) {
        const replyType = classifyReplyType(d.text);
        const microType = replyType === 'question'    ? 'eyebrowRaise'
                        : replyType === 'celebration' ? 'halfSmile'
                        : replyType === 'surprised'   ? 'eyebrowRaise'
                        : replyType === 'sad'         ? 'microFrown'
                        : null;
        if (microType) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('avatar:micro', {
              detail: { type: microType, intensity: 0.75, duration: 0.6 },
            }));
          }, 300);
        }
      }
    };
    const onListening  = (e: Event) => {
      const active = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
      // RIG contract: reads detail.active (boolean)
      dbgOnce('avatar:listening', (e as CustomEvent).detail);
      isListeningRef.current = active;
      // When entering listening: snap look forward (attentive posture)
      if (active) {
        listeningStartRef.current = Date.now();
        lookTargetRef.current.set(0, 1.05, 3.0);
      }
    };

    // ── Phase 7: Student performance reactions ────────────────────────────
    const onStudentPerformance = (e: Event) => {
      const d = (e as CustomEvent<{ result?: string; score?: number }>).detail ?? {};
      if (d.result === 'correct') {
        emotionRef.current = 'celebration';
        window.dispatchEvent(new CustomEvent('avatar:gesture', {
          // duration in SECONDS (handler multiplies by 1000); side='both' for celebration
          detail: { type: 'wave', side: 'both', duration: 2.2, preroll: 0 },
        }));
      } else if (d.result === 'incorrect') {
        emotionRef.current = 'thinking';
      } else if (d.result === 'partial') {
        emotionRef.current = 'encouraging';
        window.dispatchEvent(new CustomEvent('avatar:gesture', {
          detail: { type: 'openHand', side: 'both', duration: 1.4, preroll: 0 },
        }));
      }
    };

    // ── AI Director — new event types ────────────────────────────────────────
    const onForcedBlink = (e: Event) => {
      const d = (e as CustomEvent<{ style?: string; count?: number }>).detail;
      forcedBlinkRef.current = { style: d?.style ?? 'normal', remaining: d?.count ?? 1 };
      blinkPhaseRef.current  = 0.001; // kick blink immediately
    };
    const onNod = (e: Event) => {
      const d = (e as CustomEvent<{ intensity?: number; duration?: number }>).detail;
      nodRef.current = { startMs: Date.now(), durationMs: d?.duration ?? 550, intensity: d?.intensity ?? 0.32 };
    };
    const onLaugh = (e: Event) => {
      const d = (e as CustomEvent<{ intensity?: number; duration?: number }>).detail;
      laughRef.current = { startMs: Date.now(), durationMs: d?.duration ?? 1200, intensity: d?.intensity ?? 0.70 };
    };
    const onHeadPose = (e: Event) => {
      const d = (e as CustomEvent<{ yaw?: number; pitch?: number; duration?: number }>).detail;
      headPoseRef.current = { yaw: d?.yaw ?? 0, pitch: d?.pitch ?? 0, endMs: Date.now() + (d?.duration ?? 2000) };
    };
    // Hybrid Persona Kernel: store prosody hint for next speakWithTTS call
    const onVoice = (e: Event) => {
      const d = (e as CustomEvent<{ rate?: number; pitch?: string }>).detail;
      if (d?.rate != null)  voiceRef.current.rate  = d.rate;
      if (d?.pitch != null) voiceRef.current.pitch = d.pitch;
    };

    // Phase 5: triggered micro-expression
    const onMicro = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; intensity?: number; duration?: number }>).detail;
      if (!d?.type) return;
      const totalMs = (d.duration ?? 0.6) * 1000;
      microExprRef.current = {
        type:      d.type,
        intensity: d.intensity ?? 0.7,
        startMs:   Date.now(),
        holdMs:    totalMs * 0.5,
        fadeMs:    totalMs * 0.5,
      };
      console.log(`[MICRO] ${d.type} intensity=${(d.intensity ?? 0.7).toFixed(2)} duration=${(d.duration ?? 0.6)}s`);
    };

    window.addEventListener('avatar:gesture',      onGesture);
    window.addEventListener('avatar:emotion',      onEmotion);
    window.addEventListener('avatar:speak',        onSpeak);
    window.addEventListener('avatar:speak:start',  onSpeakStart);
    window.addEventListener('avatar:speak:end',    onSpeakEnd);
    window.addEventListener('avatar:listening',    onListening);
    window.addEventListener('student:performance', onStudentPerformance);
    window.addEventListener('avatar:blink',        onForcedBlink);
    window.addEventListener('avatar:nod',          onNod);
    window.addEventListener('avatar:laugh',        onLaugh);
    window.addEventListener('avatar:headpose',     onHeadPose);
    window.addEventListener('avatar:voice',        onVoice);
    // Phase 10: Semantic aliases — GestureEngine dispatches these; they forward
    // to the canonical handlers already wired above.
    window.addEventListener('avatar:specialBlink', onForcedBlink);
    window.addEventListener('avatar:headTilt',     onHeadPose);
    // avatar:waveBoth → already handled by avatar:gesture with side='both'
    window.addEventListener('avatar:micro',        onMicro);

    return () => {
      window.removeEventListener('avatar:gesture',      onGesture);
      window.removeEventListener('avatar:emotion',      onEmotion);
      window.removeEventListener('avatar:speak',        onSpeak);
      window.removeEventListener('avatar:speak:start',  onSpeakStart);
      window.removeEventListener('avatar:speak:end',    onSpeakEnd);
      window.removeEventListener('avatar:listening',    onListening);
      window.removeEventListener('student:performance', onStudentPerformance);
      window.removeEventListener('avatar:blink',        onForcedBlink);
      window.removeEventListener('avatar:nod',          onNod);
      window.removeEventListener('avatar:laugh',        onLaugh);
      window.removeEventListener('avatar:headpose',     onHeadPose);
      window.removeEventListener('avatar:voice',        onVoice);
      window.removeEventListener('avatar:specialBlink', onForcedBlink);
      window.removeEventListener('avatar:headTilt',     onHeadPose);
      window.removeEventListener('avatar:micro',        onMicro);
    };
  }, []);

  // ── Render loop ───────────────────────────────────────────────────────────
  const { pointer, camera } = useThree();

  useFrame((state, delta) => {
    const v     = vrmRef.current;
    const group = groupRef.current;
    if (!group) return;

    const t   = state.clock.elapsedTime;
    const now = Date.now();
    const np  = noisePhase.current;
    const sp  = spinePhase.current;

    // ── Pre-calc: laugh envelope (shared between chest + neck sections) ───────
    const laughActive = laughRef.current !== null;
    const laughProg   = laughActive
      ? Math.min(1, (now - laughRef.current!.startMs) / laughRef.current!.durationMs) : 0;
    const laughEnv    = laughActive ? Math.sin(laughProg * Math.PI) * laughRef.current!.intensity : 0;
    // clear laugh when done
    if (laughActive && laughProg >= 1) laughRef.current = null;

    // ── 1. Breathing + subtle torso drift ────────────────────────────────
    const breatheY  = Math.sin(t * 0.82) * BREATHE_AMP;
    const driftX    = Math.sin(t * 0.21 + np) * 0.030;     // ↑ visible lateral drift (was 0.016)
    const spineSway = Math.sin(t * 0.34 + sp) * 0.035;     // ↑ visible torso yaw (was 0.016)
    group.position.set(driftX, AVATAR_BASE_Y + breatheY, 0.2);
    group.rotation.y = Math.PI + spineSway;

    if (!v) return;

    const humanoid = v.humanoid;
    const em       = v.expressionManager;

    // ── 2. Spine + chest micro-motion ─────────────────────────────────────
    if (humanoid) {
      try {
        // ── Phase 6: weight-shift target (smooth per-frame) ────────────────
        const targetHipShift = Math.sin(t * 0.28 + weightShiftPhaseRef.current) * 0.055; // ↑ visible sway (was 0.022)
        hipShiftRef.current  = lerpN(hipShiftRef.current, targetHipShift, delta * 4.0);  // ↑ faster response (was 1.5)

        const spineR     = Math.sin(t * 0.51 + sp) * 0.022; // ↑ visible spine roll (was 0.010)
        const listenElapsed = isListeningRef.current ? (Date.now() - listeningStartRef.current) / 1000 : 0;
        const listenLean = lerpN(0, 0.060, Math.min(1, listenElapsed * 0.6)); // ↑ lean more (was 0.025)
        const spineBone  = humanoid.getNormalizedBoneNode('spine' as never);
        if (spineBone) spineBone.rotation.set(spineR * 0.8 + listenLean, spineSway * 0.6, spineR, 'XYZ'); // ↑ multipliers
        const chestBone  = humanoid.getNormalizedBoneNode('chest' as never);
        // Laugh chest bounce: rapid chest heave layered on top of breathing
        const laughChest = laughActive ? Math.sin(laughProg * Math.PI * 7) * laughEnv * BREATHE_AMP * 2.2 : 0;
        if (chestBone) chestBone.rotation.set(breatheY * 1.8 + listenLean * 0.8 + laughChest, 0, -hipShiftRef.current * 1.1, 'XYZ');
        const hipBone = humanoid.getNormalizedBoneNode('hips' as never);
        // Laugh hip sway: slight lateral bounce during laugh
        const laughHip = laughActive ? Math.sin(laughProg * Math.PI * 6) * laughEnv * 0.08 : 0;
        if (hipBone) hipBone.rotation.z = hipShiftRef.current * 2.5 + laughHip;
      } catch { /* bone absent */ }
    }

    // ── 3. Expression blending ────────────────────────────────────────────
    if (em) {
      const bd = Math.min(1, delta * EMOTION_BLEND_SPEED);

      // Blink — speed varies by AI directive style
      const blinkSpeed = forcedBlinkRef.current
        ? forcedBlinkRef.current.style === 'slow'  ? 4.0   //  ~0.78 s close+open (drowsy)
        : forcedBlinkRef.current.style === 'rapid' ? 28    //  ~0.11 s (surprised/excited)
        : 13                                               //  normal / double
        : 11;                                             //  organic idle
      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * blinkSpeed;
        const bv = blinkPhaseRef.current < Math.PI ? Math.sin(blinkPhaseRef.current) : 0;
        const bc = Math.min(1, bv);
        try { em.setValue('blink' as never, bc); } catch {
          try { em.setValue('blinkLeft' as never, bc); em.setValue('blinkRight' as never, bc); } catch {}
        }
        if (blinkPhaseRef.current >= Math.PI * 2) {
          blinkPhaseRef.current = 0;
          try { em.setValue('blink' as never, 0); } catch {
            try { em.setValue('blinkLeft' as never, 0); em.setValue('blinkRight' as never, 0); } catch {}
          }
          // Double/rapid: fire next blink after short gap if remaining > 1
          if (forcedBlinkRef.current && forcedBlinkRef.current.remaining > 1) {
            forcedBlinkRef.current.remaining--;
            setTimeout(() => { blinkPhaseRef.current = 0.001; }, 90);
          } else {
            forcedBlinkRef.current = null; // done with forced sequence
            nextBlinkRef.current = now + (BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN)) * 1000;
          }
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }

      // Smooth emotion blend
      const targets = EMOTION_WEIGHTS[emotionRef.current] ?? EMOTION_WEIGHTS.neutral;
      const cw      = emotionCW.current;
      const KEYS: ExprKey[] = ['happy', 'sad', 'angry', 'relaxed', 'surprised'];
      for (const key of KEYS) {
        cw[key] = lerpN(cw[key], targets[key], bd);
        try { em.setValue(key as never, cw[key]); } catch {}
      }

      // ── Phase 2: Phoneme lip-sync — word timings first, procedural fallback ──
      if (isTalkingRef.current) {
        talkElapsedRef.current += delta;
        const timings = wordTimingsRef.current;
        let targetViseme: VisemeWeights;
        if (timings.length > 0 && speechAudioRef.current) {
          const audioMs = (speechAudioRef.current.currentTime ?? 0) * 1000;
          targetViseme  = timingsToVisemeAt(timings, audioMs);
        } else {
          // Procedural fallback: variable-frequency sine — mouth opens & closes fully
          const et   = talkElapsedRef.current;
          const modF = 9.0 + Math.sin(et * 2.1) * 3.5; // ↑ faster syllable rate
          const raw  = Math.max(0, 0.75 * Math.sin(et * modF)); // ↑ full open-close (was 0.28+0.55, never fully closed)
          targetViseme = { aa: raw * 0.9, ih: raw * 0.6, ou: raw * 0.4 };
        }
        visemeRef.current = lerpViseme(visemeRef.current, targetViseme, delta);
      } else {
        visemeRef.current = lerpViseme(visemeRef.current, { aa: 0, ih: 0, ou: 0 }, delta);
      }
      // Keep lipSmoothRef in sync for backwards compat
      lipSmoothRef.current = visemeRef.current.aa;

      try { em.setValue('aa' as never, visemeRef.current.aa); } catch {}
      try { em.setValue('ih' as never, visemeRef.current.ih); } catch {}
      try { em.setValue('ou' as never, visemeRef.current.ou); } catch {}

      // ── Phase 3: PhonemeManager drives Ee + Oh (complements aa/ih/ou above) ──
      phonemeManagerRef.current?.update(delta, isTalkingRef.current);

      // ── Phase 3: Flush pre-rolled scheduled gestures against audio playback time ──
      if (speechAudioRef.current && scheduledGesturesRef.current.length > 0) {
        gestureEngine.flushScheduled(speechAudioRef.current.currentTime, scheduledGesturesRef.current);
      }

      // ── Phase 5: Micro-expressions overlay (visible, emotion-driven) ───────
      const em5 = emotionRef.current;
      // 1. Brow raise — clearly visible, boosted on surprised/thinking/celebration
      const browAmp = (em5 === 'surprised' || em5 === 'celebration') ? 0.55  // ↑ strong surprise
                    : (em5 === 'thinking'  || em5 === 'sad')          ? 0.35  // ↑ inner brow raise
                    : 0.20; // ↑ always-visible idle flicker (was 0.06)
      const browV   = (0.5 + 0.5 * Math.sin(t * 1.3)) * browAmp; // ↑ freq 0.9→1.3
      try { em.setValue('browInnerUp'  as never, browV); } catch {
        try { em.setValue('browUp'     as never, browV); } catch {} }

      // 2. Eye squint — on happy / friendly tones
      const squintActive = em5 === 'happy' || em5 === 'friendly' || em5 === 'celebration' || em5 === 'encouraging';
      const squintV = squintActive ? 0.40 + 0.18 * Math.sin(t * 1.7) : 0; // ↑ more visible squint (was 0.22+0.12)
      try { em.setValue('cheekSquintLeft'  as never, squintV); } catch {
        try { em.setValue('squintLeft'     as never, squintV); } catch {} }
      try { em.setValue('cheekSquintRight' as never, squintV); } catch {
        try { em.setValue('squintRight'    as never, squintV); } catch {} }

      // 3. Half-smile — friendly / encouraging overlay
      const smileActive = em5 === 'friendly' || em5 === 'encouraging' || em5 === 'happy' || em5 === 'celebration';
      const smileV = smileActive ? 0.40 + 0.18 * Math.sin(t * 1.1) : 0; // ↑ more visible smile (was 0.18+0.10)
      try { em.setValue('mouthSmileLeft'  as never, smileV); } catch {}
      try { em.setValue('mouthSmileRight' as never, smileV); } catch {}

      // ── Phase 5b: Triggered micro-expression overlay (event-driven, short-lived) ──
      if (microExprRef.current) {
        const mx      = microExprRef.current;
        const elapsed = now - mx.startMs;
        let weight = 0;
        if (elapsed < mx.holdMs) {
          weight = Math.min(1, elapsed / 100) * mx.intensity;   // ~100ms ramp-up
        } else if (elapsed < mx.holdMs + mx.fadeMs) {
          weight = (1 - (elapsed - mx.holdMs) / mx.fadeMs) * mx.intensity;
        } else {
          microExprRef.current = null;
        }
        if (weight > 0) {
          switch (mx.type) {
            case 'eyebrowRaise':
              try { em.setValue('browInnerUp'     as never, weight); } catch {
                try { em.setValue('browUp'         as never, weight); } catch {} }
              try { em.setValue('browOuterUpLeft'  as never, weight * 0.6); } catch {}
              try { em.setValue('browOuterUpRight' as never, weight * 0.6); } catch {}
              break;
            case 'eyeSquint':
              try { em.setValue('cheekSquintLeft'  as never, weight); } catch {
                try { em.setValue('squintLeft'      as never, weight); } catch {} }
              try { em.setValue('cheekSquintRight' as never, weight); } catch {
                try { em.setValue('squintRight'     as never, weight); } catch {} }
              break;
            case 'halfSmile':
              try { em.setValue('mouthSmileLeft'  as never, weight); } catch {}
              try { em.setValue('mouthSmileRight' as never, weight); } catch {}
              break;
            case 'microFrown':
              try { em.setValue('mouthFrownLeft'  as never, weight); } catch {}
              try { em.setValue('mouthFrownRight' as never, weight); } catch {}
              break;
            case 'noseWrinkle':
              try { em.setValue('noseSneerLeft'   as never, weight); } catch {}
              try { em.setValue('noseSneerRight'  as never, weight); } catch {}
              break;
            default: break;
          }
        }
      }

      // ── Phase 5c: Idle micro-expression (Poisson process, every 5–10 s) ──────
      if (!isTalkingRef.current && now >= nextIdleMicroRef.current) {
        nextIdleMicroRef.current = now + 5000 + Math.random() * 5000;
        const idleTypes = ['eyebrowRaise', 'eyeSquint', 'halfSmile'] as const;
        const idleType  = idleTypes[Math.floor(Math.random() * idleTypes.length)];
        microExprRef.current = {
          type:      idleType,
          intensity: 0.25 + Math.random() * 0.2,
          startMs:   now,
          holdMs:    300,
          fadeMs:    350,
        };
        console.log(`[MICRO] idle ${idleType}`);
      }

      em.update();
    }

    // ── 4. LookAt with organic lag + micro-saccades ───────────────────────
    const vrmLookAt = (v as { lookAt?: { autoUpdate?: boolean; lookAt?: (p: THREE.Vector3) => void } }).lookAt;
    if (vrmLookAt?.lookAt) {
      vrmLookAt.autoUpdate = false;
      saccadeRef.current  += delta;
      // Very subtle saccade: high-freq noise, tiny amplitude
      const sac = Math.sin(saccadeRef.current * 14.3) * 0.004;
      const worldTarget = new THREE.Vector3(pointer.x + sac, pointer.y + sac * 0.6, 0.4).unproject(camera);
      // Lagged lerp — natural drift with slight speed variation
      const lagSpeed = 5.5 + Math.sin(t * 2.9) * 1.2; // ↑ responsive eye tracking (was 2.0+0.35)
      lookTargetRef.current.lerp(worldTarget, Math.min(1, delta * lagSpeed));
      vrmLookAt.lookAt(lookTargetRef.current);
    }

    // ── 5. Neck bone — AI Director accumulation (micro + nod + laugh + headpose) ──
    if (humanoid) {
      let neckX = 0, neckY = 0, neckZ = 0;

      // a) Organic micro-gesture (existing Poisson process — tilt or nod)
      if (now >= nextMicroRef.current) {
        microTypeRef.current  = Math.random() < 0.5 ? 'tilt' : 'nod';
        microStartRef.current = now;
        microDurRef.current   = 500 + Math.random() * 600;
        nextMicroRef.current  = now + 2000 + Math.random() * 3000;
      }
      if (microTypeRef.current) {
        const mProg = Math.min(1, (now - microStartRef.current) / microDurRef.current);
        const mEnv  = Math.sin(mProg * Math.PI) * 0.14;
        if (microTypeRef.current === 'tilt') neckZ += mEnv;
        else                                 neckX += mEnv;
        if (mProg >= 1) microTypeRef.current = null;
      }

      // b) AI Nod — rapid triple-nod with envelope
      if (nodRef.current) {
        const nProg = Math.min(1, (now - nodRef.current.startMs) / nodRef.current.durationMs);
        const nEnv  = Math.sin(nProg * Math.PI) * nodRef.current.intensity;
        neckX += Math.sin(nProg * Math.PI * 3) * nEnv;
        if (nProg >= 1) nodRef.current = null;
      }

      // c) AI Laugh — head bounces with chest
      if (laughActive) {
        neckX += Math.sin(laughProg * Math.PI * 7) * laughEnv * 0.10;
        neckZ += Math.sin(laughProg * Math.PI * 5) * laughEnv * 0.06;
      }

      // d) AI HeadPose — smooth lerp toward target yaw/pitch
      if (headPoseRef.current) {
        const active = now < headPoseRef.current.endMs;
        const ty = active ? headPoseRef.current.yaw   : 0;
        const tp = active ? headPoseRef.current.pitch : 0;
        headCurrYawRef.current   = lerpN(headCurrYawRef.current,   ty, delta * 3.5);
        headCurrPitchRef.current = lerpN(headCurrPitchRef.current, tp, delta * 3.5);
        if (!active
          && Math.abs(headCurrYawRef.current)   < 0.005
          && Math.abs(headCurrPitchRef.current) < 0.005) {
          headPoseRef.current = null;
        }
      } else {
        // Return to neutral when no target active
        headCurrYawRef.current   = lerpN(headCurrYawRef.current,   0, delta * 2.5);
        headCurrPitchRef.current = lerpN(headCurrPitchRef.current, 0, delta * 2.5);
      }
      neckY += headCurrYawRef.current;
      neckX += headCurrPitchRef.current;

      try {
        const neckBone = humanoid.getNormalizedBoneNode('neck' as never);
        if (neckBone) neckBone.rotation.set(neckX, neckY, neckZ, 'XYZ');
      } catch {}
    }

    // ── 6. Arm pose with smooth blending ──────────────────────────────────
    if (humanoid) {
      const gs = gestureRef.current;
      if (gs && now >= gs.startMs + gs.durationMs) gestureRef.current = null;

      let targetPose: ArmPose;
      const active = gestureRef.current;

      if (active) {
        const waveT    = (now - active.startMs) / 1000;
        const progress = (now - active.startMs) / active.durationMs;

        if      (active.type === 'wave')     targetPose = wavePose(waveT, active.durationMs / 1000, active.variance, active.side);
        else if (active.type === 'point')    targetPose = pointPose(progress, active.side, t);
        else if (active.type === 'openHand') targetPose = openHandPose(progress, active.side, t);
        else                                 targetPose = beatPose(progress, active.side, t, active.variance);
      } else {
        targetPose = idlePose(t, np);
      }

      // Lerp rendered pose toward target — smooth transition regardless of gesture change
      renderedPoseRef.current = lerpArmPose(
        renderedPoseRef.current, targetPose,
        Math.min(1, delta * POSE_BLEND_SPEED),
      );
      applyArmPose(humanoid, renderedPoseRef.current);

      // ── Phase 4: Finger shapes per gesture type ────────────────────────
      const activeFinger = gestureRef.current;
      const fingerProgress = activeFinger
        ? Math.min(1, (now - activeFinger.startMs) / activeFinger.durationMs)
        : 0;
      const fingerEnv = activeFinger
        ? Math.sin(Math.min(1, fingerProgress) * Math.PI)
        : 0;

      if (activeFinger?.type === 'point') {
        // Index extended, rest curled
        if (activeFinger.side !== 'left')  applyFingerShape(humanoid, 'right', 'point', fingerEnv);
        if (activeFinger.side !== 'right') applyFingerShape(humanoid, 'left',  'point', fingerEnv);
      } else if (activeFinger?.type === 'openHand') {
        // All fingers extended
        if (activeFinger.side !== 'left')  applyFingerShape(humanoid, 'right', 'open', fingerEnv);
        if (activeFinger.side !== 'right') applyFingerShape(humanoid, 'left',  'open', fingerEnv);
      } else if (activeFinger?.type === 'wave') {
        // Open hand during wave — apply to whichever side(s) are active
        if (activeFinger.side !== 'left')  applyFingerShape(humanoid, 'right', 'open', fingerEnv);
        if (activeFinger.side !== 'right') applyFingerShape(humanoid, 'left',  'open', fingerEnv);
      } else {
        // Idle: natural relaxed curl
        applyFingerShape(humanoid, 'right', 'relax', 1);
        applyFingerShape(humanoid, 'left',  'relax', 1);
      }
    }

    // ── 7. VRM internal update ────────────────────────────────────────────
    v.update(delta);
  });

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      {vrm && <primitive object={vrm.scene} />}
    </group>
  );
}

// ─── ZoomController — lives inside Canvas ────────────────────────────────────
function ZoomController() {
  const { camera, gl } = useThree();
  const zRef = useRef((camera as THREE.PerspectiveCamera).position.z);

  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zRef.current + e.deltaY * ZOOM_SPEED * 0.01));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [gl]);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.z += (zRef.current - cam.position.z) * 0.12;
    cam.updateProjectionMatrix();
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AvatarCanvas — exported default, loaded via dynamic() ssr:false
// ─────────────────────────────────────────────────────────────────────────────
interface AvatarCanvasProps {
  vrmUrl?:  string;
  onReady?: (ref: AvatarCanvasRef) => void;
}

export default function AvatarCanvas({ vrmUrl = '/models/teach.vrm', onReady }: AvatarCanvasProps) {
  const speakRef   = useRef<((text: string) => void) | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const handleLoad = useCallback(() => {
    onReadyRef.current?.({ speak: (text: string) => speakRef.current?.(text) });
  }, []);

  return (
    <div className={styles.avatarMount}>
      <Canvas
        dpr={[1, 2]}
        shadows={false}
        camera={{ position: [0, 0.0, 3.2], fov: 50, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x0c1222, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <ambientLight     intensity={2.5} />
        <directionalLight position={[1, 3, 2]} intensity={2.5} />
        <ZoomController />
        <Suspense fallback={null}>
          <VRMScene vrmUrl={vrmUrl!} speakRef={speakRef} onLoad={handleLoad} />
        </Suspense>
      </Canvas>
    </div>
  );
}
