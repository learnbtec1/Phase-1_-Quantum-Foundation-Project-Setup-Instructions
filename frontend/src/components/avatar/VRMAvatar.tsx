'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { Howl } from 'howler';
import { speakWithTTS, type WordTiming } from '@/ai/io/tts';
import { inferResponsePlan } from '@/ai/avatar/brain';
import { EMOTION_BLENDSHAPES } from '@/ai/avatar/state';
import { proceduralViseme, decayViseme, type VisemeWeights } from '@/ai/lipsync/viseme';
import { timingsToVisemeAt, lerpViseme } from '@/ai/lipsync/timing';

const VRM_URL = '/models/Furina.vrm';
const HUM_URL = '/audio/voices/furina/hum.mp3';
const HUM_URL_ALT = '/audio/ambience/boardroom.mp3';

const BS_AA = 'aa';
const BS_IH = 'ih';
const BS_OU = 'ou';

const HEAD_YAW_LIMIT = 0.5;
const HEAD_PITCH_LIMIT = 0.35;
const HEAD_SENSITIVITY_YAW = 0.65;
const HEAD_SENSITIVITY_PITCH = 0.5;
const NOD_DURATION = 1.2;
const NOD_INTENSITY = 0.15; // كان 0.35 — خفّفنا حركة الرأس عند استلام الرد
const USER_SENT_ACK_DURATION = 0.6;
const USER_SENT_ACK_INTENSITY = 0.08; // كان 0.2 — خفّفنا حركة الرأس عند إرسال الرسالة
const BLINK_INTERVAL_MIN = 2.2;
const BLINK_INTERVAL_MAX = 4.5;
const AVATAR_BASE_Y = -0.93;
const IDLE_SWAY_AMOUNT = 0.04; // كان 0.1 — خفّفنا التمايل الخفيف
const BREATHE_AMPLITUDE = 0.11;
const WAVE_DURATION = 4;
const HEAD_LERP = 0.28;
const ARM_IDLE_SWAY = 0.08;
const ARM_HAND_SWAY = 0.12;
const ARM_WAVE_RAISE = 1.1;
const ARM_WAVE_BEND = 0.8;

/** DEBUG: set true to verify useFrame runs (avatar rotates slowly); set false for production */
const DEBUG_ROTATION = false;

function useChatReceivedTimestamp() {
  const receivedAtRef = useRef<number>(0);
  useEffect(() => {
    const onReceived = () => { receivedAtRef.current = Date.now(); };
    window.addEventListener('chat:received', onReceived);
    return () => window.removeEventListener('chat:received', onReceived);
  }, []);
  return receivedAtRef;
}

function useChatSentTimestamp() {
  const sentAtRef = useRef<number>(0);
  useEffect(() => {
    const onSent = () => { sentAtRef.current = Date.now(); };
    window.addEventListener('chat:sent', onSent);
    return () => window.removeEventListener('chat:sent', onSent);
  }, []);
  return sentAtRef;
}

function useListeningState() {
  const listeningRef = useRef(false);
  useEffect(() => {
    const onListening = (e: Event) => {
      listeningRef.current = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
    };
    window.addEventListener('avatar:listening', onListening);
    return () => window.removeEventListener('avatar:listening', onListening);
  }, []);
  return listeningRef;
}

/**
 * Head tracking: only position (breathing) — NO body rotation.
 * Head/eye direction is handled by VRM lookAt in the main useFrame.
 */
function useHeadTracking(
  groupRef: React.RefObject<THREE.Group | null>,
  _listeningRef?: React.RefObject<boolean>,
  opts?: { waveUntilRef?: React.RefObject<number>; postureLeanRef?: React.RefObject<number>; isTalkingRef?: React.RefObject<boolean> }
) {
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const breathe = Math.sin(t * 0.9) * BREATHE_AMPLITUDE;
    g.position.set(0, AVATAR_BASE_Y + breathe + Math.sin(t * 0.5) * 0.07, 0.2);
    g.updateMatrix();
  });
}

function eulerToQuatArray(euler: THREE.Euler): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(euler);
  return [q.x, q.y, q.z, q.w];
}

const ARM_BONE_NAMES = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const;

/** VRM 0.x / VRChat / Mixamo / GI-Assets skeleton bone name patterns */
const SKELETON_ARM_PATTERNS: Record<string, RegExp> = {
  rightUpperArm: /J_Bip_R_UpperArm|RightUpperArm|Right Arm|rightUpperArm|mixamorigRightArm|RightArm|R_UpperArm|右腕|右腕上/i,
  rightLowerArm: /J_Bip_R_LowerArm|RightLowerArm|Right Forearm|rightLowerArm|mixamorigRightForeArm|RightForeArm|R_LowerArm|右ひじ|右前腕/i,
  rightHand: /J_Bip_R_Hand|RightHand|Right Hand|rightHand|mixamorigRightHand|R_Hand|右手/i,
  leftUpperArm: /J_Bip_L_UpperArm|LeftUpperArm|Left Arm|leftUpperArm|mixamorigLeftArm|LeftArm|L_UpperArm|左腕|左腕上/i,
  leftLowerArm: /J_Bip_L_LowerArm|LeftLowerArm|Left Forearm|leftLowerArm|mixamorigLeftForeArm|LeftForeArm|L_LowerArm|左ひじ|左前腕/i,
  leftHand: /J_Bip_L_Hand|LeftHand|Left Hand|leftHand|mixamorigLeftHand|L_Hand|左手/i,
};

const LEG_BONE_NAMES = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] as const;

const SKELETON_LEG_PATTERNS: Record<string, RegExp> = {
  rightUpperLeg: /J_Bip_R_UpperLeg|RightUpperLeg|Right Thigh|rightUpperLeg|mixamorigRightUpLeg|RightUpLeg|R_UpperLeg|右足上|右腿|右太腿|右足D|右CF_1/i,
  rightLowerLeg: /J_Bip_R_LowerLeg|RightLowerLeg|Right Shin|rightLowerLeg|mixamorigRightLeg|RightLeg|R_LowerLeg|右ひざ|右膝|右下腿|右足E|右CF_2/i,
  rightFoot: /J_Bip_R_Foot|RightFoot|rightFoot|mixamorigRightFoot|R_Foot|右足首|右足先|右足捩|右CF_3/i,
  leftUpperLeg: /J_Bip_L_UpperLeg|LeftUpperLeg|Left Thigh|leftUpperLeg|mixamorigLeftUpLeg|LeftUpLeg|L_UpperLeg|左足上|左腿|左太腿|左足D|左CF_1/i,
  leftLowerLeg: /J_Bip_L_LowerLeg|LeftLowerLeg|Left Shin|leftLowerLeg|mixamorigLeftLeg|LeftLeg|L_LowerLeg|左ひざ|左膝|左下腿|左足E|左CF_2/i,
  leftFoot: /J_Bip_L_Foot|LeftFoot|leftFoot|mixamorigLeftFoot|L_Foot|左足首|左足先|左足捩|左CF_3/i,
};

// ─── Extended gesture state ──────────────────────────────────────────────────
export type ExtendedGestureType = 'wave' | 'point' | 'openHand' | 'beat';
export interface GestureState {
  active: boolean;
  type: ExtendedGestureType;
  side: 'left' | 'right' | 'both';
  startMs: number;
  durationMs: number;
  intensity: number;
}

function applyPointGesture(
  pose: Record<string, { rotation?: [number, number, number, number] }>,
  side: 'left' | 'right' | 'both',
  progress: number,
  euler: THREE.Euler
) {
  const curve = progress < 0.15
    ? progress / 0.15
    : progress > 0.85
      ? (1 - progress) / 0.15
      : 1;
  const applyToSide = (prefix: string) => {
    euler.set(-0.55 * curve, 0, prefix === 'right' ? 0.1 * curve : -0.1 * curve, 'YXZ');
    pose[`${prefix}UpperArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(-0.35 * curve, 0, 0, 'YXZ');
    pose[`${prefix}LowerArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(0, 0, 0, 'YXZ');
    pose[`${prefix}Hand`] = { rotation: eulerToQuatArray(euler) };
  };
  if (side === 'right' || side === 'both') applyToSide('right');
  if (side === 'left' || side === 'both') applyToSide('left');
}

function applyOpenHandGesture(
  pose: Record<string, { rotation?: [number, number, number, number] }>,
  side: 'left' | 'right' | 'both',
  progress: number,
  euler: THREE.Euler
) {
  const curve = Math.sin(progress * Math.PI);
  const applyToSide = (prefix: string) => {
    const dir = prefix === 'right' ? 1 : -1;
    euler.set(-0.45 * curve, dir * 0.15 * curve, dir * 0.08 * curve, 'YXZ');
    pose[`${prefix}UpperArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(-0.25 * curve, 0, 0, 'YXZ');
    pose[`${prefix}LowerArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(0, dir * 0.25 * curve, 0, 'YXZ');
    pose[`${prefix}Hand`] = { rotation: eulerToQuatArray(euler) };
  };
  if (side === 'right' || side === 'both') applyToSide('right');
  if (side === 'left' || side === 'both') applyToSide('left');
}

function applyBeatGesture(
  pose: Record<string, { rotation?: [number, number, number, number] }>,
  side: 'left' | 'right' | 'both',
  progress: number,
  intensity: number,
  euler: THREE.Euler
) {
  const envelope = Math.sin(progress * Math.PI);
  const beat = Math.sin(progress * Math.PI * 5) * intensity * 0.28 * envelope;
  const raise = envelope * 0.35;
  const applyToSide = (prefix: string) => {
    const dir = prefix === 'right' ? 1 : -1;
    euler.set(-(raise + beat * 0.5), 0, dir * 0.12, 'YXZ');
    pose[`${prefix}UpperArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(-0.2 + beat, 0, 0, 'YXZ');
    pose[`${prefix}LowerArm`] = { rotation: eulerToQuatArray(euler) };
    euler.set(0, 0, beat * 0.6, 'YXZ');
    pose[`${prefix}Hand`] = { rotation: eulerToQuatArray(euler) };
  };
  if (side === 'right' || side === 'both') applyToSide('right');
  if (side === 'left' || side === 'both') applyToSide('left');
}

function useArmPose(
  vrmRef: React.RefObject<VRM | null>,
  waveUntilRef: React.RefObject<number>,
  gestureStateRef?: React.RefObject<GestureState | null>,
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>
) {
  const eulerTemp = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const availableBonesRef = useRef<Set<string>>(new Set());
  const skeletonBoneMapRef = useRef<Map<string, THREE.Bone>>(new Map());

  useFrame((state) => {
    const v = vrmRef.current;
    const humanoid = v?.humanoid;
    if (!v?.scene) return;

    if (availableBonesRef.current.size === 0 || skeletonBoneMapRef.current.size === 0) {
      const allPatterns = { ...SKELETON_ARM_PATTERNS, ...SKELETON_LEG_PATTERNS };
      v.scene.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (mesh.skeleton) {
          mesh.skeleton.bones.forEach((bone) => {
            for (const [vrName, pattern] of Object.entries(allPatterns)) {
              if (pattern.test(bone.name) && !skeletonBoneMapRef.current.has(vrName)) {
                skeletonBoneMapRef.current.set(vrName, bone);
                availableBonesRef.current.add(vrName);
              }
            }
          });
        }
      });
      if (skeletonBoneMapRef.current.size === 0) {
        [...ARM_BONE_NAMES, ...LEG_BONE_NAMES].forEach((name) => {
          const node = humanoid?.getRawBoneNode(name as never) ?? humanoid?.getNormalizedBoneNode(name as never);
          if (node) availableBonesRef.current.add(name);
        });
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[VRMAvatar] Using skeleton bones:', [...skeletonBoneMapRef.current.entries()].map(([k, b]) => `${k}->${b.name}`).join(', '));
        }
      }
    }

    const t = state.clock.elapsedTime;
    const now = Date.now();
    const isWaving = !!waveUntilRef.current && now < waveUntilRef.current;
    const waveElapsed = isWaving ? (waveUntilRef.current - now) / 1000 : 0;
    const waveProgress = isWaving ? 1 - waveElapsed / WAVE_DURATION : 0;
    // NOTE: alwaysWave drives idle greeting animation; extended gestures override it.
    const alwaysWave = true;

    // Check extended gesture (expires automatically)
    const gs = gestureStateRef?.current;
    if (gs?.active && now > gs.startMs + gs.durationMs) {
      gs.active = false;
    }
    // Extended non-wave gestures take priority over alwaysWave idle animation
    const hasExtGesture = gs?.active && gs.type !== 'wave';

    const pose: Record<string, { rotation?: [number, number, number, number] }> = {};

    if (hasExtGesture && gs) {
      // Non-wave gesture (point / openHand / beat) — takes priority
      const progress = Math.min(1, (now - gs.startMs) / gs.durationMs);
      switch (gs.type) {
        case 'point': applyPointGesture(pose, gs.side, progress, eulerTemp.current); break;
        case 'openHand': applyOpenHandGesture(pose, gs.side, progress, eulerTemp.current); break;
        case 'beat': applyBeatGesture(pose, gs.side, progress, gs.intensity, eulerTemp.current); break;
        default: break;
      }
    } else if ((isWaving && waveProgress > 0) || alwaysWave) {
      const prog = isWaving ? waveProgress : (t % 3) / 3;
      const waveAngle = Math.sin(prog * Math.PI * 3) * 1.2;
      eulerTemp.current.set(-0.9, 0.2, waveAngle, 'XYZ');
      pose.rightUpperArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(-0.7, 0, waveAngle * 1.2, 'XYZ');
      pose.rightLowerArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(0, 0, waveAngle * 2.2, 'XYZ');
      pose.rightHand = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(0, 0, 0, 'XYZ');
      pose.leftUpperArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      pose.leftLowerArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      pose.leftHand = { rotation: eulerToQuatArray(eulerTemp.current) };
    } else {
      const sway = Math.sin(t * 0.4) * ARM_IDLE_SWAY;
      const swayL = Math.sin(t * 0.55 + 1) * ARM_IDLE_SWAY * 0.6;
      const handSway = Math.sin(t * 0.6) * ARM_HAND_SWAY;
      const handSwayR = Math.sin(t * 0.5 + 0.5) * ARM_HAND_SWAY * 0.8;
      eulerTemp.current.set(sway, swayL, 0, 'YXZ');
      pose.leftUpperArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(swayL * 0.3, 0, 0, 'YXZ');
      pose.leftLowerArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(0, 0, handSway, 'YXZ');
      pose.leftHand = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(swayL, sway * 0.8, 0, 'YXZ');
      pose.rightUpperArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(sway * 0.3, 0, 0, 'YXZ');
      pose.rightLowerArm = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(0, 0, handSwayR, 'YXZ');
      pose.rightHand = { rotation: eulerToQuatArray(eulerTemp.current) };
    }

    // Leg pose when walking
    const walkState = walkStateRef?.current;
    if (walkState?.isWalking) {
      const phase = walkState.walkPhase;
      const rightSwing = Math.sin(phase) * 0.45;
      const leftSwing = Math.sin(phase + Math.PI) * 0.45;
      const rightKnee = Math.max(0, Math.sin(phase)) * 0.5;
      const leftKnee = Math.max(0, Math.sin(phase + Math.PI)) * 0.5;
      eulerTemp.current.set(rightSwing, 0, 0, 'YXZ');
      pose.rightUpperLeg = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(rightKnee, 0, 0, 'YXZ');
      pose.rightLowerLeg = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(Math.abs(rightSwing) * 0.15, 0, 0, 'YXZ');
      pose.rightFoot = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(leftSwing, 0, 0, 'YXZ');
      pose.leftUpperLeg = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(leftKnee, 0, 0, 'YXZ');
      pose.leftLowerLeg = { rotation: eulerToQuatArray(eulerTemp.current) };
      eulerTemp.current.set(Math.abs(leftSwing) * 0.15, 0, 0, 'YXZ');
      pose.leftFoot = { rotation: eulerToQuatArray(eulerTemp.current) };
    }

    const toApply = availableBonesRef.current.size > 0
      ? Object.fromEntries(Object.entries(pose).filter(([name]) => availableBonesRef.current.has(name)))
      : pose;
    if (Object.keys(toApply).length === 0) return;

    const applyRotation = (name: string, rot: [number, number, number, number]) => {
      const skelBone = skeletonBoneMapRef.current.get(name);
      if (skelBone) {
        skelBone.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
        return;
      }
      const node = humanoid?.getRawBoneNode(name as never) ?? humanoid?.getNormalizedBoneNode(name as never);
      if (node) node.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
    };

    if (skeletonBoneMapRef.current.size > 0) {
      for (const [name, data] of Object.entries(toApply) as [string, { rotation?: [number, number, number, number] }][]) {
        const rot = data?.rotation;
        if (rot?.length === 4) applyRotation(name, rot);
      }
    } else if (humanoid) {
      try {
        humanoid.setNormalizedPose(toApply);
      } catch {
        try {
          humanoid.setRawPose(toApply);
        } catch {
          for (const [name, data] of Object.entries(toApply) as [string, { rotation?: [number, number, number, number] }][]) {
            const rot = data?.rotation;
            if (rot?.length === 4) applyRotation(name, rot);
          }
        }
      }
    }
  }, -1);
}

function useProceduralBlink(vrmRef: React.RefObject<VRM | null>) {
  const nextBlinkRef = useRef(Date.now() + (BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)) * 1000);
  const blinkPhaseRef = useRef(0);
  const blinkSupportedRef = useRef<boolean | null>(null);

  useFrame((_, delta) => {
    try {
      const v = vrmRef.current;
      const em = v?.expressionManager;
      if (!em) return;

      const now = Date.now();

      if (blinkPhaseRef.current > 0) {
        blinkPhaseRef.current += delta * 14;
        const phase = blinkPhaseRef.current;
        const blinkVal = phase < Math.PI ? Math.sin(phase) : 0;
        if (blinkSupportedRef.current !== false) {
          try {
            em.setValue('blink' as never, Math.min(1, blinkVal));
            blinkSupportedRef.current = true;
          } catch {
            try {
              em.setValue('blinkLeft' as never, Math.min(1, blinkVal));
              em.setValue('blinkRight' as never, Math.min(1, blinkVal));
              blinkSupportedRef.current = true;
            } catch {
              blinkSupportedRef.current = false;
            }
          }
        }
        if (phase > Math.PI * 2) {
          blinkPhaseRef.current = 0;
          if (blinkSupportedRef.current) {
            try {
              em.setValue('blink' as never, 0);
            } catch {
              try {
                em.setValue('blinkLeft' as never, 0);
                em.setValue('blinkRight' as never, 0);
              } catch {
                /* ignore */
              }
            }
          }
          nextBlinkRef.current = now + (BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)) * 1000;
        }
      } else if (now >= nextBlinkRef.current) {
        blinkPhaseRef.current = 0.001;
      }
    } catch {
      /* never crash the avatar */
    }
  });
}

export interface VRMAvatarRef {
  speak: (text: string) => void;
}

function fallbackSpeakWebSpeech(text: string): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ar-SA';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

// ─── VRMModel ─────────────────────────────────────────────────────────────────

function VRMModel({
  vrmUrl,
  onLoad,
  onError,
  onSpeakReady,
  walkStateRef,
}: {
  vrmUrl: string;
  onLoad?: () => void;
  onError?: (err: string) => void;
  onSpeakReady?: (speak: (text: string) => void) => void;
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  // Keep a ref so useFrame / event callbacks always see the latest VRM
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // ── Lip-sync + emotion state ──────────────────────────────────────────────────
  const isTalkingRef = useRef(false);
  const talkStartRef = useRef(0);
  const visemeRef = useRef<VisemeWeights>({ aa: 0, ih: 0, ou: 0 });
  const timingsRef = useRef<WordTiming[] | null>(null);
  const audioStartTimeRef = useRef<number>(0);
  const lipSyncFlagSetRef = useRef(false);
  const emotionRef = useRef<string>('neutral');
  const postureLeanRef = useRef(0);
  const waveUntilRef = useRef(0);
  // Accumulated blob URLs that need to be revoked to prevent memory leaks
  // Note: TTS is now handled by speakWithTTS which manages its own audio lifecycle

  // ── Extended gesture state ─────────────────────────────────────────────────
  const gestureStateRef = useRef<GestureState | null>(null);

  const listeningRef = useListeningState();
  useHeadTracking(groupRef, listeningRef, {
    waveUntilRef,
    postureLeanRef,
    isTalkingRef,
  });
  useArmPose(vrmRef, waveUntilRef, gestureStateRef, walkStateRef);
  useProceduralBlink(vrmRef);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      emotionRef.current = 'thinking';
      postureLeanRef.current = 0.03;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!isTalkingRef.current) {
          emotionRef.current = 'neutral';
          postureLeanRef.current = 0;
        }
        timeoutId = null;
      }, 3000);
    };
    window.addEventListener('chat:sent', handler);
    return () => {
      window.removeEventListener('chat:sent', handler);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // ── avatar:gesture event listener ──────────────────────────────────────────
  useEffect(() => {
    const onGesture = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; side?: string; duration?: number; intensity?: number }>).detail;
      if (!d?.type) return;
      const type = d.type as ExtendedGestureType;
      const side = (d.side ?? 'right') as 'left' | 'right' | 'both';
      const duration = d.duration ?? 2.5;
      const intensity = d.intensity ?? 1;
      if (type === 'wave') {
        waveUntilRef.current = Date.now() + duration * 1000;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
        }
      } else {
        gestureStateRef.current = {
          active: true,
          type,
          side,
          startMs: Date.now(),
          durationMs: duration * 1000,
          intensity,
        };
      }
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[VRMAvatar] Gesture triggered: ${type} (${side}) ${duration}s`);
      }
    };
    window.addEventListener('avatar:gesture', onGesture);
    return () => window.removeEventListener('avatar:gesture', onGesture);
  }, []);

  // ── VRM loader ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));

    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (String(args[0] ?? '').includes('LookAtDegreeMap')) return;
      origWarn.apply(console, args);
    };

    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) return;
        setTimeout(() => { console.warn = origWarn; }, 0);
        try {
          const vrmModel = gltf.userData.vrm as VRM;
          if (!vrmModel?.scene) { onError?.('Invalid VRM data'); return; }
          vrmModel.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              const m = (o as THREE.Mesh).material;
              const mats = Array.isArray(m) ? m : [m];
              mats.forEach((mat) => {
                if (mat && (mat as THREE.MeshStandardMaterial).envMapIntensity !== undefined)
                  (mat as THREE.MeshStandardMaterial).envMapIntensity = 1;
              });
            }
          });
          vrmRef.current = vrmModel;
          setVrm(vrmModel);
          onLoad?.();
          waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;
          // Find right upper arm from skeleton (VRM humanoid getRawBoneNode may return null for some models)
          let rightArm: THREE.Bone | null = (vrmModel.humanoid?.getRawBoneNode('rightUpperArm' as never) ?? null) as THREE.Bone | null;
          if (!rightArm) {
            vrmModel.scene.traverse((o) => {
              const mesh = o as THREE.SkinnedMesh;
              if (mesh.skeleton && !rightArm) {
                const bone = mesh.skeleton.bones.find((b) => SKELETON_ARM_PATTERNS.rightUpperArm.test(b.name));
                if (bone) rightArm = bone;
              }
            });
          }
          if (rightArm) {
            try {
              const rest = rightArm.quaternion.clone();
              const qRaised = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0.3, 'XYZ'));
              const times = [0, 0.25, 0.5, 0.75, 1];
              const v = (q: THREE.Quaternion) => [q.x, q.y, q.z, q.w];
              const values = [...v(rest), ...v(qRaised), ...v(rest), ...v(qRaised), ...v(rest)];
              const trackName = rightArm.uuid + '.quaternion';
              const track = new THREE.QuaternionKeyframeTrack(trackName, times, values);
              const clip = new THREE.AnimationClip('waveArm', 1, [track]);
              const mixer = new THREE.AnimationMixer(vrmModel.scene);
              mixerRef.current = mixer;
              mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
              console.warn('[VRMAvatar] Wave animation started for bone:', rightArm.name);
            } catch (animErr) {
              console.warn('[VRMAvatar] Wave clip failed:', (animErr as Error).message);
            }
          } else {
            console.warn('[VRMAvatar] No rightUpperArm bone found — wave animation skipped');
          }
          // Log skeleton structure for debugging (always show when VRM loads)
          const armBones: string[] = [];
          const allBones: string[] = [];
          vrmModel.scene.traverse((o) => {
            const m = o as THREE.SkinnedMesh;
            if (m.skeleton) {
              m.skeleton.bones.forEach((b) => {
                allBones.push(b.name);
                if (/arm|hand|upper|lower|shoulder|forearm/i.test(b.name)) armBones.push(b.name);
              });
            }
          });
          console.warn('[VRMAvatar] VRM loaded. Arm bones:', armBones.length ? armBones.join(', ') : 'none');
          if (allBones.length === 0) {
            console.warn('[VRMAvatar] No skeleton found in scene — mesh structure may differ');
          } else if (armBones.length === 0) {
            console.warn('[VRMAvatar] Bone names (first 25):', allBones.slice(0, 25).join(', '));
          }
        } catch (e) {
          console.warn = origWarn;
          const msg = (e as Error)?.message ?? 'VRM load error';
          console.warn('[VRMAvatar] خطأ تحميل VRM:', msg);
          onError?.(msg);
        }
      },
      undefined,
      (error) => {
        if (cancelled) return;
        console.warn = origWarn;
        const msg = (error as Error)?.message || 'VRM load failed';
        console.warn('[VRMAvatar] Furina.vrm غير موجود — استخدم SimpleAvatarPlaceholder (كرة زرقاء). أضف public/models/Furina.vrm لتفعيل الأفاتار الكامل.', msg);
        onError?.(msg);
      }
    );
    return () => {
      cancelled = true;
      console.warn = origWarn;
    };
  }, [vrmUrl, onLoad, onError]);

  const onSpeakEnd = useCallback(() => {
    isTalkingRef.current = false;
    timingsRef.current = null;
    lipSyncFlagSetRef.current = false;
    emotionRef.current = 'neutral';
    postureLeanRef.current = 0;
    visemeRef.current = { aa: 0, ih: 0, ou: 0 };
    const v = vrmRef.current;
    if (v?.expressionManager) {
      v.expressionManager.setValue(BS_AA, 0);
      v.expressionManager.setValue(BS_IH, 0);
      v.expressionManager.setValue(BS_OU, 0);
      v.expressionManager.setValue('happy' as never, 0);
      v.expressionManager.setValue('angry' as never, 0);
      v.expressionManager.setValue('sad' as never, 0);
      v.expressionManager.setValue('relaxed' as never, 0);
    }
  }, []);

  const doSpeak = useCallback((text: string) => {
    if (!text?.trim()) return;
    const plan = inferResponsePlan(text);
    emotionRef.current = plan.emotion;
    postureLeanRef.current = plan.posture.lean === 'listen' ? 0.03 : plan.posture.lean === 'emphasize' ? -0.02 : 0;
    // Dispatch gesture based on emotion
    const emotionGestureMap: Record<string, { type: ExtendedGestureType; side: 'left' | 'right' | 'both'; duration: number; intensity: number }> = {
      celebration: { type: 'wave', side: 'both', duration: 2.5, intensity: 1 },
      encouraging: { type: 'openHand', side: 'right', duration: 1.8, intensity: 0.9 },
      strictEvaluation: { type: 'point', side: 'right', duration: 1.5, intensity: 1 },
      friendly: { type: 'beat', side: 'both', duration: 1.4, intensity: 0.7 },
    };
    const gestureConfig = emotionGestureMap[plan.emotion];
    if (gestureConfig) {
      if (gestureConfig.type === 'wave') {
        waveUntilRef.current = Date.now() + gestureConfig.duration * 1000;
      } else {
        gestureStateRef.current = {
          active: true,
          type: gestureConfig.type,
          side: gestureConfig.side,
          startMs: Date.now(),
          durationMs: gestureConfig.duration * 1000,
          intensity: gestureConfig.intensity,
        };
      }
    }
    speakWithTTS(text, {
      onStart: () => {
        isTalkingRef.current = true;
        talkStartRef.current = 0;
      },
      onEnd: onSpeakEnd,
    }).then((ok) => {
      if (!ok) fallbackSpeakWebSpeech(text);
    });
  }, [onSpeakEnd]);

  useEffect(() => {
    onSpeakReady?.(doSpeak);
  }, [onSpeakReady, doSpeak]);

  useEffect(() => {
    const onSpeak = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; timings?: WordTiming[]; sampleRate?: number; audio?: HTMLAudioElement } | string>).detail;
      const text = typeof d === 'string' ? d : d?.text ?? '';
      const timings = typeof d === 'object' ? d?.timings : undefined;
      const audio = typeof d === 'object' ? d?.audio : undefined;
      if (text) {
        const plan = inferResponsePlan(text);
        emotionRef.current = plan.emotion;
        postureLeanRef.current = plan.posture.lean === 'listen' ? 0.03 : plan.posture.lean === 'emphasize' ? -0.02 : 0;
      }
      if (timings !== undefined) {
        timingsRef.current = Array.isArray(timings) ? timings : null;
      }
      if (text && timings === undefined && !audio) {
        doSpeak(text);
      }
    };
    const onSpeakStart = () => {
      isTalkingRef.current = true;
      talkStartRef.current = 0;
      audioStartTimeRef.current = Date.now();
    };
    const onSpeakEndEvt = () => onSpeakEnd();

    window.addEventListener('avatar:speak', onSpeak);
    window.addEventListener('avatar:speak:start', onSpeakStart);
    window.addEventListener('avatar:speak:end', onSpeakEndEvt);
    return () => {
      window.removeEventListener('avatar:speak', onSpeak);
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      window.removeEventListener('avatar:speak:end', onSpeakEndEvt);
    };
  }, [doSpeak, onSpeakEnd]);

  const { pointer, camera } = useThree();
  const lookAtTargetRef = useRef(new THREE.Vector3());

  // ── Animation frame ─────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    if (mixerRef.current) mixerRef.current.update(delta);
    const currentVrm = vrmRef.current;
    if (currentVrm) {
      // Head/eyes follow pointer for interactive gaze
      const lookAt = (currentVrm as { lookAt?: { autoUpdate?: boolean; lookAt: (p: THREE.Vector3) => void } }).lookAt;
      if (lookAt) {
        lookAt.autoUpdate = false;
        lookAtTargetRef.current.set(pointer.x, pointer.y, 0.4).unproject(camera);
        lookAt.lookAt(lookAtTargetRef.current);
      }
      currentVrm.update(delta);

      // ── Lip-sync (viseme) + emotion blendshapes ──────────────────────────────
      const em = currentVrm.expressionManager;
      if (em) {
        if (isTalkingRef.current) {
          if (talkStartRef.current === 0) talkStartRef.current = state.clock.elapsedTime;
          const timings = timingsRef.current;
          const elapsedMs = timings?.length && audioStartTimeRef.current > 0
            ? Date.now() - audioStartTimeRef.current
            : (state.clock.elapsedTime - talkStartRef.current) * 1000;
          if (timings?.length) {
            const target = timingsToVisemeAt(timings, elapsedMs);
            visemeRef.current = lerpViseme(visemeRef.current, target, delta);
            if (!lipSyncFlagSetRef.current && typeof window !== 'undefined') {
              lipSyncFlagSetRef.current = true;
              try {
                (window as unknown as { __lipSyncStarted?: boolean }).__lipSyncStarted = true;
                if (process.env.NODE_ENV === 'development') console.debug('[VRMAvatar] __lipSyncStarted = true (timings)');
              } catch { }
            }
          } else {
            const t = state.clock.elapsedTime - talkStartRef.current;
            visemeRef.current = proceduralViseme(t);
            if (!lipSyncFlagSetRef.current && typeof window !== 'undefined') {
              lipSyncFlagSetRef.current = true;
              try {
                (window as unknown as { __lipSyncStarted?: boolean }).__lipSyncStarted = true;
                if (process.env.NODE_ENV === 'development') console.debug('[VRMAvatar] __lipSyncStarted = true (procedural)');
              } catch { }
            }
          }
          em.setValue(BS_AA, visemeRef.current.aa);
          em.setValue(BS_IH, visemeRef.current.ih);
          em.setValue(BS_OU, visemeRef.current.ou);
        } else {
          visemeRef.current = decayViseme(visemeRef.current);
          em.setValue(BS_AA, visemeRef.current.aa);
          em.setValue(BS_IH, visemeRef.current.ih);
          em.setValue(BS_OU, visemeRef.current.ou);
        }
        const emotionBlend = EMOTION_BLENDSHAPES[emotionRef.current as keyof typeof EMOTION_BLENDSHAPES];
        if (emotionBlend) {
          if (emotionBlend.joy != null) em.setValue('happy' as never, emotionBlend.joy);
          if (emotionBlend.angry != null) em.setValue('angry' as never, emotionBlend.angry);
          if (emotionBlend.sorrow != null) em.setValue('sad' as never, emotionBlend.sorrow);
          if (emotionBlend.fun != null) em.setValue('relaxed' as never, emotionBlend.fun);
        }
      }
    }

  });

  const handlePointerDown = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
    }
  }, []);

  return vrm ? (
    <group
      ref={groupRef}
      position={[0, AVATAR_BASE_Y, 0.2]}
      matrixAutoUpdate={false}
      onPointerDown={handlePointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
      }}
    >
      <group rotation={[0, Math.PI, 0]}>
        <primitive object={vrm.scene} />
      </group>
    </group>
  ) : null;
}

// ─── SimpleAvatarPlaceholder (used when useSimpleFallback=true) ───────────────

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setMobile(window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

const NEVER_TALKING_REF = { current: false };

function SimpleAvatarPlaceholder() {
  const groupRef = useRef<THREE.Group>(null);
  const mobile = useIsMobile();
  const listeningRef = useListeningState();
  const waveUntilRef = useRef(0);
  useHeadTracking(groupRef, listeningRef, { waveUntilRef, isTalkingRef: NEVER_TALKING_REF });
  const segments = mobile ? 16 : 32;

  const handlePointerDown = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:waved', { detail: {} }));
    }
  }, []);

  return (
    <group
      ref={groupRef}
      position={[0, AVATAR_BASE_Y, 0.2]}
      matrixAutoUpdate={false}
      onPointerDown={handlePointerDown}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
      }}
    >
      <group rotation={[0, Math.PI, 0]}>
        <mesh>
          <sphereGeometry args={[0.35, segments, segments]} />
          <meshStandardMaterial color="#4a90e2" />
        </mesh>
      </group>
    </group>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export interface BoardroomAvatarProps {
  vrmUrl?: string;
  scale?: number;
  onLoad?: () => void;
  onError?: (err: string) => void;
  useSimpleFallback?: boolean;
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>;
}

const VRMAvatarInner = forwardRef<VRMAvatarRef, BoardroomAvatarProps>(function VRMAvatarInner(
  { vrmUrl = VRM_URL, scale = 1, onLoad, onError, useSimpleFallback = false, walkStateRef },
  ref
) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const speakFnRef = useRef<((text: string) => void) | null>(null);
  const humRef = useRef<Howl | null>(null);
  const humResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    speak: (text: string) => {
      if (speakFnRef.current) speakFnRef.current(text);
      else fallbackSpeakWebSpeech(text);
    },
  }));

  useEffect(() => {
    let hum: Howl | null = null;
    const onResume = () => {
      if (hum) {
        hum.volume(0.02);
        if (!hum.playing()) hum.play();
        return;
      }
      try {
        hum = new Howl({
          src: [HUM_URL, HUM_URL_ALT],
          volume: 0.02,
          loop: true,
          html5: true,
          onloaderror: () => { hum = null; humRef.current = null; },
        });
        humRef.current = hum;
        hum.play();
      } catch {
        humRef.current = null;
      }
    };
    window.addEventListener('audio:resume', onResume);
    return () => {
      window.removeEventListener('audio:resume', onResume);
      hum?.stop();
      hum?.unload();
      humRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onReceived = () => {
      const h = humRef.current;
      if (!h) return;
      if (humResetTimeoutRef.current) clearTimeout(humResetTimeoutRef.current);
      h.volume(0.06);
      humResetTimeoutRef.current = setTimeout(() => {
        h.volume(0.02);
        humResetTimeoutRef.current = null;
      }, 600);
    };
    window.addEventListener('chat:received', onReceived);
    return () => {
      window.removeEventListener('chat:received', onReceived);
      if (humResetTimeoutRef.current) {
        clearTimeout(humResetTimeoutRef.current);
        humResetTimeoutRef.current = null;
      }
    };
  }, []);

  const handleError = useCallback((err: string) => {
    setLoadError(err);
    onError?.(err);
  }, [onError]);

  const handleSpeakReady = useCallback((fn: (text: string) => void) => {
    speakFnRef.current = fn;
  }, []);

  if (useSimpleFallback || loadError) {
    return (
      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.08} floatingRange={[-0.04, 0.04]}>
        <group scale={scale}>
          <SimpleAvatarPlaceholder />
        </group>
      </Float>
    );
  }

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.08} floatingRange={[-0.04, 0.04]}>
      <group scale={scale}>
        <VRMModel
          vrmUrl={vrmUrl}
          onLoad={onLoad}
          onError={handleError}
          onSpeakReady={handleSpeakReady}
          walkStateRef={walkStateRef}
        />
      </group>
    </Float>
  );
});

export default VRMAvatarInner;
