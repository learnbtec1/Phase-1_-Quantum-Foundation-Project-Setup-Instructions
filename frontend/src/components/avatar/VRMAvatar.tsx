'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Howl } from 'howler';
import { speakWithTTS, stopTTS, type WordTiming } from '@/ai/io/tts';
import { inferResponsePlan, parseVeronaResponse } from '@/ai/avatar/brain';
import { dispatchGestureFromActionText } from '@/ai/avatar/actions';
import { EMOTION_BLENDSHAPES } from '@/ai/avatar/state';
import { proceduralViseme, decayViseme, type VisemeWeights } from '@/ai/lipsync/viseme';
import { timingsToVisemeAt, lerpViseme } from '@/ai/lipsync/timing';
import { EmotionManager } from '@/ai/avatar/managers/EmotionManager';
import { PhonemeManager } from '@/ai/avatar/managers/PhonemeManager';

const VRM_URL = '/models/teach.vrm';
const HUM_URL = '/audio/voices/teacher/hum.mp3';
const HUM_URL_ALT = '/audio/ambience/boardroom.mp3';

const BS_AA = 'aa';
const BS_IH = 'ih';
const BS_OU = 'ou';

const HEAD_YAW_LIMIT = 0.5;
const HEAD_PITCH_LIMIT = 0.35;
const HEAD_SENSITIVITY_YAW = 0.65;
const HEAD_SENSITIVITY_PITCH = 0.5;
const NOD_DURATION = 1.2;
const NOD_INTENSITY = 0.15;
const USER_SENT_ACK_DURATION = 0.6;
const USER_SENT_ACK_INTENSITY = 0.08;
const BLINK_INTERVAL_MIN = 2.2;
const BLINK_INTERVAL_MAX = 4.5;
const AVATAR_BASE_Y = -0.5;
const IDLE_SWAY_AMOUNT = 0.04;
const BREATHE_AMPLITUDE = 0;
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
    const _evtSeen_ls = new Set<string>();
    const onListening = (e: Event) => {
      if (process.env.NODE_ENV === 'development' && !_evtSeen_ls.has('avatar:listening')) {
        _evtSeen_ls.add('avatar:listening');
        console.log('[EVT][RIG]', 'avatar:listening', { keys: Object.keys((e as CustomEvent).detail ?? {}), sample: (e as CustomEvent).detail });
      }
      listeningRef.current = (e as CustomEvent<{ active?: boolean }>).detail?.active ?? false;
    };
    window.addEventListener('avatar:listening', onListening);
    return () => window.removeEventListener('avatar:listening', onListening);
  }, []);
  return listeningRef;
}

function useHeadTracking(
  groupRef: React.RefObject<THREE.Group | null>,
  _listeningRef?: React.RefObject<boolean>,
  opts?: { waveUntilRef?: React.RefObject<number>; postureLeanRef?: React.RefObject<number>; isTalkingRef?: React.RefObject<boolean> }
) {
  const yOscLoggedRef = useRef(false);
  useFrame(() => {
    if (!yOscLoggedRef.current) {
      console.log('[HUMANIZE][IDLE] Whole-body Y oscillation: disabled');
      yOscLoggedRef.current = true;
    }
    const g = groupRef.current;
    if (!g) return;
    g.position.set(0, AVATAR_BASE_Y, 0.2);
    g.updateMatrix();
  });
}

function eulerToQuatArray(euler: THREE.Euler): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(euler);
  return [q.x, q.y, q.z, q.w];
}

const ARM_BONE_NAMES = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const;

const SKELETON_ARM_PATTERNS: Record<string, RegExp> = {
  rightUpperArm: /J_Bip_R_UpperArm|RightUpperArm|Right Arm|rightUpperArm|mixamorigRightArm|RightArm|R_UpperArm|ذراع_يمين|الذراع_الأيمن|عضد_يمين|ذراع يمين|الذراع الأيمن|العضد_الأيمن|右腕|右腕上/i,
  rightLowerArm: /J_Bip_R_LowerArm|RightLowerArm|Right Forearm|rightLowerArm|mixamorigRightForeArm|RightForeArm|R_LowerArm|ساعد_يمين|الساعد_الأيمن|ساعد يمين|الساعد الأيمن|右ひじ|右前腕/i,
  rightHand: /J_Bip_R_Hand|RightHand|Right Hand|rightHand|mixamorigRightHand|R_Hand|يد_يمين|اليد_اليمنى|يد يمين|اليد اليمنى|右手/i,
  leftUpperArm: /J_Bip_L_UpperArm|LeftUpperArm|Left Arm|leftUpperArm|mixamorigLeftArm|LeftArm|L_UpperArm|ذراع_يسار|الذراع_الأيسر|عضد_يسار|ذراع يسار|الذراع الأيسر|العضد_الأيسر|左腕|左腕上/i,
  leftLowerArm: /J_Bip_L_LowerArm|LeftLowerArm|Left Forearm|leftLowerArm|mixamorigLeftForeArm|LeftForeArm|L_LowerArm|ساعد_يسار|الساعد_الأيسر|ساعد يسار|الساعد الأيسر|左ひじ|左前腕/i,
  leftHand: /J_Bip_L_Hand|LeftHand|Left Hand|leftHand|mixamorigLeftHand|L_Hand|يد_يسار|اليد_اليسرى|يد يسار|اليد اليسرى|左手/i,
};

const LEG_BONE_NAMES = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] as const;

const SKELETON_LEG_PATTERNS: Record<string, RegExp> = {
  rightUpperLeg: /J_Bip_R_UpperLeg|RightUpperLeg|Right Thigh|rightUpperLeg|mixamorigRightUpLeg|RightUpLeg|R_UpperLeg|فخذ_يمين|الفخذ_الأيمن|فخذ يمين|الفخذ الأيمن|右足上|右腿|右太腿|右足D|右CF_1/i,
  rightLowerLeg: /J_Bip_R_LowerLeg|RightLowerLeg|Right Shin|rightLowerLeg|mixamorigRightLeg|RightLeg|R_LowerLeg|ساق_يمين|الساق_الأيمن|ساق يمين|الساق الأيمن|右ひざ|右膝|右下腿|右足E|右CF_2/i,
  rightFoot: /J_Bip_R_Foot|RightFoot|rightFoot|mixamorigRightFoot|R_Foot|قدم_يمين|القدم_اليمنى|قدم يمين|القدم اليمنى|右足首|右足先|右足捩|右CF_3/i,
  leftUpperLeg: /J_Bip_L_UpperLeg|LeftUpperLeg|Left Thigh|leftUpperLeg|mixamorigLeftUpLeg|LeftUpLeg|L_UpperLeg|فخذ_يسار|الفخذ_الأيسر|فخذ يسار|الفخذ الأيسر|左足上|左腿|左太腿|左足D|左CF_1/i,
  leftLowerLeg: /J_Bip_L_LowerLeg|LeftLowerLeg|Left Shin|leftLowerLeg|mixamorigLeftLeg|LeftLeg|L_LowerLeg|ساق_يسار|الساق_الأيسر|ساق يسار|الساق الأيسر|左ひざ|左膝|左下腿|左足E|左CF_2/i,
  leftFoot: /J_Bip_L_Foot|LeftFoot|leftFoot|mixamorigLeftFoot|L_Foot|قدم_يسار|القدم_اليسرى|قدم يسار|القدم اليسرى|左足首|左足先|左足捩|左CF_3/i,
};

const SKELETON_TRUNK_PATTERNS: Record<string, RegExp> = {
  hips: /J_Bip_C_Hips|Hips|hips|mixamorigHips|حوض|الوركان|الحوض|腰/i,
  spine: /J_Bip_C_Spine|Spine$|spine$|mixamorigSpine$|Spine1?$|عمود_فقري|العمود_الفقري|فقرات|脊椎|脊柱/i,
  chest: /J_Bip_C_Chest|Spine1|chest|mixamorigSpine1|صدر|الصدر|القفص_الصدري|胸/i,
  neck: /J_Bip_C_Neck|Neck|neck|mixamorigNeck|رقبة|الرقبة|العنق|عنق|首/i,
  head: /J_Bip_C_Head|Head|head|mixamorigHead|رأس|الرأس|頭/i,
  rightShoulder: /J_Bip_R_Shoulder|RightShoulder|Right Shoulder|mixamorigRightShoulder|كتف_يمين|الكتف_الأيمن|كتف يمين|右肩/i,
  leftShoulder: /J_Bip_L_Shoulder|LeftShoulder|Left Shoulder|mixamorigLeftShoulder|كتف_يسار|الكتف_الأيسر|كتف يسار|左肩/i,
};

const VRM_BONE_LABELS_AR: Record<string, string> = {
  hips: 'الوركان (Hips)',
  spine: 'العمود الفقري (Spine)',
  chest: 'الصدر (Chest)',
  upperChest: 'أعلى الصدر (UpperChest)',
  neck: 'الرقبة (Neck)',
  head: 'الرأس (Head)',
  leftShoulder: 'الكتف الأيسر',
  rightShoulder: 'الكتف الأيمن',
  leftUpperArm: 'الذراع الأيسر العلوي (العضد)',
  leftLowerArm: 'الساعد الأيسر',
  leftHand: 'اليد اليسرى',
  rightUpperArm: 'الذراع الأيمن العلوي (العضد)',
  rightLowerArm: 'الساعد الأيمن',
  rightHand: 'اليد اليمنى',
  leftUpperLeg: 'الفخذ الأيسر',
  leftLowerLeg: 'الساق الأيسر',
  leftFoot: 'القدم اليسرى',
  leftToes: 'أصابع القدم اليسرى',
  rightUpperLeg: 'الفخذ الأيمن',
  rightLowerLeg: 'الساق الأيمن',
  rightFoot: 'القدم اليمنى',
  rightToes: 'أصابع القدم اليمنى',
  leftThumbProximal: 'إبهام يسار — قاعدة',
  leftThumbIntermediate: 'إبهام يسار — وسط',
  leftThumbDistal: 'إبهام يسار — طرف',
  leftIndexProximal: 'سبابة يسار — قاعدة',
  leftIndexIntermediate: 'سبابة يسار — وسط',
  leftIndexDistal: 'سبابة يسار — طرف',
  leftMiddleProximal: 'وسطى يسار — قاعدة',
  leftMiddleIntermediate: 'وسطى يسار — وسط',
  leftMiddleDistal: 'وسطى يسار — طرف',
  leftRingProximal: 'بنصر يسار — قاعدة',
  leftRingIntermediate: 'بنصر يسار — وسط',
  leftRingDistal: 'بنصر يسار — طرف',
  leftLittleProximal: 'خنصر يسار — قاعدة',
  leftLittleIntermediate: 'خنصر يسار — وسط',
  leftLittleDistal: 'خنصر يسار — طرف',
  rightThumbProximal: 'إبهام يمين — قاعدة',
  rightThumbIntermediate: 'إبهام يمين — وسط',
  rightThumbDistal: 'إبهام يمين — طرف',
  rightIndexProximal: 'سبابة يمين — قاعدة',
  rightIndexIntermediate: 'سبابة يمين — وسط',
  rightIndexDistal: 'سبابة يمين — طرف',
  rightMiddleProximal: 'وسطى يمين — قاعدة',
  rightMiddleIntermediate: 'وسطى يمين — وسط',
  rightMiddleDistal: 'وسطى يمين — طرف',
  rightRingProximal: 'بنصر يمين — قاعدة',
  rightRingIntermediate: 'بنصر يمين — وسط',
  rightRingDistal: 'بنصر يمين — طرف',
  rightLittleProximal: 'خنصر يمين — قاعدة',
  rightLittleIntermediate: 'خنصر يمين — وسط',
  rightLittleDistal: 'خنصر يمين — طرف',
};

export type ExtendedGestureType = 'wave' | 'point' | 'openHand' | 'beat' | 'head_down';
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
      const humanoidBoneNames = [...ARM_BONE_NAMES, ...LEG_BONE_NAMES] as string[];
      let humanoidFound = 0;
      humanoidBoneNames.forEach((name) => {
        const node = humanoid?.getRawBoneNode(name as never) ?? humanoid?.getNormalizedBoneNode(name as never);
        if (node) {
          skeletonBoneMapRef.current.set(name, node as THREE.Bone);
          availableBonesRef.current.add(name);
          humanoidFound++;
        }
      });

      if (humanoidFound > 0 && process.env.NODE_ENV === 'development') {
        const report = [...skeletonBoneMapRef.current.entries()]
          .map(([k, b]) => `  ${VRM_BONE_LABELS_AR[k] ?? k}  →  ${b.name}`)
          .join('\n');
        console.debug('%c[أفاتار] ✅ عظام humanoid محمّلة:', 'color:#4fc3f7;font-weight:bold', `\n${report}`);
      }

      if (humanoidFound < ARM_BONE_NAMES.length) {
        const allPatterns = { ...SKELETON_ARM_PATTERNS, ...SKELETON_LEG_PATTERNS, ...SKELETON_TRUNK_PATTERNS };
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
        if (process.env.NODE_ENV === 'development' && skeletonBoneMapRef.current.size > 0) {
          const report = [...skeletonBoneMapRef.current.entries()]
            .map(([k, b]) => `  ${VRM_BONE_LABELS_AR[k] ?? k}  →  "${b.name}"`)
            .join('\n');
          console.debug('%c[أفاتار] ⚙️ عظام مُكتشفة بنمط المطابقة:', 'color:#ffb74d;font-weight:bold', `\n${report}`);
        }
      }
    }

    const t = state.clock.elapsedTime;
    const now = Date.now();
    const isWaving = !!waveUntilRef.current && now < waveUntilRef.current;
    const waveElapsed = isWaving ? (waveUntilRef.current - now) / 1000 : 0;
    const waveProgress = isWaving ? 1 - waveElapsed / WAVE_DURATION : 0;
    const alwaysWave = false;

    const gs = gestureStateRef?.current;
    if (gs?.active && now > gs.startMs + gs.durationMs) {
      gs.active = false;
    }
    const hasExtGesture = gs?.active && gs.type !== 'wave';

    const pose: Record<string, { rotation?: [number, number, number, number] }> = {};

    if (hasExtGesture && gs) {
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
  }, 1);
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
  setEmotion: (emotion: string) => void;
}

function fallbackSpeakWebSpeech(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();

    const lang     = /[\u0600-\u06FF]/.test(text) ? 'ar-SA' : 'en-US';
    const langBase = lang.split('-')[0];

    let launched = false;
    const doSpeak = () => {
      if (launched) return;
      launched = true;
      const voices   = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.lang === lang) ??
        voices.find(v => v.lang.startsWith(langBase)) ??
        null;

      if (!preferred) {
        console.warn('[TTS:VRMfallback] No voice for', lang, '— audio skipped');
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
        return;
      }

      console.log('[TTS:VRMfallback] ✅ voice selected:', preferred.name, preferred.lang);

      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.9;
      u.voice = preferred;
      u.onstart = () => {
        onStart?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:start'));
      };
      u.onend = () => {
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      u.onerror = () => {
        onEnd?.();
        window.dispatchEvent(new CustomEvent('avatar:speak:end'));
      };
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => { doSpeak(); };
      setTimeout(() => {
        if (window.speechSynthesis.getVoices().length > 0) doSpeak();
      }, 800);
    }
    return true;
  } catch {
    return false;
  }
}

const EMOTION_HEAD_REACTIONS: Readonly<Record<string, { dx?: number; dy?: number; durationMs: number }>> = {
  proud:       { dy: -0.22, durationMs: 1400 },
  curious:     { dx: -0.18, durationMs: 1600 },
  concerned:   { dy:  0.18, durationMs: 1300 },
  attentive:   { dy: -0.12, durationMs: 1100 },
  surprised:   { dy: -0.24, durationMs:  700 },
  excited:     { dy: -0.14, durationMs:  900 },
  celebration: { dy: -0.20, durationMs: 1000 },
  celebrate:   { dy: -0.20, durationMs: 1000 },
  happy:       { dy: -0.10, durationMs: 1000 },
  thinking:    { dx:  0.16, durationMs: 2000 },
  sad:         { dy:  0.22, durationMs: 2200 },
  angry:       { dy:  0.08, durationMs: 1200 },
  sleepy:      { dy:  0.15, durationMs: 2500 },
  goodbye:     { dx: -0.10, durationMs: 1000 },
};

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
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const isTalkingRef = useRef(false);
  const talkStartRef = useRef(0);
  const visemeRef = useRef<VisemeWeights>({ aa: 0, ih: 0, ou: 0 });
  const timingsRef = useRef<WordTiming[] | null>(null);
  const audioStartTimeRef = useRef<number>(0);
  const lipSyncFlagSetRef = useRef(false);
  const emotionRef = useRef<string>('neutral');
  const postureLeanRef = useRef(0);
  const waveUntilRef = useRef(0);

  const gestureStateRef = useRef<GestureState | null>(null);

  const emotionManagerRef = useRef<EmotionManager | null>(null);
  const phonemeManagerRef = useRef<PhonemeManager | null>(null);
  const frameCounterRef = useRef(0);

  const internalWalkRef = useRef<{ isWalking: boolean; walkPhase: number }>({ isWalking: false, walkPhase: 0 });
  const activeWalkRef = walkStateRef ?? internalWalkRef;

  useEffect(() => {
    const onWalk = (e: Event) => {
      const isWalking = (e as CustomEvent<{ isWalking?: boolean }>).detail?.isWalking ?? true;
      console.log('%c[V30] 📨 avatar:walk received', 'color:cyan', '| isWalking:', isWalking, '| activeWalkRef:', activeWalkRef.current);
      const cur = activeWalkRef.current ?? { isWalking: false, walkPhase: 0 };
      activeWalkRef.current = { ...cur, isWalking };
    };
    const onStop = () => {
      const cur = activeWalkRef.current;
      if (cur) cur.isWalking = false;
    };
    window.addEventListener('avatar:walk', onWalk);
    window.addEventListener('avatar:stop', onStop);
    return () => {
      window.removeEventListener('avatar:walk', onWalk);
      window.removeEventListener('avatar:stop', onStop);
    };
  }, [activeWalkRef]);

  const listeningRef = useListeningState();
  useHeadTracking(groupRef, listeningRef, {
    waveUntilRef,
    postureLeanRef,
    isTalkingRef,
  });
  useArmPose(vrmRef, waveUntilRef, gestureStateRef, activeWalkRef);
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

  useEffect(() => {
    const _evtSeen_em = new Set<string>();
    const onEmotion = (e: Event) => {
      const em = (e as CustomEvent<{ emotion?: string }>).detail?.emotion;
      if (process.env.NODE_ENV === 'development' && !_evtSeen_em.has('avatar:emotion')) {
        _evtSeen_em.add('avatar:emotion');
        console.log('[EVT][RIG]', 'avatar:emotion', { keys: Object.keys((e as CustomEvent).detail ?? {}), sample: (e as CustomEvent).detail });
      }
      console.log('%c[V30] 📨 avatar:emotion received', 'color:cyan', '| emotion:', em, '| EmotionManager:', emotionManagerRef.current ? '✅ ready' : '❌ NULL');
      if (em) {
        emotionRef.current = em;
        if (em !== 'neutral') postureLeanRef.current = 0.02;
        emotionManagerRef.current?.setEmotion(em);
        const reaction = EMOTION_HEAD_REACTIONS[em];
        if (reaction) {
          const orig = lookAtTargetRef.current.clone();
          if (reaction.dx) lookAtTargetRef.current.x += reaction.dx;
          if (reaction.dy) lookAtTargetRef.current.y += reaction.dy;
          setTimeout(() => lookAtTargetRef.current.copy(orig), reaction.durationMs);
        }
      }
    };
    window.addEventListener('avatar:emotion', onEmotion);
    return () => window.removeEventListener('avatar:emotion', onEmotion);
  }, []);

  useEffect(() => {
    const onUserReact = (e: Event) => {
      const type = (e as CustomEvent<{ type?: string }>).detail?.type;
      switch (type) {
        case 'greeting':
          waveUntilRef.current = Date.now() + 2200;
          emotionRef.current = 'friendly';
          break;
        case 'praise':
          gestureStateRef.current = { active: true, type: 'beat', side: 'both', startMs: Date.now(), durationMs: 1400, intensity: 0.5 };
          emotionRef.current = 'encouraging';
          break;
        case 'farewell':
          waveUntilRef.current = Date.now() + 2500;
          emotionRef.current = 'friendly';
          break;
        case 'question':
          emotionRef.current = 'thinking';
          postureLeanRef.current = 0.04;
          break;
        case 'listening':
          postureLeanRef.current = 0.03;
          break;
      }
    };
    window.addEventListener('avatar:userreact', onUserReact);
    return () => window.removeEventListener('avatar:userreact', onUserReact);
  }, []);

  useEffect(() => {
    const _evtSeen_gs = new Set<string>();
    const onGesture = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; side?: string; duration?: number; intensity?: number }>).detail;
      if (process.env.NODE_ENV === 'development' && !_evtSeen_gs.has('avatar:gesture')) {
        _evtSeen_gs.add('avatar:gesture');
        console.log('[EVT][RIG]', 'avatar:gesture', { keys: Object.keys(d ?? {}), sample: d });
      }
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
      } else if (type === 'head_down') {
        // head_down: tilt head down via lookAt target Y offset
        const origY = lookAtTargetRef.current.y;
        lookAtTargetRef.current.y -= intensity * 0.25;
        setTimeout(() => { lookAtTargetRef.current.y = origY; }, duration * 1000);
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
    let headTurnTimeout: NodeJS.Timeout | null = null;
    const onHeadTurn = (e: Event) => {
      const d = (e as CustomEvent<{ direction?: string; angle?: number; duration?: number }>).detail;
      const angle = typeof d.angle === 'number' ? d.angle : 0.5;
      const duration = typeof d.duration === 'number' ? d.duration : 1.2;
      const originalTarget = lookAtTargetRef.current.clone();
      lookAtTargetRef.current.x += d.direction === 'left' ? -angle : angle;
      if (headTurnTimeout) clearTimeout(headTurnTimeout);
      headTurnTimeout = setTimeout(() => {
        lookAtTargetRef.current.copy(originalTarget);
      }, duration * 1000);
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[VRMAvatar] Head turn: ${d.direction} angle=${angle} duration=${duration}s`);
      }
    };
    window.addEventListener('avatar:gesture', onGesture);
    window.addEventListener('avatar:headturn', onHeadTurn);
    return () => {
      window.removeEventListener('avatar:gesture', onGesture);
      window.removeEventListener('avatar:headturn', onHeadTurn);
      if (headTurnTimeout) clearTimeout(headTurnTimeout);
    };
  }, []);

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

        const vrmModel = gltf.userData.vrm as VRM;
        if (!vrmModel?.scene) {
          console.warn('[VRMAvatar] No VRM data in gltf.userData.vrm — file may not be a valid VRM');
          onError?.('Invalid VRM — no scene');
          return;
        }

        try { VRMUtils.removeUnnecessaryVertices(vrmModel.scene); } catch (e) { console.warn('[VRM] removeUnnecessaryVertices failed (ok):', e); }
        try { VRMUtils.combineSkeletons(vrmModel.scene); } catch (e) { console.warn('[VRM] combineSkeletons failed (ok):', e); }
        // rotateVRM0 intentionally omitted — teach.vrm is already oriented toward the camera.

        const ENV_NAMES = /floor|stage|desk|chair|table|wall|ceiling|prop|room|env|ground|platform/i;
        let meshCount = 0, skinnedCount = 0;
        vrmModel.scene.traverse((o) => {
          o.frustumCulled = false;
          const sm = o as THREE.SkinnedMesh;
          if ((o as THREE.Mesh).isMesh) {
            meshCount++;
            (o as THREE.Mesh).frustumCulled = false;
            if (sm.isSkinnedMesh) {
              skinnedCount++;
              (o as THREE.Mesh).visible = true;
            } else if (ENV_NAMES.test(o.name)) {
              (o as THREE.Mesh).visible = false;
            }
          }
        });
        console.log(`%c[VRM] ✅ SCENE READY  meshCount=${meshCount}  skinnedMeshes=${skinnedCount}`, 'color:lime;font-weight:bold');

        if (process.env.NODE_ENV === 'development') {
          const hb = vrmModel.humanoid;
          if (hb) {
            const boneReport = Object.keys(VRM_BONE_LABELS_AR)
              .map(bName => {
                const node = hb.getRawBoneNode(bName as never);
                return node ? `  ✅ ${VRM_BONE_LABELS_AR[bName]} → "${node.name}"` : null;
              })
              .filter(Boolean)
              .join('\n');
            console.log('%c[أفاتار] 🦴 خريطة العظام الكاملة:', 'color:#a5d6a7;font-weight:bold', `\n${boneReport}`);
          }
        }
        vrmRef.current = vrmModel;
        setVrm(vrmModel);
        onLoad?.();

        try {
          mixerRef.current = new THREE.AnimationMixer(vrmModel.scene);
          emotionManagerRef.current = new EmotionManager(vrmModel, mixerRef.current);
          phonemeManagerRef.current = new PhonemeManager(vrmModel);
          waveUntilRef.current = Date.now() + WAVE_DURATION * 1000;
          console.log('[VRM] managers ready — Emotion ✅  Phoneme ✅  expressionMgr:', !!vrmModel.expressionManager);
        } catch (managerErr) {
          console.warn('[VRM] manager init failed (non-fatal — avatar still renders):', managerErr);
        }
      },
      undefined,
      (error) => {
        if (cancelled) return;
        console.warn = origWarn;
        const msg = (error as Error)?.message || 'VRM network error';
        console.warn('[VRMAvatar] Failed to fetch VRM file:', msg, '— URL was:', vrmUrl);
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
    phonemeManagerRef.current?.stop();
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

  const doSpeak = useCallback((rawText: string) => {
    if (!rawText?.trim()) return;

    const { dialogue: cleanDialogue, emotion: parsedEmotion, action } = parseVeronaResponse(rawText);
    const text = cleanDialogue || rawText;

    if (action) dispatchGestureFromActionText(action);

    const plan = inferResponsePlan(text);
    emotionRef.current = parsedEmotion !== 'neutral' ? parsedEmotion : plan.emotion;
    postureLeanRef.current = plan.posture.lean === 'listen' ? 0.03 : plan.posture.lean === 'emphasize' ? -0.02 : 0;
    console.log('[V29] 💬 doSpeak → emotion:', emotionRef.current, '| text:', text.slice(0, 60));
    emotionManagerRef.current?.setEmotion(emotionRef.current);
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
    const ttsOnStart = () => {
      isTalkingRef.current = true;
      talkStartRef.current = 0;
      if (!timingsRef.current?.length) phonemeManagerRef.current?.startProcedural();
    };
    speakWithTTS(text, { onStart: ttsOnStart, onEnd: onSpeakEnd }).then((ok) => {
      if (!ok) {
        const started = fallbackSpeakWebSpeech(text, ttsOnStart, onSpeakEnd);
        if (!started) {
          ttsOnStart();
          const est = Math.max(2000, text.length * 60);
          setTimeout(onSpeakEnd, est);
        }
      }
    });
  }, [onSpeakEnd]);

  useEffect(() => {
    onSpeakReady?.(doSpeak);
  }, [onSpeakReady, doSpeak]);

  useEffect(() => {
    const handleStopSpeaking = () => {
      stopTTS();
      onSpeakEnd();
    };
    window.addEventListener('avatar:stopSpeaking', handleStopSpeaking);
    return () => window.removeEventListener('avatar:stopSpeaking', handleStopSpeaking);
  }, [onSpeakEnd]);

  useEffect(() => {
    if (typeof window === 'undefined' || !vrm) return;
    const avatarDebug = {
      get emotionManager() { return emotionManagerRef.current; },
      get phonemeManager() { return phonemeManagerRef.current; },
      get vrm() { return vrmRef.current; },
      get emotion() { return emotionRef.current; },
      get isTalking() { return isTalkingRef.current; },
      get mixer() { return mixerRef.current; },
      testEmotion: (e: string) => {
        console.log('[V29] 🧪 testEmotion:', e);
        window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion: e } }));
      },
      testSpeak: (t: string) => {
        console.log('[V29] 🧪 testSpeak:', t.slice(0, 50));
        window.dispatchEvent(new CustomEvent('avatar:speak', { detail: { text: t } }));
      },
      testWalk: (on = true) => {
        console.log('[V29] 🧪 testWalk:', on);
        window.dispatchEvent(new CustomEvent(on ? 'avatar:walk' : 'avatar:stop', { detail: { isWalking: on } }));
      },
      getAllBones: () => {
        const bones: string[] = [];
        vrmRef.current?.scene.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (m.skeleton) m.skeleton.bones.forEach((b) => bones.push(b.name));
        });
        return bones;
      },
    };
    (window as unknown as Record<string, unknown>).__avatarDebug = avatarDebug;
    console.log('[V29] 🔧 window.__avatarDebug ready. Try:\n  __avatarDebug.testEmotion("happy")\n  __avatarDebug.testEmotion("excited")\n  __avatarDebug.testSpeak("مرحباً!")\n  __avatarDebug.testWalk()\n  __avatarDebug.getAllBones()');
  }, [vrm]);

  const { pointer, camera } = useThree();
  const lookAtTargetRef = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    frameCounterRef.current += 1;
    if (frameCounterRef.current % 300 === 1) {
      console.log(
        '%c[V30] 🔄 useFrame alive', 'color:orange',
        '| frame:', frameCounterRef.current,
        '| vrm:', !!vrmRef.current,
        '| mixer:', !!mixerRef.current,
        '| emotionMgr:', !!emotionManagerRef.current,
        '| phonemeMgr:', !!phonemeManagerRef.current,
        '| isTalking:', isTalkingRef.current,
        '| isWalking:', activeWalkRef.current?.isWalking,
      );
    }
    if (mixerRef.current) mixerRef.current.update(delta);
    const currentVrm = vrmRef.current;
    if (currentVrm) {
      const lookAt = (currentVrm as { lookAt?: { autoUpdate?: boolean; lookAt: (p: THREE.Vector3) => void } }).lookAt;
      if (lookAt) {
        lookAt.autoUpdate = false;
        lookAtTargetRef.current.set(pointer.x, pointer.y, 0.4).unproject(camera);
        lookAt.lookAt(lookAtTargetRef.current);
      }
      currentVrm.update(delta);

      phonemeManagerRef.current?.update(delta, isTalkingRef.current);

      const ws = activeWalkRef.current;
      if (ws?.isWalking) {
        ws.walkPhase = ((ws.walkPhase ?? 0) + delta * 4) % (Math.PI * 2);
      }

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
      position={[0, 0, 0]}
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
      <primitive object={vrm.scene} />
    </group>
  ) : null;
}

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

export interface BoardroomAvatarProps {
  vrmUrl?: string;
  scale?: number;
  onLoad?: () => void;
  onError?: (err: string) => void;
  useSimpleFallback?: boolean;
  walkStateRef?: React.RefObject<{ isWalking: boolean; walkPhase: number } | null>;
  height?: string;
  showChat?: boolean;
}

const VRMAvatarInner = forwardRef<VRMAvatarRef, BoardroomAvatarProps>(function VRMAvatarInner(
  { vrmUrl = VRM_URL, scale = 1, onLoad, onError, useSimpleFallback = false, walkStateRef },
  ref
) {
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { setLoadError(null); }, [vrmUrl]);
  const speakFnRef = useRef<((text: string) => void) | null>(null);
  const humRef = useRef<Howl | null>(null);
  const humResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emotionRef = useRef<string>('neutral');
  const emotionManagerRef = useRef<{ setEmotion: (e: string) => void } | null>(null);

  useImperativeHandle(ref, () => ({
    speak: (text: string) => {
      if (speakFnRef.current) speakFnRef.current(text);
      else fallbackSpeakWebSpeech(text);
    },
    setEmotion: (emotion: string) => {
      emotionRef.current = emotion;
      emotionManagerRef.current?.setEmotion(emotion);
      window.dispatchEvent(new CustomEvent('avatar:emotion', { detail: { emotion } }));
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
      <Float speed={1.5} rotationIntensity={0} floatIntensity={0.08} floatingRange={[-0.04, 0.04]}>
        <group scale={scale}>
          <SimpleAvatarPlaceholder />
        </group>
      </Float>
    );
  }

  return (
    <group>
      <group scale={scale}>
        <VRMModel
          vrmUrl={vrmUrl}
          onLoad={onLoad}
          onError={handleError}
          onSpeakReady={handleSpeakReady}
          walkStateRef={walkStateRef}
        />
      </group>
    </group>
  );
});

export default VRMAvatarInner;