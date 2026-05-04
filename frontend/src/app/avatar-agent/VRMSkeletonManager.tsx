'use client';

import React, { type MutableRefObject, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { VRMA_TO_CANONICAL } from '@/constants/gestures';
import {
  ARM_IDLE,
  ARM_OFFSETS,
  GESTURE_OSCILLATIONS,
  composeArmTargets,
} from './armGestureReference';
import {
  sendArmForward,
  sendSemanticUpperArmToAvatar,
  sendToAvatarSemanticArm,
  sendUniversalBoneCommand,
} from './semanticCommand';
import { normalizeGenerativeBoneKey } from './generativeBoneNormalize';
import {
  KINEMATIC_GENERATIVE_LOCK_COLLISION,
  KINEMATIC_GENERATIVE_LOCK_GESTURE,
  KINEMATIC_GENERATIVE_LOCK_IDLE,
  KINEMATIC_GENERATIVE_LOCK_VRMA,
  KINEMATIC_GLOBAL_COLLISION_WHILE_GENERATIVE,
} from './kinematicStandards';
import {
  blendPoseLayers,
  applyFinalPoseToVrm,
  clonePoseMap,
  enforceAvatarRootStability,
  type BonePoseMap,
  type PerBonePoseBlendWeights,
} from './motion/PoseComposer';
import { expandGenerativeSuppressedKeys } from './motion/generativeProceduralMask';
import { clampGenerativeEulerYXZ } from './motion/jointEulerLimits';
import { runWithProceduralSuppression } from './motion/proceduralSuppressionContext';
import { applyPresenceFromEmbodiment } from './motion/presenceLayer';
import { applyIntentMotor } from './motion/intentMotorLayer';
import { applyMotionDriver } from './motion/motionDriver';
import { applyMicroHumanBehavior } from './motion/microHumanLayer';
import { applyIdleMicroPresence } from './motion/idleMicroPresence';
import {
  applyHumanizationLayer,
  applyAttentionSeekingLayer,
} from './motion/humanizationBoneApply';
import {
  applyBiomechanicalCorrections,
  applyIntentMotionState,
  applyNeuralLayer,
  applySubconsciousLayer,
  BONE_AXIS_MAP,
  setBoneAxisMap,
} from './motion/biomechanicalCorrectionLayer';
import { applyFingerMicroLayer } from './motion/fingerMicroLayer';
import { applyGazeIntentLayer } from './motion/gazeIntentLayer';
import { tickGestureTiming, getGestureTimingSnapshot } from './motion/gestureTiming';
import { detectIntent, detectIntentDetailed } from './motion/intentClassifier';
console.log('[FILE_IMPORTED] biomechanicalCorrectionLayer, fingerMicroLayer, gazeIntentLayer, gestureTiming, intentClassifier');
import { installVrmHumanoidBypassProbe } from '@/app/avatar-agent/motion/proceduralV2';
import {
  tickHumanization,
  shouldTriggerBlinkEdge,
  blinkDurationMsForEmotion,
  type HumanizationSnapshot,
} from '@/lib/avatar/humanizationController';
import { getCognitiveGestureAmplitudeScale } from '@/lib/avatar/consciousStateManager';
import {
  getPerceptionStrangerGestureMul,
  getPerceptionAttentionSeekingStrength,
} from '@/store/usePerceptionStore';
import { readAnalyserRms01 } from '@/lib/audio/audioEnergyExtractor';
import { getGlobalFrame } from '@/app/avatar-agent/behavior/GlobalMindStore';
import { tickUnifiedEnergy, getSmoothedUnifiedEnergy } from '@/lib/avatar/unifiedEnergyModel';
import { patchSpeechEmotionEnergy } from '@/ai/voice/speechEmotionBridge';
import { applyProceduralVrmaLifeOverlay } from './motion/proceduralVrmaLifeOverlay';
import { applyCinematicMicroLayer } from './motion/cinematicMicroLayer';
import {
  AVATAR_DEBUG,
  AVATAR_SAFE_MODE,
  safeCall,
  assertOrLog,
  getErrorCount,
  getHealthScore,
  errorState,
  tickSelfHealing,
} from './motion/__avatarErrorTracker';
import { sniper, activateSniper, deactivateSniper } from './motion/__errorSniper';
import { blendPoseInto, generateIntentPose } from './motion/intentPoseGenerator';
import { updateIntentFromBehaviorBrain } from '@/lib/avatar/motionIntentContinuity';
import { deriveEmbodimentFromLLM, getCognitiveOrchestratorInputOverlay } from '@/lib/ai/cognitiveOrchestrator';
import { getEmbodimentState, updateEmbodimentState } from '@/lib/avatar/embodimentState';
import { motionDriver } from '@/lib/avatar/MotionDriver';
import { getSpeechDriveSnapshot } from '@/lib/avatar/speechDriveState';
import { getCogniPersonaPerformanceScales } from '@/lib/avatar/cogniPersonaStance';
import {
  isAvatarMotionTraceOn,
  motionTraceLog,
  motionTraceStopAtGuard,
} from '@/lib/avatar/avatarMotionTrace';
import {
  deriveSpeechSemanticHints,
  getEmbodimentUtteranceTextForSemantics,
  stepSmoothedSemanticHints,
} from '@/lib/avatar/speechSemanticHints';
import { avatarDebug, DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { getBlendedIntentPresentation } from '@/ai/avatar/brainState';
import { modulatePresentationForPersonality } from '@/ai/avatar/personalityProfile';
import { getMoodMotionScale } from '@/ai/avatar/responsePersonality';
import { getBreathEmotionRateMul } from '@/ai/avatar/microExpressionLayer';
import { useBrainStore } from '@/store/useBrainStore';
import { AVATAR_BEHAVIOR_SINGLE_CONTROLLER } from '@/config/avatar';
import { nowMs as masterClockNowMs, sessionElapsedSec } from '@/lib/avatar/masterClock';
import { recordActivity } from '@/lib/avatar/motionDiagnostics';
import { isDebugMotion, logDebug, logDebugThrottledCallback } from '@/lib/logging/runtimeLog';
import {
  attachMotionPipelineEventProbes,
  logMotionPipelineFrame,
  MOTION_PIPELINE_DEBUG,
  readLipSyncProbeFromWindow,
  readStabilizeMixFromWindow,
} from '@/app/avatar-agent/motion/motionPipelineDebug';
import { getBehaviorMotionState } from '@/lib/behavior/behaviorMotionBrain';
import { isVrmaPlaybackGloballyDisabled, isProceduralOnlyMotion } from '@/lib/avatar/vrmaPlaybackPolicy';
import {
  initStudentAwarenessListeners,
  tickAwareness,
} from '@/lib/avatar/awareness/studentAwarenessEngine';
import { assertNoVrmaLeak } from '@/lib/avatar/motionAuthority';

const _VRMA_IDENTITY_REF = new THREE.Quaternion(0, 0, 0, 1);

function quatLooksLikeNormalizedBindPose(q: THREE.Quaternion): boolean {
  return Math.abs(q.dot(_VRMA_IDENTITY_REF)) > 0.9995;
}

/**
 * Untracked VRMA joints often sample as identity (= model T-pose in normalized space).
 * If bind rest differs, blending that sample pulls arms to T-pose — strip so fallback/bind+idle win.
 */
function stripVrmaGhostArmIdentitySamples(src: BonePoseMap, bind: BonePoseMap): BonePoseMap {
  if (src.size === 0) return src;
  const armShort = ['rua', 'lua', 'rla', 'lla'] as const;
  let removeAny = false;
  for (const k of armShort) {
    const q = src.get(k);
    const b = bind.get(k);
    if (!q || !b) continue;
    if (quatLooksLikeNormalizedBindPose(q) && !quatLooksLikeNormalizedBindPose(b)) {
      removeAny = true;
      break;
    }
  }
  if (!removeAny) return src;
  const out = clonePoseMap(src);
  for (const k of armShort) {
    const q = out.get(k);
    const b = bind.get(k);
    if (!q || !b) continue;
    if (quatLooksLikeNormalizedBindPose(q) && !quatLooksLikeNormalizedBindPose(b)) {
      out.delete(k);
    }
  }
  return out;
}

const EMPTY_BONE_POSE: BonePoseMap = new Map();

const TAB_SAFE_MAX_DELTA = 0.1;

/** TEMP (debug): VRMA-only — procedural idle/breath/gesture/collision layers off; bind + VRMA pose only. Keep false for normal motion + floor lock. */
const VRMA_ISOLATION_TEST = false;

/** TEMP (debug): skip vrm.update + disable lookAt auto + spring bones. Keep false so humanoid/expressions/spring bones update. */
const VRM_HARD_ISOLATION = false;

/** Extra console logging for arm-fallback / VRMA blend keys (off unless `NEXT_PUBLIC_DEBUG_MOTION` or legacy `DEBUG_MOTION_DIAG`). */
/** Re-enable periodic / failsafe `avatar:micro:gesture` nods during VRMA (default: off). */
const VRMA_IDLE_MICRO_INJECT = process.env.NEXT_PUBLIC_VRMA_IDLE_MICRO_INJECT === 'true';

/**
 * One-shot rightUpperArm local axis calibration (opt-in only).
 * Set `NEXT_PUBLIC_DEBUG_LOCAL_AXIS_CALIB=true` — 3s: +0.5 rad local X, then Y, then Z on bind.
 * Does not change default runtime when env is unset/false.
 */
const RUN_LOCAL_AXIS_CALIBRATION =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_DEBUG_LOCAL_AXIS_CALIB === 'true';
const LOCAL_AXIS_CALIB_RAD = 0.5;
const LOCAL_AXIS_CALIB_DURATION_MS = 3000;

const _LOCAL_AXIS_VX = new THREE.Vector3(1, 0, 0);
const _LOCAL_AXIS_VY = new THREE.Vector3(0, 1, 0);
const _LOCAL_AXIS_VZ = new THREE.Vector3(0, 0, 1);
const _LOCAL_AXIS_QDELTA = new THREE.Quaternion();
const _LOCAL_AXIS_QOUT = new THREE.Quaternion();

// ═══════════════════════════════════════════════════════════════════════════
//  AVATURN SAFE CLAMP — حدود دوران آمنة لنماذج VRM 1.0 (مثل Avaturn).
//  تمنع دخول الرأس في الجسم عند حسابات الـ Euler المتراكمة.
//  جميع القيم بالراديان.
// ═══════════════════════════════════════════════════════════════════════════
const NECK_CLAMP_X  = 0.78;  // انحناء رقبة أمام/خلف   (≈ 45°)
const NECK_CLAMP_Y  = 0.95;  // دوران رقبة يمين/يسار   (≈ 54°)
const NECK_CLAMP_Z  = 0.45;  // ميل رقبة جانبي         (≈ 26°)
const HEAD_CLAMP_X  = 0.72;  // انحناء رأس أمام/خلف    (≈ 41°)
const HEAD_CLAMP_Y  = 0.80;  // دوران رأس يمين/يسار    (≈ 46°)
const HEAD_CLAMP_Z  = 0.40;  // ميل رأس جانبي          (≈ 23°)
/** تُطبَّق قبيل SK_E.set لضمان قيم آمنة على أي نموذج VRM */
function clampNeckEuler(x: number, y: number, z: number): [number, number, number] {
  return [
    THREE.MathUtils.clamp(x, -NECK_CLAMP_X, NECK_CLAMP_X),
    THREE.MathUtils.clamp(y, -NECK_CLAMP_Y, NECK_CLAMP_Y),
    THREE.MathUtils.clamp(z, -NECK_CLAMP_Z, NECK_CLAMP_Z),
  ];
}
function clampHeadEuler(x: number, y: number, z: number): [number, number, number] {
  return [
    THREE.MathUtils.clamp(x, -HEAD_CLAMP_X, HEAD_CLAMP_X),
    THREE.MathUtils.clamp(y, -HEAD_CLAMP_Y, HEAD_CLAMP_Y),
    THREE.MathUtils.clamp(z, -HEAD_CLAMP_Z, HEAD_CLAMP_Z),
  ];
}

const SK_E = new THREE.Euler();
const SK_Q = new THREE.Quaternion();
const SK_Q2 = new THREE.Quaternion();
const GEN_E = new THREE.Euler();
const GEN_Q = new THREE.Quaternion();
const SK_AXIS_X = new THREE.Vector3(1, 0, 0);
/** Scratch: eye-contact head bias from camera direction (XZ plane). */
const _EC_HIP = new THREE.Vector3();
const _EC_TO_CAM = new THREE.Vector3();
const _EC_FWD = new THREE.Vector3();
const _EYE_HEAD_WORLD = new THREE.Vector3();
/** Dev-only: read back bone orientation after idle slerp (YXZ). */
const IDLE_APPLIED_E = new THREE.Euler();

// ═══════════════════════════════════════════════════════════════════════════
//  HAND-BODY COLLISION GUARD — يمنع تداخل اليدين مع جذع الجسم (صدر/بطن).
//
//  المبدأ: بعد تطبيق دوران عظام الذراعين، نقرأ المواضع العالمية لليدين
//  وللصدر من الإطار السابق (تأخير إطار واحد = 16 ms — غير ملحوظ مع slerp).
//  إذا كانت اليد داخل نصف قطر الجسم، نُضيف دوراناً تصحيحياً فورياً
//  للذراع العلوي (RUA/LUA Z) يدفعها للخارج.
//
//  ضبط الحساسية: عدّل الثوابت أدناه فقط.
// ═══════════════════════════════════════════════════════════════════════════

/** نصف قطر الجذع التقريبي (متر). اليدان أقرب منه = تصحيح فوري. */
const BODY_COLLISION_RADIUS        = 0.16;
/** مسافة إضافية (هامش أمان) تُضاف فوق نصف القطر قبل التصحيح. */
const HAND_BODY_SAFETY_MARGIN      = 0.03;
/** قوة الدفع الخارجي: تُضرب في عمق الاختراق → مقدار دوران تصحيحي (rad). */
const HAND_BODY_PUSH_STRENGTH      = 6.0;
/** سرعة slerp للتصحيح (لا تجعله أسرع من arm slerp لتجنب الاهتزاز). */
const COLLISION_SLERP_SPEED        = 10.0;
/** الحد الأدنى لقيمة gBlend لتفعيل الفحص (إيماءة نشطة = > 0.05). */
const COLLISION_MIN_GBLEND         = 0.05;

/** Vectors مُخصَّصة خارج الـ hook لتجنّب GC pressure كل إطار. */
const _rHandWorld  = new THREE.Vector3();
const _lHandWorld  = new THREE.Vector3();
const _chestWorld  = new THREE.Vector3();
const _collPushRot = new THREE.Euler();
const _collPushQ   = new THREE.Quaternion();
const _collBaseQ   = new THREE.Quaternion(); // نسخة مؤقتة تحلّ محل .clone()

// ═══════════════════════════════════════════════════════════
// ★ NEW — Named constants for all gesture tuning values.
//          Tweak these freely; no need to hunt through code.
// ═══════════════════════════════════════════════════════════

// ─── Breathing ───────────────────────────────────────────
const BREATHE_SPEED_A      = 1.05;   // primary sine freq
const BREATHE_SPEED_B      = 2.35;   // secondary sine freq
const BREATHE_SPINE_AMP    = 0.042;
const BREATHE_CHEST_AMP    = 0.026;
const CHEST_PHASE_LAG_SEC  = 0.14;

// ─── Head micro-sway ────────────────────────────────────
const HEAD_NOISE_SPEED = 0.62;
/** حركة رأس/رقبة أوضح بعد إصلاح autoUpdateHumanBones (كانت تُلغى كل إطار). */
const HEAD_SWAY_AMP    = 0.045;
const NECK_SWAY_MUL    = 0.58;

// ═══════════════════════════════════════════════════════
// ★ SOURCE OF TRUTH — normalized rightUpperArm (YXZ) — see armGestureReference.ts
//   RIGHT: Forward = −X, Up = −Z, Down = +Z. Primary reach is NOT on Y.
//   LEFT:  Forward = +X (mirror); Z mirrors idle hang.
//   Generative / semantic arms: collision weight capped while overlay active (see useFrame).
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  IDLE pose — مرجع ثابت من armGestureReference.ts (كل إيماءة = idle + إزاحة)
// ═══════════════════════════════════════════════════════════════════════════════
// Arm axes YXZ: primary forward reach = ex (X); right forward is negative X.
// ey (Y) = secondary swing; ez (Z) = vertical (right +Z hang/down, −Z up).
const IDLE_RUA_X                 = ARM_IDLE.ruaX;
const IDLE_RUA_Y                 = ARM_IDLE.ruaY;
const IDLE_RUA_Z                 = ARM_IDLE.ruaZ;
const IDLE_LUA_X                 = ARM_IDLE.luaX;
const IDLE_LUA_Y                 = ARM_IDLE.luaY;
const IDLE_LUA_Z                 = ARM_IDLE.luaZ;
const IDLE_RLA_X                 = ARM_IDLE.rlaX;
const IDLE_RLA_Z                 = ARM_IDLE.rlaZ;
const IDLE_LLA_X                 = ARM_IDLE.llaX;
const IDLE_LLA_Z                 = ARM_IDLE.llaZ;

/**
 * FREEZE_IDLE_ANIMATIONS = true → disables breathing, head sway, wrist jitter.
 * Arms stay at exact ARM_IDLE pose — useful for pose calibration.
 * Set false to restore natural idle life.
 */
const FREEZE_IDLE_ANIMATIONS     = false;   // false = breathing + head sway active

/**
 * BLOCK_ALL_GESTURES = true → no avatar:gesture / VRMA-driven arm poses (right arm stays idle).
 * User will restore gestures later. Set false after recalibrating ARM_OFFSETS.
 */
const BLOCK_ALL_GESTURES         = false;

/**
 * تشخيص: `true` يعطّل بالكامل فرع idle الإجرائي (أذرع/رأس/أصابع) في useFrame.
 * إذا تحسّنت إيماءة أخرى بعد التفعيل → يشتبه بتداخل idle. الإفتراضي `false` للإنتاج.
 * غيّر محلياً إلى `true` ثم أعد التحميل للاختبار.
 */
const GESTURE_OVERRIDE_IDLE = false;

/** قرار طبقة الحركة الإجرائية قبل الكتابة على العظام — لا يُستبدل `gestureStateRef` بـ pseudo-idle عند VRMA. */
type ProceduralMotionSource = 'VRMA' | 'GESTURE' | 'IDLE';

/**
 * VRMA clips often omit arm tracks → identity samples drag the blend toward rig T-pose.
 * Fallback: **bind rest only** (no synthetic motion) — keeps arms at the model’s captured natural bind.
 */
/** DEBUG: throttle arm-fallback logs (ms, performance.now). */
let __vrmaArmDebugNextAt = 0;
/** DEBUG: throttle vrmaForBlend → blendPoseLayers logs. */
let __vrmaBlendInputLogNextAt = 0;

function mergeVrmaPoseWithArmFallback(
  motionSource: ProceduralMotionSource,
  vrmaLayerW: number,
  vrmaBonePose: BonePoseMap,
  bind: BonePoseMap,
): BonePoseMap {
  if (motionSource !== 'VRMA' || vrmaLayerW <= 1e-6) return vrmaBonePose;

  const hasRua =
    vrmaBonePose.has('rua') || vrmaBonePose.has('rightUpperArm');
  const hasLua =
    vrmaBonePose.has('lua') || vrmaBonePose.has('leftUpperArm');
  const hasRla =
    vrmaBonePose.has('rla') || vrmaBonePose.has('rightLowerArm');
  const hasLla =
    vrmaBonePose.has('lla') || vrmaBonePose.has('leftLowerArm');

  if (hasRua && hasLua && hasRla && hasLla) return vrmaBonePose;

  if (
    isDebugMotion() &&
    typeof process !== 'undefined' &&
    process.env.NODE_ENV === 'development' &&
    typeof performance !== 'undefined'
  ) {
    const now = masterClockNowMs();
    if (now >= __vrmaArmDebugNextAt) {
      __vrmaArmDebugNextAt = now + 900;
      // eslint-disable-next-line no-console -- DEBUG: arm-fallback path
      console.log('ARM FALLBACK → bind rest (no VRMA arm tracks)', vrmaBonePose.has('leftUpperArm'));
      // eslint-disable-next-line no-console -- DEBUG: Map has no enumerable string keys
      console.log('Object.keys(vrmaBonePose)', Object.keys(vrmaBonePose));
      // eslint-disable-next-line no-console -- DEBUG: actual Map keys from VRMA sample
      console.log('vrmaBonePose Map keys', [...vrmaBonePose.keys()]);
    }
  }

  const out = clonePoseMap(vrmaBonePose);
  if (!hasRua) {
    const bRua = bind.get('rua');
    if (bRua) out.set('rua', bRua.clone());
  }
  if (!hasLua) {
    const bLua = bind.get('lua');
    if (bLua) out.set('lua', bLua.clone());
  }
  if (!hasRla) {
    const bRla = bind.get('rla');
    if (bRla) out.set('rla', bRla.clone());
  }
  if (!hasLla) {
    const bLla = bind.get('lla');
    if (bLla) out.set('lla', bLla.clone());
  }
  return out;
}

const GESTURE_TO_IDLE_EASE_MS = 280;

const _ARM_EX                      = composeArmTargets(ARM_OFFSETS.explain);
// ═══════════════════════════════════════════════════════════════════════════════
//  EXPLAIN gesture — مطلق = idle + EXPLAIN_OFFSET_* (معرّف في ARM_OFFSETS.explain)
// ═══════════════════════════════════════════════════════════════════════════════
const EXPLAIN_RUA_X              = _ARM_EX.ruaX;
const EXPLAIN_RUA_Y              = _ARM_EX.ruaY;
const EXPLAIN_RUA_Z              = _ARM_EX.ruaZ;
const EXPLAIN_LUA_X              = _ARM_EX.luaX;
const EXPLAIN_LUA_Y              = _ARM_EX.luaY;
const EXPLAIN_LUA_Z              = _ARM_EX.luaZ;
const EXPLAIN_RLA_X              = _ARM_EX.rlaX;
const EXPLAIN_RLA_Z              = _ARM_EX.rlaZ;
const EXPLAIN_LLA_X              = _ARM_EX.llaX;
const EXPLAIN_LLA_Z              = _ARM_EX.llaZ;
const EXPLAIN_RH_X               = _ARM_EX.rhX;
const EXPLAIN_RH_Y               = _ARM_EX.rhY;
const EXPLAIN_RH_Z               = _ARM_EX.rhZ;
const EXPLAIN_LH_X               = _ARM_EX.lhX;
const EXPLAIN_LH_Y               = _ARM_EX.lhY;
const EXPLAIN_LH_Z               = _ARM_EX.lhZ;
/** 0 = مفتوح، 1 = قبضة — احتياطي عند `cal.fingerCurl` فقط */
const EXPLAIN_FINGER_CURL        =  0.45;
const EXPLAIN_R_FINGER_CURL      =  0.45;  // خُفِّف: 1.0→0.45 (يد مفتوحة نسبياً أثناء الشرح)
const EXPLAIN_L_FINGER_CURL      =  0.45;
const EXPLAIN_WAVE_FREQ          =  1.4;    // خُفِّف: 2.8→1.4 Hz لمنع إيحاء التصفيق
const EXPLAIN_WAVE_AMP           =  0.09;   // خُفِّف: 0.20→0.09 rad
const EXPLAIN_RUA_WAVE_X_MUL     =  0.4;
const EXPLAIN_LUA_WAVE_MUL       =  0.32;
const EXPLAIN_RLA_WAVE_MUL       =  0.2;
const EXPLAIN_LLA_WAVE_MUL       =  0.18;
const EXPLAIN_HIP_TILT_Z         =  0;  // off — keep hips neutral; breathing uses spine/chest only
const EXPLAIN_SHOULDER_LIFT      =  0.04;

const _ARM_PT                      = composeArmTargets(ARM_OFFSETS.point);
// ═══════════════════════════════════════════════════════════════════════════════
//  POINT gesture — idle + ARM_OFFSETS.point
// ═══════════════════════════════════════════════════════════════════════════════
const POINT_RUA_X                = _ARM_PT.ruaX;
const POINT_RUA_Y                = _ARM_PT.ruaY;
const POINT_RUA_Z                = _ARM_PT.ruaZ;
const POINT_LUA_X                = _ARM_PT.luaX;
const POINT_LUA_Y                = _ARM_PT.luaY;
const POINT_LUA_Z                = _ARM_PT.luaZ;
const POINT_RLA_X                = _ARM_PT.rlaX;
const POINT_RLA_Z                = _ARM_PT.rlaZ;
const POINT_LLA_X                = _ARM_PT.llaX;
const POINT_LLA_Z                = _ARM_PT.llaZ;
const POINT_RH_X                 = _ARM_PT.rhX;
const POINT_RH_Z                 = _ARM_PT.rhZ;
const POINT_MICRO_FREQ           =  5;
const POINT_MICRO_AMP            =  0.04;
const POINT_HIP_TILT_Z           =  0;

// ─── VRMA / إجرائي: مرجع المحاور armGestureReference.ts (يمين −X = أمام) ───

const _ARM_TH                      = composeArmTargets(ARM_OFFSETS.think);
// ═══════════════════════════════════════════════════════════════════════════════
//  THINK gesture — أذرع/معصم: idle + ARM_OFFSETS.think؛ بقية الجذع من VRMA
// ═══════════════════════════════════════════════════════════════════════════════
const THINK_RUA_X                  = _ARM_TH.ruaX;
const THINK_RUA_Y                  = _ARM_TH.ruaY;
const THINK_RUA_Z                  = _ARM_TH.ruaZ;
const THINK_LUA_X                  = _ARM_TH.luaX;
const THINK_LUA_Y                  = _ARM_TH.luaY;
const THINK_LUA_Z                  = _ARM_TH.luaZ;
const THINK_RLA_X                  = _ARM_TH.rlaX;
const THINK_RLA_Z                  = _ARM_TH.rlaZ;
const THINK_LLA_X                  = _ARM_TH.llaX;
const THINK_LLA_Z                  = _ARM_TH.llaZ;
const THINK_RH_X                   = _ARM_TH.rhX;
const THINK_RH_Y                   = _ARM_TH.rhY;
const THINK_RH_Z                   = _ARM_TH.rhZ;
const THINK_LH_X                   = _ARM_TH.lhX;
const THINK_LH_Y                   = _ARM_TH.lhY;
const THINK_LH_Z                   = _ARM_TH.lhZ;

// THINK body — ZEROED for VRM 1.0 clean slate. Recalibrate via motion-lab.
const THINK_RSHOULDER_X            =  0;
const THINK_RSHOULDER_Y            =  0;
const THINK_RSHOULDER_Z            =  0;

const THINK_LSHOULDER_X            =  0;
const THINK_LSHOULDER_Y            =  0;
const THINK_LSHOULDER_Z            =  0;

const THINK_NECK_X                 =  0;
const THINK_NECK_Y                 =  0;
const THINK_NECK_Z                 =  0;

const THINK_HEAD_X                 =  0;
const THINK_HEAD_Y                 =  0;
const THINK_HEAD_Z                 =  0;

const THINK_HIPS_X                 =  0;
const THINK_HIPS_Y                 =  0;
const THINK_HIPS_Z                 =  0;

const THINK_SPINE_X                =  0;
const THINK_SPINE_Y                =  0;
const THINK_SPINE_Z                =  0;

const THINK_CHEST_X                =  0;
const THINK_CHEST_Y                =  0;
const THINK_CHEST_Z                =  0;

const THINK_MICRO_FREQ             =  1.15;
const THINK_MICRO_AMP              =  0.04;
const THINK_RLA_MICRO_MUL          =  0.4;

const _ARM_WV                      = composeArmTargets(ARM_OFFSETS.wave);
// ═══════════════════════════════════════════════════════════════════════════════
//  WAVING gesture — idle + ARM_OFFSETS.wave (أذرع/معصم)
// ═══════════════════════════════════════════════════════════════════════════════
const WAVING_RUA_X                 = _ARM_WV.ruaX;
const WAVING_RUA_Y                 = _ARM_WV.ruaY;
const WAVING_RUA_Z                 = _ARM_WV.ruaZ;
const WAVING_LUA_X                 = _ARM_WV.luaX;
const WAVING_LUA_Y                 = _ARM_WV.luaY;
const WAVING_LUA_Z                 = _ARM_WV.luaZ;
const WAVING_RLA_X                 = _ARM_WV.rlaX;
const WAVING_RLA_Z                 = _ARM_WV.rlaZ;
const WAVING_LLA_X                 = _ARM_WV.llaX;
const WAVING_LLA_Z                 = _ARM_WV.llaZ;
const WAVING_RH_X                  = _ARM_WV.rhX;
const WAVING_RH_Y                  = _ARM_WV.rhY;
const WAVING_RH_Z                  = _ARM_WV.rhZ;
const WAVING_LH_X                  = _ARM_WV.lhX;
const WAVING_LH_Y                  = _ARM_WV.lhY;
const WAVING_LH_Z                  = _ARM_WV.lhZ;

// WAVE body — ZEROED for VRM 1.0 clean slate. Recalibrate via motion-lab.
const WAVING_RSHOULDER_X           =  0;
const WAVING_RSHOULDER_Y           =  0;
const WAVING_RSHOULDER_Z           =  0;

const WAVING_LSHOULDER_X           =  0;
const WAVING_LSHOULDER_Y           =  0;
const WAVING_LSHOULDER_Z           =  0;

const WAVING_NECK_X                =  0;
const WAVING_NECK_Y                =  0;
const WAVING_NECK_Z                =  0;

const WAVING_HEAD_X                =  0;
const WAVING_HEAD_Y                =  0;
const WAVING_HEAD_Z                =  0;

const WAVING_HIPS_X                =  0;
const WAVING_HIPS_Y                =  0;
const WAVING_HIPS_Z                =  0;

const WAVING_SPINE_X               =  0;
const WAVING_SPINE_Y               =  0;
const WAVING_SPINE_Z               =  0;

const WAVING_CHEST_X               =  0;
const WAVING_CHEST_Y               =  0;
const WAVING_CHEST_Z               =  0;

const WAVING_MICRO_FREQ            =  2.5;
const WAVING_MICRO_AMP             =  0.08;

const _ARM_CL                      = composeArmTargets(ARM_OFFSETS.clap);
// ═══════════════════════════════════════════════════════════════════════════════
//  CLAPPING — رأس/رقبة/كتف من VRMA؛ أذرع فرع clap = idle + ARM_OFFSETS.clap
// ═══════════════════════════════════════════════════════════════════════════════

// CLAP body — ZEROED for VRM 1.0 clean slate. Recalibrate via motion-lab.
const CLAPPING_RSHOULDER_X         =  0;
const CLAPPING_RSHOULDER_Y         =  0;
const CLAPPING_RSHOULDER_Z         =  0;

const CLAPPING_LSHOULDER_X         =  0;
const CLAPPING_LSHOULDER_Y         =  0;
const CLAPPING_LSHOULDER_Z         =  0;

const CLAPPING_NECK_X              =  0;
const CLAPPING_NECK_Y              =  0;
const CLAPPING_NECK_Z              =  0;

const CLAPPING_HEAD_X              =  0;
const CLAPPING_HEAD_Y              =  0;
const CLAPPING_HEAD_Z              =  0;

const CLAPPING_HIPS_X              =  0;
const CLAPPING_HIPS_Y              =  0;
const CLAPPING_HIPS_Z              =  0;

const CLAPPING_SPINE_X             =  0;
const CLAPPING_SPINE_Y             =  0;
const CLAPPING_SPINE_Z             =  0;

const CLAPPING_CHEST_X             =  0;
const CLAPPING_CHEST_Y             =  0;
const CLAPPING_CHEST_Z             =  0;

const CLAPPING_MICRO_FREQ          =  3.0;
const CLAPPING_MICRO_AMP           =  0.06;

const _ARM_AG                      = composeArmTargets(ARM_OFFSETS.agree);
// ═══════════════════════════════════════════════════════════════════════════════
//  AGREEING gesture — idle + ARM_OFFSETS.agree (أذرع/معصم)
// ═══════════════════════════════════════════════════════════════════════════════
const AGREEING_RUA_X               = _ARM_AG.ruaX;
const AGREEING_RUA_Y               = _ARM_AG.ruaY;
const AGREEING_RUA_Z               = _ARM_AG.ruaZ;
const AGREEING_LUA_X               = _ARM_AG.luaX;
const AGREEING_LUA_Y               = _ARM_AG.luaY;
const AGREEING_LUA_Z               = _ARM_AG.luaZ;
const AGREEING_RLA_X               = _ARM_AG.rlaX;
const AGREEING_RLA_Z               = _ARM_AG.rlaZ;
const AGREEING_LLA_X               = _ARM_AG.llaX;
const AGREEING_LLA_Z               = _ARM_AG.llaZ;
const AGREEING_RH_X                = _ARM_AG.rhX;
const AGREEING_RH_Y                = _ARM_AG.rhY;
const AGREEING_RH_Z                = _ARM_AG.rhZ;
const AGREEING_LH_X                = _ARM_AG.lhX;
const AGREEING_LH_Y                = _ARM_AG.lhY;
const AGREEING_LH_Z                = _ARM_AG.lhZ;

// AGREE body — ZEROED for VRM 1.0 clean slate. Recalibrate via motion-lab.
const AGREEING_RSHOULDER_X         =  0;
const AGREEING_RSHOULDER_Y         =  0;
const AGREEING_RSHOULDER_Z         =  0;

const AGREEING_LSHOULDER_X         =  0;
const AGREEING_LSHOULDER_Y         =  0;
const AGREEING_LSHOULDER_Z         =  0;

const AGREEING_NECK_X              =  0;
const AGREEING_NECK_Y              =  0;
const AGREEING_NECK_Z              =  0;

const AGREEING_HEAD_X              =  0;
const AGREEING_HEAD_Y              =  0;
const AGREEING_HEAD_Z              =  0;

const AGREEING_HIPS_X              =  0;
const AGREEING_HIPS_Y              =  0;
const AGREEING_HIPS_Z              =  0;

const AGREEING_SPINE_X             =  0;
const AGREEING_SPINE_Y             =  0;
const AGREEING_SPINE_Z             =  0;

const AGREEING_CHEST_X             =  0;
const AGREEING_CHEST_Y             =  0;
const AGREEING_CHEST_Z             =  0;

const _ARM_TE                      = composeArmTargets(ARM_OFFSETS.test_elbow);
// ═══════════════════════════════════════════════════════════════════════════════
//  TEST_ELBOW — تشخيص ثني الكوع / لف الساعد (ARM_OFFSETS.test_elbow)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Aliases (names referenced in gesture state machine; values match blocks above) ───
const POINT_ARM_EXTEND_X = POINT_RUA_X;
const POINT_ARM_EXTEND_Y = POINT_RUA_Y;
const POINT_ARM_EXTEND_Z = POINT_RUA_Z;
const IDLE_LOWER_ARM_X = IDLE_RLA_X;

// ─── Finger curl constants ──────────────────────────────
// ★ NEW — micro-finger movements (subtle curl / open palm)
const FINGER_CURL_POINT       = 0.45;  // curl for index finger during point
const FINGER_CURL_OTHERS_POINT = 0.85; // other fingers curled tight during point
const FINGER_OPEN_EXPLAIN     = -0.08; // slight extension for open palm in explain
const FINGER_CURL_THINK       = 0.35;  // light fist near chin during think
const FINGER_SLERP_SPEED      = 6;     // how fast fingers blend
/** 0–1 → نفس مقياس explain قبل lerp(FINGER_OPEN_EXPLAIN, 0.65, ·) */
const FINGER_CURL_WAVE        = 0.14;
const FINGER_CURL_CLAP        = 0.48;
/** agree: كفان مفتوحتان (0 = بسط في مقياس explain) */
const AGREE_FINGER_CURL_R      = 0.0;
const AGREE_FINGER_CURL_L      = 0.0;

// ─── Talk nudge (idle micro-gestures while speaking) ────
const TALK_NUDGE_FREQ      = 6.2;
const TALK_NUDGE_AMP       = 0.045;
const TALK_WRIST_FREQ      = 5.1;
const TALK_WRIST_AMP       = 0.06;
const TALK_WRIST_PHASE     = 0.4;

// ─── Gesture transition timing ──────────────────────────
const GESTURE_FADE_IN_END  = 0.18;
const GESTURE_FADE_OUT_START = 0.72;
/** يضرب سرعة slerp للذراع/الساعد أثناء الإيماءات الإجرائية (ليس idle) — أعلى = وصول أسرع للهدف (~0.1–0.2s). */
const GESTURE_ARM_SLERP_GAIN = 2.45;
/**
 * 0–1: أقرب إلى 1 = انتقال أسرع نحو هدف الإيماءة في slerpArmEuler (إيماءات غير idle فقط).
 * يُحوَّل إلى معزّز مضروب في خطوة الـ slerp؛ لا تستخدم 1.0 حرفياً (تجنّب القسمة على صفر).
 */
const GESTURE_TRANSITION_SPEED = 0.92;

// ─── INTENT CURVE — 4-phase human gesture structure ────────────────────────
//
//  BEFORE (linear): progress 0→1 uniformly controls blend
//  AFTER  (intent): 4 distinct phases with unique blend & slerp characteristics
//
//  Phase 0 | PREPARATION | 0.00 → 0.20 | limb starts moving at 20% amplitude
//  Phase 1 | ATTACK      | 0.20 → 0.50 | fast reach to peak (110% overshoot)
//  Phase 2 | HOLD        | 0.50 → 0.75 | plateau with micro-oscillation ±5%
//  Phase 3 | DECAY       | 0.75 → 1.00 | slow organic return to idle
//
// These thresholds are normalised progress values (0–1 over gesture duration).
const INTENT_PREP_END    = 0.20;  // end of preparation phase
const INTENT_ATTACK_END  = 0.50;  // end of attack phase (peak reached)
const INTENT_HOLD_END    = 0.75;  // end of hold phase (decay begins)
// Blend targets per phase (as fraction of full gesture amplitude)
const INTENT_PREP_BLEND  = 0.22;  // pre-impulse: 22% of target
const INTENT_PEAK_BLEND  = 1.08;  // attack overshoot: 108% (felt not seen)
// slerp speed multipliers per phase (applied on top of FIX-1 base speed)
const INTENT_SLERP_PREP  = 1.05; // was 0.45 — prep no longer crawls; wave lifts quickly
const INTENT_SLERP_ATTACK = 3.05; // was 2.2 — faster reach to peak
const INTENT_SLERP_HOLD  = 0.88; // was 0.65 — slightly snappier hold tracking
const INTENT_SLERP_DECAY = 0.52; // was 0.38 — decay still soft but not sluggish
// Hold micro-oscillation: simulates sustained muscle activation at peak
const INTENT_HOLD_OSC_AMP  = 0.048; // ±4.8% of target amplitude
const INTENT_HOLD_OSC_FREQ = 6.5;   // Hz — subtle but visible

/** بعد تغيّر الإيماءة: يبطّئ معدلات slerp ثم يعود للكامل (يقلّل القفزات). أقصر = استجابة أسرع. */
const GESTURE_CROSSFADE_MS = 160;

/** تبديل وضعية idle كل 8–12 ثانية تقريباً */
const IDLE_VARIANT_INTERVAL_MIN = 8000;
const IDLE_VARIANT_INTERVAL_MAX = 12000;

// ─── Anticipation / follow-through (حركة أكثر طبيعية) ─────────────────────
/** أول ~9% من مدة الإيماءة: سحب خفيف نحو وضع «قبل الانطلاق» */
const GESTURE_ANT_FRAC = 0.09;
/** آخر ~14%: نبضة متابعة (زيادة خفيفة ثم ذوبان مع fadeOut) */
const GESTURE_FOLLOW_FRAC = 0.14;
// Wind-up along +X (slightly backward) before reach on −X (forward).
const ANT_RUA_X_EXPLAIN = 0.28;
const ANT_RUA_X_POINT   = 0.38;
const ANT_RUA_X_THINK   = 0.45;
/** كتف أيمن: رفع عكسي خفيف أثناء التوقّع ثم يختفي */
const ANT_SHOULDER_R_EXPLAIN = -0.022;
const ANT_SHOULDER_R_THINK = -0.028;
/** ورك: ميل معاكس خفيف جداً أثناء التوقّع */
const ANT_HIP_Z_POINT = 0;
const ANT_HIP_Z_EXPLAIN = 0;
/** تضخيم مؤقت لـ gBlend على الذراعين/الموجات في نافذة المتابعة */
const FOLLOW_ARM_BLEND_BUMP = 0.11;

// ─── Biomechanics Enhancement Layer ─────────────────────────────────────────
// Organic motion: blend sine wave with simplex-noise for non-repeating feel
const BIO_ORG_SINE        = 0.62;   // weight of deterministic sine component
const BIO_ORG_NOISE       = 0.38;   // weight of simplex noise overlay
const BIO_ORG_NOISE_SPD   = 0.71;   // noise time scale (slow → organic feel)
// Micro-jitter: constant low-amplitude noise on extremities (life signal)
const BIO_JITTER_WRIST    = 0.0085; // wrist micro-jitter amplitude (radians)
const BIO_JITTER_FREQ     = 5.5;    // jitter frequency
// Gravity droop: raised arm has slight downward bias during gestures
const BIO_GRAVITY_DROOP   = 0.036;  // droop added to Z when arm extended
// Anticipation ease-out curve power (< 1 = fast attack, slow release)
const BIO_ANT_CURVE_POW   = 0.58;
// Follow-through overshoot amplitude (stacks on top of FOLLOW_ARM_BLEND_BUMP)
const BIO_FOLLOW_OVERSHOOT = 0.054;
// Breathing → shoulder coupling
const BIO_BREATHE_SHLDR   = 0.016;  // shoulder Y lift per unit of breath
const BIO_BREATHE_ARM     = 0.005;  // idle arm Z drift per unit of breath
// Eye saccade: slow, subtle gaze shifts (idle only) — every 5–10 s
const BIO_SACCADE_IVAL_MIN = 5000;
const BIO_SACCADE_IVAL_MAX = 10_000;
const BIO_SACCADE_AMP      = 0.011;
const BIO_SACCADE_SPEED    = 11;
const BIO_SACCADE_DECAY    = 2.2;
/** IDLE-only: slow gaze drift repick cadence (ms) — small angles, smooth lerp. */
const IDLE_GAZE_DRIFT_IVAL_MS_MIN = 5000;
const IDLE_GAZE_DRIFT_IVAL_MS_MAX = 10_000;
const IDLE_GAZE_DRIFT_AMP         = 0.1;
const IDLE_GAZE_DRIFT_LERP_SPEED  = 1.35;
/** Head follows smoothed drift at ~50% with ~150 ms lag (first-order delay). */
const IDLE_GAZE_HEAD_FOLLOW       = 0.52;
const IDLE_GAZE_HEAD_DELAY_TAU    = 0.15;
/** IDLE-only: micro eye shifts via `avatar:gaze` (does not touch arms / VRMA). */
const IDLE_MICRO_GAZE_IVAL_MS_MIN = 2000;
const IDLE_MICRO_GAZE_IVAL_MS_MAX = 4000;
const IDLE_MICRO_GAZE_AMP         = 0.02;
const IDLE_MICRO_GAZE_DUR_MS_MIN  = 80;
const IDLE_MICRO_GAZE_DUR_MS_MAX  = 140;
/** Very slow head micro-tilt / yaw (idle only, low amplitude — presence without jitter) */
const HUMAN_IDLE_NECK_PITCH_FREQ = 0.088;
const HUMAN_IDLE_NECK_YAW_FREQ   = 0.061;
const HUMAN_IDLE_NECK_ROLL_FREQ  = 0.049;
const HUMAN_IDLE_NECK_PITCH_AMP  = 0.013;
const HUMAN_IDLE_NECK_YAW_AMP    = 0.009;
const HUMAN_IDLE_NECK_ROLL_AMP   = 0.007;

/**
 * Returns per-frame intent curve values based on normalised gesture progress.
 *
 * @param p        — gesture progress 0→1
 * @param t        — scene clock (seconds) for oscillation
 * @param isIdle   — true when gesture = idle (returns neutral values)
 *
 * Returns:
 *   intentBlend   — effective blend for arm targets (replaces gBlend on arms)
 *   slerpMul      — additional slerp speed factor for this phase
 *   holdOsc       — micro-oscillation value during hold (0 outside hold)
 *   phase         — current phase name (for debug)
 */
function computeIntentCurve(
  p: number,
  t: number,
  isIdle: boolean,
): { intentBlend: number; slerpMul: number; holdOsc: number; phase: string } {
  if (isIdle) return { intentBlend: 0, slerpMul: 1, holdOsc: 0, phase: 'idle' };

  if (p < INTENT_PREP_END) {
    // ── PREPARATION ──────────────────────────────────────────────────────────
    // Limb begins to travel at low amplitude (pre-impulse).
    // smoothstep eases in so there's no abrupt start.
    const localT = p / INTENT_PREP_END;
    const intentBlend = THREE.MathUtils.smoothstep(localT, 0, 1) * INTENT_PREP_BLEND;
    return { intentBlend, slerpMul: INTENT_SLERP_PREP, holdOsc: 0, phase: 'prep' };
  }

  if (p < INTENT_ATTACK_END) {
    // ── ATTACK ───────────────────────────────────────────────────────────────
    // Fast, confident reach from PREP_BLEND to PEAK_BLEND.
    // The slight overshoot (108%) feels natural; it's corrected in HOLD.
    const localT = (p - INTENT_PREP_END) / (INTENT_ATTACK_END - INTENT_PREP_END);
    const intentBlend = INTENT_PREP_BLEND +
      THREE.MathUtils.smoothstep(localT, 0, 1) * (INTENT_PEAK_BLEND - INTENT_PREP_BLEND);
    return { intentBlend, slerpMul: INTENT_SLERP_ATTACK, holdOsc: 0, phase: 'attack' };
  }

  if (p < INTENT_HOLD_END) {
    // ── HOLD ─────────────────────────────────────────────────────────────────
    // At peak. Micro-oscillation simulates sustained muscle activation.
    // Blend settles from PEAK_BLEND toward 1.0 (absorb overshoot).
    const localT  = (p - INTENT_ATTACK_END) / (INTENT_HOLD_END - INTENT_ATTACK_END);
    const intentBlend = THREE.MathUtils.lerp(INTENT_PEAK_BLEND, 1.0, localT);
    const holdOsc = Math.sin(t * INTENT_HOLD_OSC_FREQ * Math.PI * 2) * INTENT_HOLD_OSC_AMP;
    return { intentBlend, slerpMul: INTENT_SLERP_HOLD, holdOsc, phase: 'hold' };
  }

  // ── DECAY ───────────────────────────────────────────────────────────────────
  // Slow organic return. smoothstep eases out so there's no sharp cutoff.
  const localT = (p - INTENT_HOLD_END) / (1.0 - INTENT_HOLD_END);
  const intentBlend = 1.0 - THREE.MathUtils.smoothstep(localT, 0, 1);
  return { intentBlend, slerpMul: INTENT_SLERP_DECAY, holdOsc: 0, phase: 'decay' };
}

type IdleVariant = 'neutral' | 'weight_left' | 'casual';

type GenerativeBoneRot = { x: number; y: number; z: number };

/** Optional humanoid bones: bind + node lookup for generative overlay (legs, toes, finger phalanges). */
const OPTIONAL_GENERATIVE_BIND_NAMES = [
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftToes',
  'rightToes',
  'leftThumbDistal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbDistal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const;

const noiseHead   = createNoise3D();
const noiseBreath = createNoise3D();
const noiseArm    = createNoise3D(); // organic arm / gesture wave noise
const noiseJitter = createNoise3D(); // micro-jitter for wrists & head

type GestureId =
  | 'idle'
  | 'explain'
  | 'point'
  | 'think'
  | 'wave'
  | 'clap'
  | 'agree'
  | 'test_elbow';

// ─── Runtime calibration override (dev mode) ──────────────────────────────
// Written by GestureCalibrator; VRMSkeletonManager reads this every frame.
interface CalibrationPose {
  ruaX: number; ruaY: number; ruaZ: number;
  luaX: number; luaY: number; luaZ: number;
  rlaZ: number; llaZ: number;
  rhX: number;
  /** Optional — GestureCalibrator full wrist; defaults to gesture constant in skeleton. */
  rhY?: number;
  rhZ: number;
  lhX?: number;
  lhY?: number;
  lhZ?: number;
  /** 0 = open / extended, 1 = closed fist — from GestureCalibrator; optional. */
  fingerCurl?: number;
  /** Optional per-hand override; falls back to fingerCurl when omitted. */
  rFingerCurl?: number;
  lFingerCurl?: number;
}
const _calibrationRef: { current: { gesture: GestureId; pose: CalibrationPose } | null } =
  { current: null };

// ── Idle calibration override (written by GestureCalibrator v2 idle tab) ──
interface IdleCalibrationPose {
  ruaX: number; ruaZ: number;
  luaX: number; luaZ: number;
  rlaX: number; rlaZ: number;
}
const _idleCalRef: { current: IdleCalibrationPose | null } = { current: null };

if (typeof window !== 'undefined') {
  window.addEventListener('avatar:gesture:calibrate', (e: Event) => {
    const d = (e as CustomEvent<{ gesture: GestureId; pose: CalibrationPose | null }>).detail;
    if (d?.gesture && d?.pose) {
      _calibrationRef.current = { gesture: d.gesture, pose: d.pose };
    } else if (d?.gesture && !d?.pose) {
      // null pose means "clear calibration"
      if (_calibrationRef.current?.gesture === d.gesture) _calibrationRef.current = null;
    }
  });

  window.addEventListener('avatar:gesture:calibrate:idle', (e: Event) => {
    const d = (e as CustomEvent<IdleCalibrationPose | null>).detail;
    _idleCalRef.current = d ?? null;
  });
}

const LEGACY_TYPE_TO_GESTURE: Record<string, GestureId> = {
  wave: 'wave',
  waving: 'wave',
  openhand: 'explain',
  openhandgesture: 'explain',
  pointhand: 'point',
  beat: 'explain',
  clap: 'clap',
  clapping: 'clap',
  cheer: 'explain',
  think: 'think',
  thinking: 'think',
  idle: 'idle',
  explain: 'explain',
  point: 'point',
  // رموز avatarPerformanceBridge / resolvePerformanceCue
  ack: 'explain',
  agree: 'agree',
  agreeing: 'agree',
  beckon: 'point',
  goodbye: 'wave',
  relax: 'idle',
  rest: 'idle',
  sit: 'idle',       // sitting: procedural → idle (best available)
  sitting: 'idle',
  celebration: 'clap',
  open_hand: 'explain',
  'open-hand': 'explain',
  curious: 'think',
  lean_forward: 'think',
  leanforward: 'think',
  nod: 'agree',
  head_down: 'think',
  shoulder_sigh: 'idle',
  tilt: 'think',
  test_elbow: 'test_elbow',
  testelbow: 'test_elbow',
  'test-elbow': 'test_elbow',
};

function isGestureId(s: string): s is GestureId {
  return (
    s === 'idle' ||
    s === 'explain' ||
    s === 'point' ||
    s === 'think' ||
    s === 'wave' ||
    s === 'clap' ||
    s === 'agree' ||
    s === 'test_elbow'
  );
}

/** Map VRMA stem / display name (Thinking, Idle1, …) → procedural GestureId */
function gestureIdFromVrmaStem(raw: string): GestureId | null {
  const k = raw.replace(/\s+/g, '').toLowerCase();
  for (const [stem, can] of Object.entries(VRMA_TO_CANONICAL)) {
    if (stem.replace(/\s+/g, '').toLowerCase() === k && isGestureId(can)) return can;
  }
  return null;
}

function normalizeGestureDetail(detail: Record<string, unknown> | undefined | null): GestureId {
  if (!detail) return 'idle';
  const g = detail.gesture;
  if (typeof g === 'string' && isGestureId(g)) return g;
  if (typeof g === 'string' && g.trim()) {
    const fromStem = gestureIdFromVrmaStem(g.trim());
    if (fromStem) return fromStem;
  }
  const vr = detail.vrma;
  if (typeof vr === 'string') {
    const m = /\/([^/]+)\.vrma(\?.*)?$/i.exec(vr);
    if (m) {
      const fromUrl = gestureIdFromVrmaStem(m[1]);
      if (fromUrl) return fromUrl;
    }
  }
  const rawType = detail.type;
  if (typeof rawType === 'string') {
    const k = rawType.replace(/\s+/g, '').toLowerCase();
    if (LEGACY_TYPE_TO_GESTURE[k]) return LEGACY_TYPE_TO_GESTURE[k];
    if (isGestureId(rawType)) return rawType;
    const fromTypeStem = gestureIdFromVrmaStem(rawType);
    if (fromTypeStem) return fromTypeStem;
  }
  return 'idle';
}

/** Minimum wall time for procedural explain/point/wave/… so arms are not cut short by defaults. */
const MIN_PROCEDURAL_GESTURE_DURATION_MS = 2000;

function normalizeDurationMs(d: Record<string, unknown> | undefined | null): number {
  if (!d) return 3000;
  let ms: number | null = null;
  const dur = d.duration;
  if (typeof dur === 'number' && Number.isFinite(dur)) {
    ms = dur > 0 && dur < 60 ? Math.max(1, Math.round(dur * 1000)) : Math.max(1, dur);
  }
  const durMs = d.durationMs;
  if (typeof durMs === 'number' && Number.isFinite(durMs) && durMs > 0) {
    const fromDetail = Math.round(durMs);
    ms = ms === null ? fromDetail : Math.max(ms, fromDetail);
  }
  return ms === null ? 3000 : ms;
}

export type VRMSkeletonManagerProps = {
  vrm: VRM;
  neckGazeYawRef: MutableRefObject<number>;
  neckGazePitchRef: MutableRefObject<number>;
  isTalkingRef: MutableRefObject<boolean>;
  analyserRef?: MutableRefObject<AnalyserNode | null>;
  /** PAD arousal → animation energy multiplier (set by AvatarCanvas PAD bridge). */
  motorSpeedMulRef?: MutableRefObject<number>;
  /** True while the avatar is in listening mode (student speaking). */
  isListeningRef?: MutableRefObject<boolean>;
  /** True while the backend is generating a response (thinking indicator). */
  isThinkingRef?: MutableRefObject<boolean>;
  /**
   * مرجع مشترك من VRMAPlayer — عند true يتجاوز VRMSkeletonManager إيماءة gesture الإجرائية
   * ويُدمَج vrmaPoseRef في PoseComposer (لا كتابة مباشرة من الـ mixer).
   */
  vrmaActiveRef?: MutableRefObject<boolean>;
  /** عيّنها VRMAPlayer: لقطة عظام مطبّعة من الـ mixer (لا كتابة دائمة على الهيكل). */
  vrmaPoseRef?: MutableRefObject<{ seq: number; bones: BonePoseMap } | null>;
};

/**
 * Returns the NORMALIZED bone node for a given VRM human bone name.
 *
 * WHY normalized (not raw):
 *   Raw bones are in the GLTF model's own coordinate system and may have
 *   arbitrary pre-rotations baked in by the artist. Euler angles written to
 *   a raw bone produce unpredictable directions depending on the model.
 *   Normalized bones follow the VRM spec's consistent coordinate system:
 *     - Arm Z-axis always maps to "sideways" (T-pose aligned)
 *     - Spine X-axis always maps to "forward lean"
 *   When autoUpdateHumanBones = true (default), vrm.update() calls
 *   humanoid.update() which converts normalized rotations to raw with
 *   the correct per-model coordinate transform automatically.
 */
function bone(humanoid: NonNullable<VRM['humanoid']>, name: string): THREE.Object3D | null {
  try {
    return humanoid.getNormalizedBoneNode(name as never) ?? null;
  } catch {
    return null;
  }
}

/** أصابع: بعض النماذج لا تُعرّف العقدة المطبّعة فقط — جرّب الخام كاحتياطي */
function fingerBone(humanoid: NonNullable<VRM['humanoid']>, name: string): THREE.Object3D | null {
  const n = bone(humanoid, name);
  if (n) return n;
  try {
    return humanoid.getRawBoneNode(name as never) ?? null;
  } catch {
    return null;
  }
}

function captureBind(map: Map<string, THREE.Quaternion>, key: string, obj: THREE.Object3D | null) {
  if (!obj) return;
  map.set(key, obj.quaternion.clone());
}

/**
 * ═══════════════════════════════════════════════════════════
 *  EXECUTION ORDER CONTRACT (★ IMPORTANT — read this!)
 * ═══════════════════════════════════════════════════════════
 *
 * This manager runs at useFrame priority 0 (default).
 * AnimationController runs at useFrame priority -2 (earlier).
 *
 * Order per frame (R3F: lower priority number runs first):
 *   1. AnimationController (priority -2) — sets expression blend
 *      shapes (blink, emotions) and writes neckGazeYawRef /
 *      neckGazePitchRef values. It does NOT touch bone
 *      quaternions for neck/head directly.
 *   2. LipSyncManager (priority -1) — mouth viseme morphs (aa, ih, oh, …)
 *      via expressionManager.setValue. Must run **before** vrm.update
 *      so expressionManager.update() (inside vrm.update) applies the
 *      same frame’s weights to binds. Do not use priority ≥ 0 here.
 *   3. VRMSkeletonManager (priority 0, this file) — `motionSource`:
 *      VRMA | GESTURE | IDLE. When VRMA, this manager skips procedural
 *      bone writes (mixer owns the skeleton); still calls vrm.update.
 *      If the VRMA sampled pose omits arm keys, an arm fallback is merged into the
 *      VRMA layer for those bones only: base pose + slow sine (~0.1–0.2 Hz) and
 *      ±0.02 rad micro-noise (no full idle procedural stack).
 *      Otherwise reads neckGazeYawRef/PitchRef + procedural sway + idle-only
 *      attention drift (neck/head) and sparse `avatar:gaze` micro-pulses (eyes).
 *      Declarative poses (idle / gesture / generative / vrma) merge in PoseComposer;
 *      then intent motor, motion driver, breathingLayer (~0.23 Hz), cinematicMicroLayer,
 *      microHuman, idleMicroPresence; `applyFinalPoseToVrm` writes normalized bone quaternions.
 *      vrm.update(delta) always runs at end of this useFrame.
 *
 * ⚠  If AnimationController ever starts writing neck/head
 *    quaternions directly, it will conflict with this manager.
 *    Gaze data flows via refs, not direct bone manipulation.
 * ═══════════════════════════════════════════════════════════
 */

/**
 * Procedural bone engine; calls vrm.update(delta) once at the end (useFrame priority 0).
 */
export function VRMSkeletonManager({
  vrm,
  neckGazeYawRef,
  neckGazePitchRef,
  isTalkingRef,
  analyserRef,
  motorSpeedMulRef,
  isListeningRef,
  isThinkingRef,
  vrmaActiveRef,
  vrmaPoseRef,
}: VRMSkeletonManagerProps): null {

  const { camera } = useThree();

  const spineRef = useRef<THREE.Object3D | null>(null);
  const chestRef = useRef<THREE.Object3D | null>(null);
  const neckRef  = useRef<THREE.Object3D | null>(null);
  const headRef  = useRef<THREE.Object3D | null>(null);
  const ruaRef   = useRef<THREE.Object3D | null>(null);
  const luaRef   = useRef<THREE.Object3D | null>(null);
  const rlaRef   = useRef<THREE.Object3D | null>(null);
  const llaRef   = useRef<THREE.Object3D | null>(null);
  const rhRef    = useRef<THREE.Object3D | null>(null);
  const lhRef    = useRef<THREE.Object3D | null>(null);

  // ──── CHANGE #1: New bone refs for shoulders and hips ─────────────────────
  const hipsRef          = useRef<THREE.Object3D | null>(null);
  const leftShoulderRef  = useRef<THREE.Object3D | null>(null);
  const rightShoulderRef = useRef<THREE.Object3D | null>(null);

  // ──── CHANGE #5: Finger bone refs ─────────────────────────────────────────
  // Right hand fingers
  const rIndexProximalRef  = useRef<THREE.Object3D | null>(null);
  const rMiddleProximalRef = useRef<THREE.Object3D | null>(null);
  const rRingProximalRef   = useRef<THREE.Object3D | null>(null);
  const rLittleProximalRef = useRef<THREE.Object3D | null>(null);
  const rThumbProximalRef  = useRef<THREE.Object3D | null>(null);
  // Left hand fingers
  const lIndexProximalRef  = useRef<THREE.Object3D | null>(null);
  const lMiddleProximalRef = useRef<THREE.Object3D | null>(null);
  const lRingProximalRef   = useRef<THREE.Object3D | null>(null);
  const lLittleProximalRef = useRef<THREE.Object3D | null>(null);
  const lThumbProximalRef  = useRef<THREE.Object3D | null>(null);

  const bindRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  const idlePoseScratchRef = useRef<BonePoseMap>(new Map());
  const gesturePoseScratchRef = useRef<BonePoseMap>(new Map());
  const collisionPoseScratchRef = useRef<BonePoseMap>(new Map());
  const generativePoseScratchRef = useRef<BonePoseMap>(new Map());

  const gestureStateRef    = useRef<GestureId>('idle');
  const gestureStartRef    = useRef(0);
  const gestureDurationRef = useRef(3000);
  /**
   * FIX 2: Per-instance amplitude multiplier (0.75–1.25).
   * Re-randomized each time a new gesture starts — makes identical gestures
   * feel different from frame to frame, eliminating the "same pose every time" feel.
   */
  const gestureAmplitudeMulRef = useRef(1.0);

  /**
   * PHASE 3 — Gesture Context Object.
   * Stores semantic intent for the current gesture instance.
   * Drives head coupling, gaze shifts, and blink rate modulation.
   */
  const gestureContextRef = useRef<{
    intensity: number;   // 0.3–1.0 — how emphatic the gesture is
    mood:      string;   // 'neutral'|'confused'|'confident'|'empathetic'|'excited'
    durationMs: number;  // mirror of gestureDurationRef for behavior decay
  }>({ intensity: 0.7, mood: 'neutral', durationMs: 3000 });

  const lastEffGestureRef = useRef<GestureId>('idle');
  const gestureCrossfadeStartMsRef = useRef(masterClockNowMs());

  const idleVariantRef = useRef<IdleVariant>('neutral');
  const idleVariantNextSwitchRef = useRef(0);

  const generativeBonesRef  = useRef<Map<string, GenerativeBoneRot>>(new Map());
  const generativeBlendRef  = useRef(0);
  /** Nodes for bones not covered by dedicated refs (legs, distal/intermediate phalanges). */
  const extraGenerativeNodesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  /** Buffer for {@link readAnalyserRms01} — sole motion-path ingress; fed into unified energy only. */
  const timeDomainBufRef    = useRef<Uint8Array | null>(null);
  /** Voice-driven head offsets (smoothed; radians-scale). */
  const voiceHeadPitchSmRef = useRef(0);
  const voiceHeadYawSmRef   = useRef(0);
  const lastGestureFrameLogMsRef = useRef(0);
  const lastIdleZLogMsRef = useRef(0);
  /** Throttled `NEXT_PUBLIC_DEBUG_TRACE` frame counter (useFrame). */
  const motionTraceFrameRef = useRef(0);
  /** Awareness tick throttle — last call timestamp (ms). 500ms cadence. */
  const lastAwarenessTickMsRef = useRef(0);
  const testElbowLogMsRef = useRef(0);
  const waveOscLogMsRef = useRef(0);
  const prevMotionSourceRef = useRef<ProceduralMotionSource>('IDLE');
  const idleArmEaseFromMsRef = useRef(-Number.MAX_VALUE);

  /** Live diagnostic: see RUN_LOCAL_AXIS_CALIBRATION / NEXT_PUBLIC_DEBUG_LOCAL_AXIS_CALIB */
  const localAxisCalibStartMsRef = useRef<number | null>(null);
  const localAxisCalibPhaseLoggedRef = useRef(-1);
  const localAxisCalibDoneRef = useRef(false);

  // ── Nod state ─────────────────────────────────────────────────────────────
  const nodPhaseRef       = useRef(0);       // 0=idle, >0=mid-nod (radians progress)
  const nextNodAtMsRef    = useRef(0);       // timestamp of next nod trigger
  const nodPitchRef       = useRef(0);       // current nod pitch offset applied to head/neck

  // ── Thinking auto-gesture ─────────────────────────────────────────────────
  const thinkGestureActiveRef = useRef(false); // prevents repeated firing
  /** Smoothed 0–1 لقبضة اليد اليمنى في explain */
  const explainFingerCurlSmoothRef = useRef(0);
  /** منفصل عن اليمين — كان اليسار يُنعَّم من قيمة اليمين فلا يصل لهدفه */
  const explainFingerCurlLeftSmoothRef = useRef(0);

  // ── Eye saccade: smoothed gaze drift (idle only; 5–10 s cadence in constants) ─
  const saccadeXRef      = useRef(0);  // current smoothed pitch offset
  const saccadeYRef      = useRef(0);  // current smoothed yaw offset
  const saccadeNextMsRef = useRef(0);  // timestamp of next trigger
  const saccadeTgtXRef   = useRef(0);  // saccade target pitch
  const saccadeTgtYRef   = useRef(0);  // saccade target yaw

  // ── Idle attention: slow drift + delayed head follow + micro eye gaze (IDLE motion only) ─
  const idleGazeDriftYawRef   = useRef(0);
  const idleGazeDriftPitchRef = useRef(0);
  const idleGazeDriftTgtYawRef   = useRef(0);
  const idleGazeDriftTgtPitchRef = useRef(0);
  const idleGazeDriftNextMsRef   = useRef(0);
  const idleGazeHeadDlyYawRef    = useRef(0);
  const idleGazeHeadDlyPitchRef  = useRef(0);
  const idleMicroGazeNextMsRef   = useRef(0);
  /** Smoothed 0–1: user has floor → subtle neck/head bias toward camera. */
  const eyeContactPoseBlendRef = useRef(0);

  // ── Micro gesture overlay (avatar:micro:gesture → tiny brief bone nudge) ──
  /** Small per-bone nudge overlay: decays to 0 within ~0.6s */
  const microNudgeRef = useRef<{
    ruaX: number; ruaZ: number;
    luaX: number; luaZ: number;
    neckX: number; neckY: number;
    headX: number;
    blend: number; // 0=none 1=full; auto decays
    untilMs: number;
  }>({ ruaX: 0, ruaZ: 0, luaX: 0, luaZ: 0, neckX: 0, neckY: 0, headX: 0, blend: 0, untilMs: 0 });

  /** Next wall-clock ms to allow fallback `avatar:micro:gesture` (VRMA + low gesture weight). */
  const nextIdleMicroInjectAtMsRef = useRef(0);
  /** Self-heal: inject micro motion if behavior brain reports stillness > ~2s (throttled). */
  /** Failsafe: no embodiment pulse > ~2s — inject micro motion (throttled). */
  const lastEmbodimentFailsafeAtMsRef = useRef(0);

  // ── avatar:headpose override (AgentDirector._handleUserSpeaking, etc.) ──────
  /** Persistent gentle head yaw/pitch override; decays back to 0 after durationMs */
  const headposeYawRef   = useRef(0);
  const headposePitchRef = useRef(0);
  const headposeBlendRef = useRef(0);
  const headposeUntilMsRef = useRef(0);

  // ── Dedicated effect: window VRM references (never conflicts with humanoid check) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__vrm      = vrm;
    w.__cogniVRM = vrm;

    /**
     * دالة Debug للاختبار من Console المتصفح.
     * الاستخدام:
     *   window.__cogniPlayGesture('think')    // تفكير 2.5 ثانية
     *   window.__cogniPlayGesture('wave', 3)  // تلويح 3 ثوان
     *   window.__cogniPlayGesture('idle')     // إعادة للوضع الطبيعي
     *
     * الإيماءات المتاحة: think | wave | clap | agree | idle | explain | point
     */
    /**
     * PHASE 3: Updated debug API — now accepts Gesture Context Object.
     *
     * Usage examples:
     *   window.__cogniPlayGesture('think')
     *   window.__cogniPlayGesture('think', 2.5)
     *   window.__cogniPlayGesture({ type:'think', intensity:0.9, mood:'confused', duration:3 })
     *   window.__cogniPlayGesture({ type:'explain', intensity:0.6, mood:'confident' })
     */
    w.__cogniPlayGesture = (
      nameOrCtx: string | { type: string; intensity?: number; mood?: string; duration?: number },
      durationSec = 2.5,
    ) => {
      const GESTURES = ['think', 'wave', 'clap', 'agree', 'idle', 'explain', 'point', 'test_elbow'];

      let g: string, intensity: number, mood: string, dur: number;

      if (typeof nameOrCtx === 'object' && nameOrCtx !== null) {
        // Context Object API
        g         = (nameOrCtx.type ?? 'idle').toLowerCase().trim();
        intensity = nameOrCtx.intensity ?? 0.7;
        mood      = nameOrCtx.mood      ?? 'neutral';
        dur       = (nameOrCtx.duration ?? durationSec) * 1000;
      } else {
        // Legacy string API
        g         = (nameOrCtx ?? 'idle').toLowerCase().trim();
        intensity = 0.65 + Math.random() * 0.25;
        mood      = 'neutral';
        dur       = durationSec * 1000;
      }

      if (!GESTURES.includes(g)) {
        console.warn(`[Cogni] غير معروف: "${g}". المتاح: ${GESTURES.join(' | ')}`);
        return;
      }

      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: { gesture: g, type: g, durationMs: dur, intensity, mood, priority: 2 },
        }),
      );

      if (process.env.NODE_ENV === 'development') {
        avatarDebug(`[Cogni] ▶ playGesture("${g}", ${(dur/1000).toFixed(1)}s, intensity=${intensity.toFixed(2)}, mood=${mood})`);
      }
    };

    /** محور دلالي واحد على الذراع العلوية (ARM_IDLE + القناة) — انظر semanticArmCommand.ts */
    w.__cogniSendSemanticUpperArm = sendSemanticUpperArmToAvatar;
    w.__cogniSendToAvatarSemanticArm = sendToAvatarSemanticArm;
    w.__cogniSendArmForward = sendArmForward;
    w.__cogniSendUniversalBoneCommand = sendUniversalBoneCommand;

    return () => {
      if (w.__cogniPlayGesture) delete w.__cogniPlayGesture;
      if (w.__cogniSendSemanticUpperArm) delete w.__cogniSendSemanticUpperArm;
      if (w.__cogniSendToAvatarSemanticArm) delete w.__cogniSendToAvatarSemanticArm;
      if (w.__cogniSendArmForward) delete w.__cogniSendArmForward;
      if (w.__cogniSendUniversalBoneCommand) delete w.__cogniSendUniversalBoneCommand;
    };

    /** Dev helper — plays a procedural gesture via the same event path as the engine. */
    w.__cogniPlayProceduralGesture = (gesture: string, durationSec = 2.5) => {
      if (process.env.NODE_ENV === 'development') {
        avatarDebug(`[Dev] 🎭 Playing procedural gesture: ${gesture} (${durationSec}s)`);
      }
      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: { gesture, type: gesture, duration: durationSec },
        }),
      );
    };

    if (process.env.NODE_ENV === 'development') {
      avatarDebug('[VRMSkeletonManager] ✅ window.__vrm / window.__cogniVRM bound');
    }

    return () => {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w2 = window as any;
      if (w2.__vrm === vrm)      w2.__vrm      = null;
      if (w2.__cogniVRM === vrm) w2.__cogniVRM = null;
      if (typeof w2.__cogniPlayProceduralGesture === 'function') {
        delete w2.__cogniPlayProceduralGesture;
      }
    };
  }, [vrm]);

  useEffect(() => {
    const humanoid = vrm.humanoid;
    if (!humanoid) {
      console.error(
        '[VRMSkeletonManager] ❌ No humanoid found in VRM. Bones will NOT be cached. Gestures will NOT work.',
      );
      return;
    }

    avatarDebug('[VRMSkeletonManager] ✅ Humanoid found. Caching NORMALIZED bones...');

    // ── Comprehensive normalized-bone diagnostic ──────────────────────────
    const CRITICAL_BONES = [
      'rightUpperArm', 'leftUpperArm', 'rightLowerArm', 'leftLowerArm',
      'rightHand', 'leftHand', 'spine', 'chest', 'neck', 'head', 'hips',
      'leftShoulder', 'rightShoulder',
    ] as const;
    const boneStatus: Record<string, string> = {};
    for (const bname of CRITICAL_BONES) {
      const n = humanoid.getNormalizedBoneNode(bname as never);
      boneStatus[bname] = n ? '✅' : '❌';
    }
    if (DEBUG_AVATAR) console.table(boneStatus);

    const nullBones = CRITICAL_BONES.filter(
      (bname) => !humanoid.getNormalizedBoneNode(bname as never),
    );
    if (nullBones.length > 0) {
      console.error('[VRMSkeletonManager] ⚠️ Missing normalized bones:', nullBones);
    } else {
      avatarDebug('[VRMSkeletonManager] 🎉 All critical normalized bones found!');
    }

    const uninstallBypassProbe = installVrmHumanoidBypassProbe(vrm);

    console.log('[VRMSkeletonManager] ✅ VRM ready, registering gesture handlers');

    // ── Global debug handles ──────────────────────────────────────────────────
    // __vrm / __cogniVRM are managed by the dedicated effect above.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__cogniRefs = { rua: ruaRef, rla: rlaRef, lua: luaRef, lla: llaRef, rh: rhRef, lh: lhRef };
      // Error-sniper console helpers
      w.activateSniper   = activateSniper;
      w.deactivateSniper = deactivateSniper;
      // Forced-motion test flag (set true in console to run Task-1 probe)
      w.__forcedMotionTest  = w.__forcedMotionTest  ?? false;
      // Forced motionState override (set true to run Task-6 probe)
      w.__forceMotionState  = w.__forceMotionState  ?? false;
      // Skip finalPoseToVrm test (set true to run Task-3 probe)
      w.__skipFinalPoseToVrm = w.__skipFinalPoseToVrm ?? false;
      /** Read-only info object (NOT __avatarSkeletonGesture which AnimationController reads as string) */
      w.__cogniSkeletonInfo = {
        get currentGesture()        { return w.__avatarSkeletonGesture ?? 'idle'; },
        get autoUpdateHumanBones()  { return vrm.humanoid?.autoUpdateHumanBones ?? false; },
        get hasHumanoid()           { return !!vrm.humanoid; },
        playGesture(gesture: string, durationSec = 2.5) {
          w.__cogniPlayProceduralGesture?.(gesture, durationSec);
        },
      };
    }

    // Verify autoUpdateHumanBones is true (needed for normalized→raw propagation)
    if (humanoid.autoUpdateHumanBones === false) {
      console.error(
        '[VRMSkeletonManager] ❌ autoUpdateHumanBones is FALSE — normalized bone changes will NOT propagate to raw bones! Arm/body motion will be invisible.',
      );
    } else {
      avatarDebug('[VRMSkeletonManager] ✅ autoUpdateHumanBones =', humanoid.autoUpdateHumanBones, '(normalized → raw propagation active)');
    }

    const m = bindRef.current;
    m.clear();

    spineRef.current = bone(humanoid, 'spine');
    chestRef.current = bone(humanoid, 'chest') || bone(humanoid, 'upperChest');
    neckRef.current  = bone(humanoid, 'neck');
    headRef.current  = bone(humanoid, 'head');
    ruaRef.current   = bone(humanoid, 'rightUpperArm');
    luaRef.current   = bone(humanoid, 'leftUpperArm');
    rlaRef.current   = bone(humanoid, 'rightLowerArm');
    llaRef.current   = bone(humanoid, 'leftLowerArm');
    rhRef.current    = bone(humanoid, 'rightHand');
    lhRef.current    = bone(humanoid, 'leftHand');

    // ── If normalized arm bones are still null after initial acquisition,
    //    combineSkeletons may have been called before VRM fully registered its
    //    internal skeleton.  Schedule one deferred re-acquisition.
    if (!ruaRef.current) {
      console.warn(
        '[VRMSkeletonManager] ⚠ rightUpperArm null after first cache pass — ' +
        'scheduling deferred re-acquisition (combineSkeletons race).',
      );
      requestAnimationFrame(() => {
        ruaRef.current = bone(humanoid, 'rightUpperArm');
        luaRef.current = bone(humanoid, 'leftUpperArm');
        rlaRef.current = bone(humanoid, 'rightLowerArm');
        llaRef.current = bone(humanoid, 'leftLowerArm');
        rhRef.current  = bone(humanoid, 'rightHand');
        lhRef.current  = bone(humanoid, 'leftHand');
        const mb = bindRef.current;
        captureBind(mb, 'rua', ruaRef.current);
        captureBind(mb, 'lua', luaRef.current);
        captureBind(mb, 'rla', rlaRef.current);
        captureBind(mb, 'lla', llaRef.current);
        captureBind(mb, 'rh', rhRef.current);
        captureBind(mb, 'lh', lhRef.current);
        if (ruaRef.current) {
          avatarDebug('[VRMSkeletonManager] ✅ Deferred bone acquisition succeeded — rightUpperArm now valid.');
        } else {
          console.error(
            '[VRMSkeletonManager] ❌ rightUpperArm STILL null after deferred acquisition. ' +
            'The VRM model may not define this bone, or VRMLoaderPlugin is missing.',
          );
        }
      });
    }

    // ──── CHANGE #1: Acquire shoulder and hip bones ─────────────────────────
    hipsRef.current          = bone(humanoid, 'hips');
    leftShoulderRef.current  = bone(humanoid, 'leftShoulder');
    rightShoulderRef.current = bone(humanoid, 'rightShoulder');

    // ──── CHANGE #5: Acquire finger bones (graceful if missing) ─────────────
    rIndexProximalRef.current  = fingerBone(humanoid, 'rightIndexProximal');
    rMiddleProximalRef.current = fingerBone(humanoid, 'rightMiddleProximal');
    rRingProximalRef.current   = fingerBone(humanoid, 'rightRingProximal');
    rLittleProximalRef.current = fingerBone(humanoid, 'rightLittleProximal');
    rThumbProximalRef.current  = fingerBone(humanoid, 'rightThumbProximal');
    lIndexProximalRef.current  = fingerBone(humanoid, 'leftIndexProximal');
    lMiddleProximalRef.current = fingerBone(humanoid, 'leftMiddleProximal');
    lRingProximalRef.current   = fingerBone(humanoid, 'leftRingProximal');
    lLittleProximalRef.current = fingerBone(humanoid, 'leftLittleProximal');
    lThumbProximalRef.current  = fingerBone(humanoid, 'leftThumbProximal');

    captureBind(m, 'spine', spineRef.current);
    captureBind(m, 'chest', chestRef.current);
    captureBind(m, 'neck',  neckRef.current);
    captureBind(m, 'head',  headRef.current);
    // ──── CHANGE #1: Capture bind poses for new bones ───────────────────────
    captureBind(m, 'hips',          hipsRef.current);
    captureBind(m, 'leftShoulder',  leftShoulderRef.current);
    captureBind(m, 'rightShoulder', rightShoulderRef.current);
    // Arms: required so `blendPoseLayers` includes lua/rua/lla/rla keys (otherwise VRMA+fallback never blend).
    captureBind(m, 'rua', ruaRef.current);
    captureBind(m, 'lua', luaRef.current);
    captureBind(m, 'rla', rlaRef.current);
    captureBind(m, 'lla', llaRef.current);
    captureBind(m, 'rh', rhRef.current);
    captureBind(m, 'lh', lhRef.current);
    // ──── CHANGE #5: Capture finger bind poses ──────────────────────────────
    captureBind(m, 'rIndexProximal',  rIndexProximalRef.current);
    captureBind(m, 'rMiddleProximal', rMiddleProximalRef.current);
    captureBind(m, 'rRingProximal',   rRingProximalRef.current);
    captureBind(m, 'rLittleProximal', rLittleProximalRef.current);
    captureBind(m, 'rThumbProximal',  rThumbProximalRef.current);
    captureBind(m, 'lIndexProximal',  lIndexProximalRef.current);
    captureBind(m, 'lMiddleProximal', lMiddleProximalRef.current);
    captureBind(m, 'lRingProximal',   lRingProximalRef.current);
    captureBind(m, 'lLittleProximal', lLittleProximalRef.current);
    captureBind(m, 'lThumbProximal',  lThumbProximalRef.current);

    // ── [VRM_FORENSIC] one-shot humanoid bone map + resolution check ─────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(globalThis as any).__vrmForensicLogged) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__vrmForensicLogged = true;
      const _criticalNames = [
        'head','neck','spine','chest','upperChest','hips',
        'leftShoulder','rightShoulder',
        'leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm',
        'leftHand','rightHand',
        'leftThumbProximal','leftIndexProximal','leftMiddleProximal','leftRingProximal','leftLittleProximal',
        'rightThumbProximal','rightIndexProximal','rightMiddleProximal','rightRingProximal','rightLittleProximal',
        'leftIndexIntermediate','leftIndexDistal',
        'rightIndexIntermediate','rightIndexDistal',
      ] as const;
      const _resolved: Record<string, { node: string; rawOnly: boolean }> = {};
      for (const n of _criticalNames) {
        const norm = (() => { try { return humanoid.getNormalizedBoneNode(n as never) ?? null; } catch { return null; } })();
        const raw  = (() => { try { return humanoid.getRawBoneNode(n as never) ?? null; } catch { return null; } })();
        _resolved[n] = {
          node: norm?.name ?? raw?.name ?? 'NOT_FOUND',
          rawOnly: !!raw && !norm,
        };
      }
      console.log('[VRM_BONES]', Object.keys(humanoid.humanBones ?? {}));
      console.log('[BONE_NODE_CHECK]', _resolved);
      // ── [AVATAR_AUDIT:BONES] — official one-shot bone health check ─────────
      if (AVATAR_DEBUG || AVATAR_SAFE_MODE) {
        const _auditNames = [
          'head','neck','spine','chest','hips',
          'leftShoulder','rightShoulder',
          'rightUpperArm','leftUpperArm','rightLowerArm','leftLowerArm',
          'rightHand','leftHand',
        ] as const;
        const _auditCaptured = _auditNames.filter(n => !!humanoid.getNormalizedBoneNode(n as never));
        const _auditMissing  = _auditNames.filter(n => !humanoid.getNormalizedBoneNode(n as never));
        console.log('[AVATAR_AUDIT:BONES]', {
          captured:           _auditCaptured,
          missing:            _auditMissing,
          totalCapturedCount: _auditCaptured.length,
          finalPoseKeyCount:  m.size,
        });
        if (_auditMissing.length > 0) {
          console.warn('[AVATAR_AUDIT:BONES] ⚠️ Missing bones will produce dead motion for those joints:', _auditMissing);
        }
      }
      console.log('[FINGER_MAP]', {
        intermediatesInBind: !m.has('leftIndexIntermediate'),
        distalsInBind:       !m.has('leftIndexDistal'),
        proximalsInBind:     !!m.get('lIndexProximal'),
      });
      console.log('[SPINE_CHAIN]', {
        spine:       !!m.get('spine'),
        chest:       !!m.get('chest'),
        upperChestResolved: !!(humanoid.getNormalizedBoneNode('upperChest' as never)),
      });
      console.log('[NAME_MAPPING]', {
        'lua → leftUpperArm': _resolved['leftUpperArm'].node !== 'NOT_FOUND',
        'rua → rightUpperArm': _resolved['rightUpperArm'].node !== 'NOT_FOUND',
        'lla → leftLowerArm': _resolved['leftLowerArm'].node !== 'NOT_FOUND',
        'rla → rightLowerArm': _resolved['rightLowerArm'].node !== 'NOT_FOUND',
        'lh → leftHand': _resolved['leftHand'].node !== 'NOT_FOUND',
        'rh → rightHand': _resolved['rightHand'].node !== 'NOT_FOUND',
      });

      // ── [AXIS_CALIBRATION] — inspect local axes in world space ────────────
      // For each critical bone, compute where its local +X, +Y, +Z point in world.
      // This tells us which local axis produces outward/inward/up motion without
      // mutating the pose.
      const _axisTargets: readonly [string, THREE.Object3D | null][] = [
        ['head',           headRef.current],
        ['neck',           neckRef.current],
        ['leftUpperArm',   luaRef.current],
        ['rightUpperArm',  ruaRef.current],
        ['leftLowerArm',   llaRef.current],
        ['rightLowerArm',  rlaRef.current],
        ['leftHand',       lhRef.current],
        ['rightHand',      rhRef.current],
        ['leftShoulder',   leftShoulderRef.current],
        ['rightShoulder',  rightShoulderRef.current],
        ['spine',          spineRef.current],
        ['chest',          chestRef.current],
        ['hips',           hipsRef.current],
      ];
      const _vX = new THREE.Vector3(1, 0, 0);
      const _vY = new THREE.Vector3(0, 1, 0);
      const _vZ = new THREE.Vector3(0, 0, 1);
      const _wX = new THREE.Vector3();
      const _wY = new THREE.Vector3();
      const _wZ = new THREE.Vector3();
      const fmt = (v: THREE.Vector3) => ({
        x: Number(v.x.toFixed(3)),
        y: Number(v.y.toFixed(3)),
        z: Number(v.z.toFixed(3)),
      });
      const axisReport: Record<string, Record<string, { x: number; y: number; z: number }>> = {};
      const axisMap: Record<string, { openAxis: string; openSign: 1 | -1 }> = {};
      for (const [name, node] of _axisTargets) {
        if (!node) { axisReport[name] = { x: {x:0,y:0,z:0}, y:{x:0,y:0,z:0}, z:{x:0,y:0,z:0} }; continue; }
        node.updateWorldMatrix(true, false);
        // world basis = world rotation applied to local axis
        _wX.copy(_vX).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
        _wY.copy(_vY).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
        _wZ.copy(_vZ).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
        axisReport[name] = { x: fmt(_wX), y: fmt(_wY), z: fmt(_wZ) };
        // For arms, the axis with largest |world.x| component is "outward" (sideways).
        // Positive world.x = right side of avatar; negative = left side.
        const candidates = [
          { local: 'x', wx: _wX.x },
          { local: 'y', wx: _wY.x },
          { local: 'z', wx: _wZ.x },
        ];
        const best = candidates.reduce((a, b) => Math.abs(b.wx) > Math.abs(a.wx) ? b : a);
        axisMap[name] = {
          openAxis: best.local,
          openSign: (best.wx >= 0 ? 1 : -1) as 1 | -1,
        };
      }
      // ── [REST] — current Euler of every critical bone BEFORE any motion ──
      const _restReport: Record<string, { x: number; y: number; z: number }> = {};
      const _eTmpRest = new THREE.Euler(0, 0, 0, 'YXZ');
      for (const [name, node] of _axisTargets) {
        if (!node) { _restReport[name] = { x: NaN, y: NaN, z: NaN }; continue; }
        _eTmpRest.setFromQuaternion(node.quaternion, 'YXZ');
        _restReport[name] = {
          x: Number(_eTmpRest.x.toFixed(4)),
          y: Number(_eTmpRest.y.toFixed(4)),
          z: Number(_eTmpRest.z.toFixed(4)),
        };
      }
      console.log('[REST]', _restReport);

      console.log('[BONE_AXES_WORLD]', axisReport);
      console.log('[AXIS_MAP]', axisMap);
      console.log('[AXIS_CALIBRATION_HINT]',
        'openAxis = local axis whose world-X projection is strongest. ' +
        'openSign: +1 = points toward avatar right side, −1 = points toward avatar left side. ' +
        'For LEFT arm: positive rotation on openAxis with openSign=+1 should ABDUCT (open outward). ' +
        'For RIGHT arm: if openSign=+1, you need NEGATIVE rotation to open outward; reverse if openSign=−1. ' +
        'To override: window.__setBoneAxisMap({ lua: { open: { axis: "y", sign: 1 } } })',
      );
      // Expose override on window for live calibration from DevTools.
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__setBoneAxisMap = setBoneAxisMap;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__getBoneAxisMap = () => BONE_AXIS_MAP;
      }
    }

    const extraMap = extraGenerativeNodesRef.current;
    extraMap.clear();
    for (const vrmName of OPTIONAL_GENERATIVE_BIND_NAMES) {
      const n = bone(humanoid, vrmName);
      if (n) {
        captureBind(m, vrmName, n);
        extraMap.set(vrmName, n);
      }
    }

    const onGenerative = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || typeof detail !== 'object') return;
      const bones = detail.bones;
      if (!bones || typeof bones !== 'object') return;

      const blendRaw = detail.blend;
      const blend =
        typeof blendRaw === 'number' && Number.isFinite(blendRaw)
          ? THREE.MathUtils.clamp(blendRaw, 0, 1)
          : 0.88;
      const gm = generativeBonesRef.current;
      const replaceAll = detail.replaceAll === true;
      if (replaceAll) gm.clear();

      generativeBlendRef.current = blend;
      const assumeDeg = detail.assumeEulerDegrees === true;
      for (const [key, val] of Object.entries(bones as Record<string, unknown>)) {
        const nk = normalizeGenerativeBoneKey(key);
        if (!nk || !val || typeof val !== 'object') continue;
        const o = val as Record<string, unknown>;
        let x = typeof o.x === 'number' ? o.x : 0;
        let y = typeof o.y === 'number' ? o.y : 0;
        let z = typeof o.z === 'number' ? o.z : 0;
        if (assumeDeg) {
          x = THREE.MathUtils.degToRad(x);
          y = THREE.MathUtils.degToRad(y);
          z = THREE.MathUtils.degToRad(z);
        }
        const cl = clampGenerativeEulerYXZ(nk, x, y, z);
        gm.set(nk, { x: cl.x, y: cl.y, z: cl.z });
      }
    };

    const onGenerativeReset = (ev: Event) => {
      const d = (ev as CustomEvent<{ bones?: string[] }>).detail;
      const gm = generativeBonesRef.current;
      if (!d?.bones?.length) {
        gm.clear();
        return;
      }
      for (const raw of d.bones) {
        const nk = normalizeGenerativeBoneKey(raw);
        if (nk) gm.delete(nk);
      }
    };

    window.addEventListener('avatar:generative:gesture', onGenerative);
    window.addEventListener('avatar:generative:reset', onGenerativeReset);
    return () => {
      uninstallBypassProbe();
      window.removeEventListener('avatar:generative:gesture', onGenerative);
      window.removeEventListener('avatar:generative:reset', onGenerativeReset);
      // __vrm / __cogniVRM cleanup is in the dedicated effect above
    };
  }, [vrm]);

  useEffect(() => {
    // ── Pending gesture queue: catches gestures that arrive before humanoid ready ─
    // Changed from single-slot to queue so multiple startup gestures (greeting + think)
    // are not silently dropped. Cap at 5 to prevent memory leaks if humanoid never loads.
    const _pendingGestureRef: { queue: Record<string, unknown>[] } = { queue: [] };

    // ── PHASE 3: Gesture Behavior Dispatcher ──────────────────────────────────
    // Translates gesture intent into coupled head/gaze/blink events.
    // Uses existing avatar:gaze, avatar:headpose, avatar:blink infrastructure.
    const dispatchBehaviorForGesture = (
      gesture: GestureId,
      intensity: number,
      mood: string,
      durationMs: number,
      /** When true, body pose comes from VRMA — do not stack strong head/gaze on neck (avoids “robot chin drop”). */
      opts?: { vrmaCoupled?: boolean },
    ) => {
      if (typeof window === 'undefined' || gesture === 'idle') return;

      // Clamp intensity to valid range
      const intens = THREE.MathUtils.clamp(intensity, 0.3, 1.0);
      const gazeHoldMs = Math.min(durationMs * 0.8, 2200);
      const vrmaCoupled = opts?.vrmaCoupled === true;

      // ── Head Coupling Table ──────────────────────────────────────────────────
      // Each gesture type gets a specific head pose and gaze shift.
      // Values are scaled by intensity so 'confused' mood gets larger tilts.
      const moodMul = mood === 'confused' ? 1.3
                    : mood === 'excited'  ? 1.1
                    : mood === 'empathetic' ? 0.8
                    : mood === 'confident'  ? 0.9
                    : 1.0; // neutral

      // avatar:headpose is handled by VRMSkeletonManager onHeadPose listener
      const emitHeadPose = (yaw: number, pitch: number, dur = gazeHoldMs) => {
        window.dispatchEvent(new CustomEvent('avatar:headpose', {
          detail: { yaw: yaw * intens * moodMul, pitch: pitch * intens * moodMul, durationMs: dur },
        }));
      };
      // avatar:gaze is handled by AnimationController onGaze listener
      const emitGaze = (yaw: number, pitch: number, dur = gazeHoldMs) => {
        window.dispatchEvent(new CustomEvent('avatar:gaze', {
          detail: { yaw: yaw * intens, pitch: pitch * intens, durationMs: dur },
        }));
      };
      // avatar:blink is handled by AnimationController blinkStyleRef
      const emitBlink = (style: 'slow' | 'normal') => {
        window.dispatchEvent(new CustomEvent('avatar:blink', { detail: { style } }));
      };

      switch (gesture) {
        case 'think':
          emitBlink('slow');
          if (vrmaCoupled) {
            // Thinking.vrma already drives neck/spine — extra headpose + down-gaze reads inhuman.
            break;
          }
          emitHeadPose(
            (Math.random() > 0.5 ? 0.055 : -0.055) * moodMul,
            -0.038,
          );
          emitGaze(-0.07, -0.1);
          break;

        case 'explain':
          // Head: subtle forward pitch (engaging lean) + slight turn toward "board"
          emitHeadPose(0.0, -0.03, gazeHoldMs * 0.6); // brief forward nod
          // Gaze: toward camera (addressing listener directly)
          emitGaze(0, 0.05, gazeHoldMs); // slight upward = confident eye contact
          emitBlink('normal');
          break;

        case 'point':
          // Head: turns slightly in pointing direction (right upper arm = right side)
          emitHeadPose(0.10, 0, gazeHoldMs * 0.5);
          // Gaze: follows arm direction
          emitGaze(0.18 * intens, 0.04, gazeHoldMs);
          emitBlink('normal');
          break;

        case 'wave':
          // Head: slight rise (upbeat, greeting energy)
          emitHeadPose(0.0, -0.04);
          emitGaze(0, 0.08, gazeHoldMs); // look up slightly (openness)
          emitBlink('normal');
          break;

        case 'agree':
          // Head: gentle forward tilt (affirmation body language)
          emitHeadPose(0.0, -0.04, 600);
          emitGaze(0, 0, gazeHoldMs);
          emitBlink('normal');
          break;

        case 'clap':
          // Head: slight upward pitch (celebratory)
          emitHeadPose(0.0, -0.05);
          emitGaze(0, 0.06, gazeHoldMs);
          emitBlink('normal');
          break;

        case 'test_elbow':
          emitBlink('normal');
          break;

        default:
          break;
      }
    };

    const applyGestureDetail = (detail: Record<string, unknown>) => {
      const next = normalizeGestureDetail(detail);
      const priRaw = detail?.priority;
      const pri = typeof priRaw === 'number' && Number.isFinite(priRaw) ? priRaw : 'n/a';

      // VRMA mixer owns body motion — only head/gaze/blink from dispatchBehaviorForGesture (no arm procedural).
      const isVrmaPipeline =
        detail.motion === 'vrma'
        || (typeof detail.vrma === 'string' && detail.vrma.length > 0);
      if (isVrmaPipeline) {
        const intensity = typeof detail.intensity === 'number'
          ? THREE.MathUtils.clamp(detail.intensity, 0.3, 1.0)
          : 0.65 + Math.random() * 0.25;
        const mood = typeof detail.mood === 'string' ? detail.mood : 'neutral';
        const durationMs = normalizeDurationMs(detail);
        if (next !== 'idle') {
          const anticipationMs = 150 + Math.random() * 100;
          setTimeout(() => {
            dispatchBehaviorForGesture(next, intensity, mood, durationMs, { vrmaCoupled: true });
          }, anticipationMs);
        }
        return;
      }

      // FIX 2: randomize amplitude per gesture instance (0.75–1.25×)
      gestureAmplitudeMulRef.current = next === 'idle' ? 1.0 : 0.75 + Math.random() * 0.50;

      // PHASE 3: parse gesture context and fire behavior events
      const intensity = typeof detail.intensity === 'number'
        ? THREE.MathUtils.clamp(detail.intensity, 0.3, 1.0)
        : 0.65 + Math.random() * 0.25; // default: randomised 0.65–0.90 for variety
      const mood = typeof detail.mood === 'string' ? detail.mood : 'neutral';
      let durationMs = normalizeDurationMs(detail);
      if (next !== 'idle') {
        durationMs = Math.max(MIN_PROCEDURAL_GESTURE_DURATION_MS, durationMs);
      }

      gestureContextRef.current = { intensity, mood, durationMs };

      // Dispatch head/gaze/blink behavior with a short ANTICIPATION delay (150–250ms)
      // so behavior STARTS before the gesture arm motion peaks (natural pre-impulse)
      if (next !== 'idle') {
        const anticipationMs = 150 + Math.random() * 100;
        setTimeout(() => {
          dispatchBehaviorForGesture(next, intensity, mood, durationMs);
        }, anticipationMs);
      }

      if (process.env.NODE_ENV === 'development') {
        avatarDebug(
          `[VRMSkeletonManager] 🎭 ${next} | intensity=${intensity.toFixed(2)} mood=${mood} amp=${gestureAmplitudeMulRef.current.toFixed(2)} (priority: ${pri})`,
        );
      }
      gestureStateRef.current = next;
      gestureStartRef.current = masterClockNowMs();
      gestureDurationRef.current = durationMs;
    };

    // Replay all gestures that arrived before humanoid was ready
    if (vrm.humanoid && _pendingGestureRef.queue.length > 0) {
      for (const d of _pendingGestureRef.queue) applyGestureDetail(d);
      _pendingGestureRef.queue.length = 0;
    }

    const onGesture = (e: Event) => {
      // BLOCK_ALL_GESTURES: ignore all incoming gestures — avatar stays at ARM_IDLE
      if (BLOCK_ALL_GESTURES) return;
      const detail = (e as CustomEvent<Record<string, unknown>>).detail;
      if (!vrm.humanoid) {
        // Queue the gesture — replayed when humanoid is available (up to 5 slots)
        _pendingGestureRef.queue.push(detail);
        if (_pendingGestureRef.queue.length > 5) _pendingGestureRef.queue.shift();
        if (process.env.NODE_ENV === 'development') {
          console.warn('[VRMSkeletonManager] ⏳ Gesture queued (humanoid not ready):', detail?.gesture ?? detail?.type, `[queue size: ${_pendingGestureRef.queue.length}]`);
        }
        return;
      }
      applyGestureDetail(detail);
    };

    // ── Micro gesture: tiny bone nudge from gestureScheduler/spontaneous ────────
    const MICRO_PRESETS: Record<string, Partial<typeof microNudgeRef['current']>> = {
      eyebrow:        { neckX: -0.04, headX: -0.05 },
      question_tilt:  { neckY: 0.08,  headX: 0.04 },
      chin_up:        { neckX: -0.06, headX: -0.04 },
      lean_in:        { ruaX: 0.05,   luaX: 0.04   },
      nod:            { neckX: 0.10,  headX: 0.06   },
      shrug:          { ruaZ: -0.18,  luaZ: 0.18    },
      // Level 6.2 — micro-behaviour kinds (BehaviorBrainHost → MicroExpressionEngine)
      eye_squint:     { neckY: 0.05,  headX: 0.02, neckX: -0.02 },
      lip_press:      { neckX: -0.04, headX: -0.025 },
      cheek_shift:    { neckY: -0.045, headX: 0.035 },
    };
    const onMicroGesture = (e: Event) => {
      if (!vrm.humanoid) return;
      const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      // Accept both `kind` (SpontaneousBehavior) and `type` (gestureScheduler)
      const rawKind = (typeof detail.kind === 'string' && detail.kind)
        || (typeof detail.type === 'string' && detail.type)
        || '';
      const kind = rawKind.toLowerCase().replace(/[-\s]/g, '_');
      const dur  = typeof detail.durationMs === 'number' && detail.durationMs > 0 ? detail.durationMs : 500;
      const ampDetail = (detail as { amplitudeMul?: unknown }).amplitudeMul;
      const ampMul =
        typeof ampDetail === 'number' && Number.isFinite(ampDetail)
          ? THREE.MathUtils.clamp(ampDetail, 0.25, 1.25)
          : 1;
      if (!(kind in MICRO_PRESETS) && process.env.NODE_ENV === 'development') {
        console.warn(`[VRMSkeletonManager] micro:gesture unknown kind="${kind}" — using nod fallback`);
      }
      const preset = MICRO_PRESETS[kind] ?? MICRO_PRESETS['nod'];
      const mn = microNudgeRef.current;
      mn.ruaX  = (preset?.ruaX  ?? 0) * ampMul;
      mn.ruaZ  = (preset?.ruaZ  ?? 0) * ampMul;
      mn.luaX  = (preset?.luaX  ?? 0) * ampMul;
      mn.luaZ  = (preset?.luaZ  ?? 0) * ampMul;
      mn.neckX = (preset?.neckX ?? 0) * ampMul;
      mn.neckY = (preset?.neckY ?? 0) * ampMul;
      mn.headX = (preset?.headX ?? 0) * ampMul;
      mn.blend  = 1;
      mn.untilMs = masterClockNowMs() + dur;
    };

    // ── avatar:headpose: gentle persistent head turn from director (listening nod, etc.) ──
    const onHeadPose = (e: Event) => {
      if (!vrm.humanoid) return;
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      headposeYawRef.current   = typeof d.yaw   === 'number' ? THREE.MathUtils.clamp(d.yaw,   -0.35, 0.35) : 0;
      headposePitchRef.current = typeof d.pitch === 'number' ? THREE.MathUtils.clamp(d.pitch, -0.25, 0.25) : 0;
      const dur = typeof d.duration === 'number' && d.duration > 0 ? d.duration
        : typeof d.durationMs === 'number' && d.durationMs > 0 ? d.durationMs
        : 1200;
      headposeBlendRef.current   = 1;
      headposeUntilMsRef.current = masterClockNowMs() + dur;
    };

    // ── avatar:nod — explicit nod command (from AgentDirector / tts.ts) ────────
    const onNod = (e: Event) => {
      if (!vrm.humanoid) return;
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const intensity = typeof d.intensity === 'number' ? d.intensity : 0.08;
      const durMs     = typeof d.duration  === 'number' ? d.duration * 1000
                       : typeof d.durationMs === 'number' ? d.durationMs : 600;
      // Map avatar:nod to a nod micro-gesture immediately
      const mn = microNudgeRef.current;
      mn.neckX = 0.10 * intensity / 0.15;  // scale by intensity
      mn.headX = 0.06 * intensity / 0.15;
      mn.ruaX = 0; mn.ruaZ = 0; mn.luaX = 0; mn.luaZ = 0; mn.neckY = 0;
      mn.blend   = 1;
      mn.untilMs = masterClockNowMs() + durMs;
    };

    // ── avatar:listening — update body posture when listening to student ───────
    const onListening = (e: Event) => {
      if (!vrm.humanoid) return;
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const active = d.active !== false; // default true
      if (active) {
        // TODO: verify listening axis — no neck.rotation.* here; headpose maps pitch→neck X, yaw→neck Y.
        // Engaged listening: forward attention on neck **Y** (Euler slot 2), not pitch→X.
        headposeYawRef.current   = 0.09;
        headposePitchRef.current = 0;
        headposeBlendRef.current   = 0.7;
        headposeUntilMsRef.current = masterClockNowMs() + 4000;
      } else {
        // Stop listening posture — reset headpose
        headposeBlendRef.current   = 0;
        headposeUntilMsRef.current = 0;
      }
    };

    // Capture phase on window: `document.dispatchEvent(new CustomEvent('avatar:gesture', …))`
    // uses bubbles:false by default, so bubble listeners on `window` never run — capture does.
    if (!AVATAR_BEHAVIOR_SINGLE_CONTROLLER) {
      window.addEventListener('avatar:gesture', onGesture, true);
    }
    window.addEventListener('avatar:micro:gesture', onMicroGesture as EventListener);
    window.addEventListener('avatar:speech:emphasis', onMicroGesture as EventListener);
    window.addEventListener('avatar:headpose', onHeadPose as EventListener);
    window.addEventListener('avatar:nod', onNod as EventListener);
    window.addEventListener('avatar:listening', onListening as EventListener);
    return () => {
      if (!AVATAR_BEHAVIOR_SINGLE_CONTROLLER) {
        window.removeEventListener('avatar:gesture', onGesture, true);
      }
      window.removeEventListener('avatar:micro:gesture', onMicroGesture as EventListener);
      window.removeEventListener('avatar:speech:emphasis', onMicroGesture as EventListener);
      window.removeEventListener('avatar:headpose', onHeadPose as EventListener);
      window.removeEventListener('avatar:nod', onNod as EventListener);
      window.removeEventListener('avatar:listening', onListening as EventListener);
    };
  }, [vrm]);

  useEffect(() => {
    attachMotionPipelineEventProbes();
    // Idempotent — `initStudentAwarenessListeners` guards with internal flag.
    initStudentAwarenessListeners();
  }, []);

  useEffect(() => {
    if (!VRM_HARD_ISOLATION) return;
    const lookAt = vrm.lookAt;
    if (lookAt) {
      lookAt.autoUpdate = false;
    }
    const sbm = (vrm as { springBoneManager?: { enabled?: boolean } }).springBoneManager;
    if (sbm) {
      sbm.enabled = false;
    }
  }, [vrm]);

  useFrame((_, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    if (isAvatarMotionTraceOn()) {
      motionTraceFrameRef.current += 1;
    }
    // Per-frame hard guard: evict VRMA authority in procedural-only mode.
    assertNoVrmaLeak();

    // ── Awareness tick (throttled ~500ms — does NOT run every frame) ──────────
    {
      const _awareNow = masterClockNowMs();
      const _awareLast = lastAwarenessTickMsRef.current;
      if (_awareLast === 0 || _awareNow - _awareLast >= 500) {
        const _awareDtSec = _awareLast === 0 ? 0.5 : (_awareNow - _awareLast) / 1000;
        lastAwarenessTickMsRef.current = _awareNow;
        tickAwareness(_awareDtSec);
      }
    }

    updateIntentFromBehaviorBrain(safeDelta);
    const t = sessionElapsedSec();
    const m = bindRef.current;

    // ─── Guard: bones not yet cached (useEffect hasn't run yet, or VRM
    //     lacks humanoid). Still call vrm.update so expressions/morphs work,
    //     but skip all procedural bone manipulation to avoid null-ref spam.
    if (!ruaRef.current) {
      if (isAvatarMotionTraceOn() && motionTraceFrameRef.current % 100 === 0) {
        motionTraceStopAtGuard(
          'frame-skeleton',
          'ruaRef not cached — skip procedural bone stack (bones not ready)',
          { frame: motionTraceFrameRef.current },
        );
      }
      if (!VRM_HARD_ISOLATION) {
        vrm.update(safeDelta);
      }
      return;
    }

    const speaking = isTalkingRef.current;
    const listening = isListeningRef?.current ?? false;
    const thinking  = isThinkingRef?.current  ?? false;
    const motorMul = motorSpeedMulRef?.current ?? 1;
    const nowMs = masterClockNowMs();

    if (
      RUN_LOCAL_AXIS_CALIBRATION &&
      !localAxisCalibDoneRef.current &&
      localAxisCalibStartMsRef.current === null
    ) {
      localAxisCalibStartMsRef.current = nowMs;
      // eslint-disable-next-line no-console -- intentional live diagnostic
      console.info(
        '[LocalAxisCalib] 3s sequence: +0.5 rad local X → Y → Z on rightUpperArm (bind-relative). Collision correction for RUA disabled during test.',
      );
    }

    const localAxisCalibElapsedMs =
      RUN_LOCAL_AXIS_CALIBRATION &&
      localAxisCalibStartMsRef.current != null &&
      !localAxisCalibDoneRef.current
        ? nowMs - localAxisCalibStartMsRef.current
        : -1;
    const localAxisCalibActive =
      localAxisCalibElapsedMs >= 0 && localAxisCalibElapsedMs < LOCAL_AXIS_CALIB_DURATION_MS;

    const analyserNode = analyserRef?.current ?? null;
    let audioRms01 = 0;
    let audioRmsSource: 'analyser' | 'emergency' | 'silent' = 'silent';
    // Read RMS any time the analyser exists (not only when speaking) so energy
    // updates the moment audio begins, before the `speaking` flag propagates.
    if (analyserNode) {
      audioRms01 = readAnalyserRms01(analyserNode, timeDomainBufRef);
      audioRmsSource = 'analyser';
    } else if (speaking) {
      // Emergency-only fallback: brain says we're speaking but the <audio> isn't wired
      // to the analyser yet. Use a small constant (0.20) so motion isn't fully dead;
      // real RMS takes over once the analyser hooks up (usually within 1–2 frames).
      audioRms01 = 0.20;
      audioRmsSource = 'emergency';
    }
    const brainSnap = useBrainStore.getState();
    const gf = getGlobalFrame();
    const behaviorIntensity =
      typeof gf?.intent?.intensity === 'number' && Number.isFinite(gf.intent.intensity)
        ? gf.intent.intensity
        : brainSnap.intentEnergy;
    tickUnifiedEnergy({
      intentEnergy: brainSnap.intentEnergy,
      behaviorIntensity,
      audioRms01,
      speaking,
      delta: safeDelta,
    });
    patchSpeechEmotionEnergy(getSmoothedUnifiedEnergy());
    const speechDriveSnap = getSpeechDriveSnapshot(speaking);
    if (speaking) {
      logDebugThrottledCallback('MOTION', 'motion-intensity', 800, () => {
        logDebug('MOTION', '[MOTION_INTENSITY]', {
          unifiedEnergy: getSmoothedUnifiedEnergy(),
          speechDriveEnergy: speechDriveSnap.energy,
        });
      });
      // [MOTION_AUDIO] — RMS → motion amplitude mapping (always-on, throttled 800ms).
      logDebugThrottledCallback('MOTION', 'motion-audio', 800, () => {
        // Map RMS → amplitude with a gentle expander so:
        //   rms 0.0 → amp 0.30 (subtle baseline while speaking)
        //   rms 0.2 → amp ~0.55
        //   rms 0.5 → amp ~1.00
        //   rms 1.0 → amp 1.40 (clamped expressive ceiling)
        const amplitude = Math.min(1.4, 0.30 + audioRms01 * 1.4);
        // eslint-disable-next-line no-console -- audio pipeline checkpoint (throttled 800ms)
        console.log('[MOTION_AUDIO]', {
          rms: Number(audioRms01.toFixed(3)),
          amplitude: Number(amplitude.toFixed(3)),
          source: audioRmsSource,
          analyserWired: !!analyserNode,
        });
      });
    }
    const motionBlend = brainSnap.behaviorMotionBlend;
    const intentFallback = getSmoothedUnifiedEnergy();
    let gestureAmp = speaking ? (motionBlend?.amplitude ?? 1) * motorMul : 1;

    if (AVATAR_BEHAVIOR_SINGLE_CONTROLLER) {
      const ab = brainSnap.avatarBehavior;
      if (ab.gaze === 'focus') {
        headposeYawRef.current = THREE.MathUtils.lerp(headposeYawRef.current, 0.09, Math.min(1, safeDelta * 2.2));
        headposePitchRef.current = THREE.MathUtils.lerp(headposePitchRef.current, 0, Math.min(1, safeDelta * 2.2));
        headposeBlendRef.current = Math.max(headposeBlendRef.current, 0.55);
        headposeUntilMsRef.current = Math.max(headposeUntilMsRef.current, nowMs + 1200);
      }
      if (ab.gesture === 'talk' && speaking) {
        gestureAmplitudeMulRef.current = Math.max(gestureAmplitudeMulRef.current, 0.88);
      }
      if (ab.pose === 'thinking' && gestureStateRef.current === 'idle' && !thinkGestureActiveRef.current) {
        thinkGestureActiveRef.current = true;
        gestureStateRef.current = 'think';
        gestureStartRef.current = nowMs;
        gestureAmplitudeMulRef.current = Math.max(gestureAmplitudeMulRef.current, 0.75);
        gestureDurationRef.current = 3000;
      }
    }

    voiceHeadPitchSmRef.current = THREE.MathUtils.lerp(voiceHeadPitchSmRef.current, 0, Math.min(1, safeDelta * 9));
    voiceHeadYawSmRef.current = THREE.MathUtils.lerp(voiceHeadYawSmRef.current, 0, Math.min(1, safeDelta * 9));

    // ── Micro-nudge decay ─────────────────────────────────────────────────────
    const mn = microNudgeRef.current;
    const microActive = nowMs < mn.untilMs;
    if (!microActive && mn.blend > 0.005) {
      mn.blend = THREE.MathUtils.lerp(mn.blend, 0, Math.min(1, safeDelta * 6));
    } else if (!microActive) {
      mn.blend = 0;
    }

    // ── avatar:headpose overlay decay ─────────────────────────────────────────
    const hpActive = nowMs < headposeUntilMsRef.current;
    if (!hpActive && headposeBlendRef.current > 0.005) {
      headposeBlendRef.current = THREE.MathUtils.lerp(headposeBlendRef.current, 0, Math.min(1, safeDelta * 2.5));
    } else if (!hpActive) {
      headposeBlendRef.current = 0;
    }

    const vrmaPlaybackFrozen = isVrmaPlaybackGloballyDisabled();
    // vrmaActiveEarly must also respect the procedural-only flag — otherwise thinking gestures are blocked.
    const _proceduralOnlyEarly = isProceduralOnlyMotion();
    const vrmaActiveEarly = (vrmaActiveRef?.current ?? false) && !vrmaPlaybackFrozen && !_proceduralOnlyEarly;
    if (vrmaActiveEarly && gestureStateRef.current === 'think') {
      thinkGestureActiveRef.current = false;
      gestureStateRef.current = 'idle';
    }

    // ─── Thinking auto-gesture: fire 'think' only when gesture is idle ─────────
    // Policy: skeleton won't override an orchestrated gesture; only fills idle slot.
    // When VRMA already plays Thinking, skip procedural think — avoids arm/head fight with mixer.
    const gestureIsIdle = gestureStateRef.current === 'idle';
    if (thinking && gestureIsIdle && !thinkGestureActiveRef.current && !vrmaActiveEarly) {
      thinkGestureActiveRef.current = true;
      gestureStateRef.current = 'think';
      gestureStartRef.current = nowMs;
      gestureAmplitudeMulRef.current = 0.75;
      gestureDurationRef.current = 3000;
    } else if (!thinking && thinkGestureActiveRef.current) {
      thinkGestureActiveRef.current = false;
      if (gestureStateRef.current === 'think') {
        gestureStateRef.current = 'idle';
      }
    }

    // ─── Nod system: while speaking (3–7s) and while listening (5–9s, lighter) ─
    if (speaking || listening) {
      if (nextNodAtMsRef.current === 0) {
        nextNodAtMsRef.current = nowMs + (speaking ? 4000 : 7000);
      }
      if (nowMs >= nextNodAtMsRef.current && nodPhaseRef.current <= 0) {
        nodPhaseRef.current = 0.001;
        const nodInterval = speaking ? 4000 : 7000;
        nextNodAtMsRef.current = nowMs + nodInterval;
      }
    } else {
      nextNodAtMsRef.current = 0;
    }
    if (nodPhaseRef.current > 0) {
      nodPhaseRef.current += safeDelta * 8; // ~0.4s full nod cycle
      nodPitchRef.current = Math.sin(nodPhaseRef.current) * 0.08; // ±4.5° pitch
      if (nodPhaseRef.current > Math.PI) {
        nodPhaseRef.current = 0;
        nodPitchRef.current = 0;
      }
    } else {
      nodPitchRef.current = 0;
    }

    // ─── Gesture state machine + motion source (decision layer) ─────────────
    const proceduralOnly = isProceduralOnlyMotion();
    const vrmaActive = (vrmaActiveRef?.current ?? false) && !vrmaPlaybackFrozen && !proceduralOnly;
    const rawG = gestureStateRef.current;
    let motionSource: ProceduralMotionSource = vrmaActive
      ? 'VRMA'
      : rawG !== 'idle'
        ? 'GESTURE'
        : 'IDLE';
    if (VRMA_ISOLATION_TEST && !vrmaPlaybackFrozen && !proceduralOnly) {
      motionSource = 'VRMA';
    }
    if (vrmaPlaybackFrozen && motionSource === 'VRMA') {
      motionSource = rawG !== 'idle' ? 'GESTURE' : 'IDLE';
    }
    if (proceduralOnly && motionSource === 'VRMA') {
      motionSource = rawG !== 'idle' ? 'GESTURE' : 'IDLE';
    }
    const g = rawG;

    if (motionSource === 'IDLE' && prevMotionSourceRef.current === 'GESTURE') {
      idleArmEaseFromMsRef.current = nowMs;
    }

    const elapsed = nowMs - gestureStartRef.current;
    const dur = Math.max(1, gestureDurationRef.current);
    let progress = Math.min(1, elapsed / dur);
    if (!vrmaActive && g !== 'idle' && progress >= 1) {
      if (process.env.NODE_ENV === 'development') {
        avatarDebug('[Gesture] Transition to idle after duration');
      }
      gestureStateRef.current = 'idle';
      progress = 0;
    }

    const isProceduralGestureFrame = motionSource === 'GESTURE';
    /** إيماءة إجرائية تُطبَّق هذا الإطار — يمنع idle / تصادم / generative للأذراع. */
    const isGestureActive = isProceduralGestureFrame;
    const isTestElbowGesture = gestureStateRef.current === 'test_elbow';
    const fadeIn  = isProceduralGestureFrame
      ? THREE.MathUtils.smoothstep(progress, 0, GESTURE_FADE_IN_END)
      : 0;
    const fadeOut = isProceduralGestureFrame
      ? 1 - THREE.MathUtils.smoothstep(progress, GESTURE_FADE_OUT_START, 1)
      : 0;
    const gBlend  = fadeIn * fadeOut;

    // Anticipation (wind-up) + follow-through (ذروة خفيفة قبل الذوبان)
    let antStrength = 0;
    if (g !== 'idle' && progress < GESTURE_ANT_FRAC) {
      const antT = progress / GESTURE_ANT_FRAC;
      // ★ BIO: ease-out power curve — fast attack, slow organic release
      antStrength = 1 - THREE.MathUtils.smoothstep(Math.pow(antT, BIO_ANT_CURVE_POW), 0, 1);
    }
    const followStart = 1 - GESTURE_FOLLOW_FRAC;
    let followBell = 0;
    if (g !== 'idle' && progress > followStart) {
      const u = THREE.MathUtils.smoothstep((progress - followStart) / GESTURE_FOLLOW_FRAC, 0, 1);
      followBell = Math.sin(Math.PI * u) * fadeOut;
    }
    // ★ BIO: follow-through overshoot — arm swings slightly past target then decays
    const armBlendMul = 1 + (FOLLOW_ARM_BLEND_BUMP + BIO_FOLLOW_OVERSHOOT) * followBell;
    const gArm = gBlend * armBlendMul;

    // FIX 2: per-instance amplitude multiplier — applied to ALL arm rotations.
    // Only active during non-idle gestures; decays smoothly toward 1.0 on decay phase
    // so it doesn't distort the idle return animation.
    const _ampRaw = gestureAmplitudeMulRef.current;
    // Blend amplitude: full during attack, fades to 1.0 during decay
    const _ampBlend = isProceduralGestureFrame ? gBlend : 0;
    const gAmp = 1.0 + (_ampRaw - 1.0) * _ampBlend; // interpolates between 1.0 and _ampRaw

    // ── PHASE 2: GESTURE INTENT CURVE ─────────────────────────────────────────
    // Computes intentBlend + slerpMul + holdOsc from a 4-phase model.
    // intentBlend REPLACES gBlend on arm bones only (head/spine keep gBlend).
    // slerpMul is multiplied into the armK base computed by FIX-1.
    const _isIdle = !isProceduralGestureFrame;
    const { intentBlend: _ib, slerpMul: intentSlerpMul, holdOsc } =
      computeIntentCurve(progress, t, _isIdle);
    // Scale intentBlend by per-instance amplitude (FIX 2 interaction)
    const intentBlend = _ib * gAmp;
    // Follow-through overshoot still applies on top of intentBlend during attack/hold
    const intentArm = intentBlend * armBlendMul;

    if (typeof window !== 'undefined') {
      (window as Window & { __avatarSkeletonGesture?: GestureId }).__avatarSkeletonGesture =
        motionSource === 'VRMA' ? 'idle' : g;
    }
    /** agree/think/explain: تقليل ضوضاء الرأس والنظرة البروسيجرالية لتقليل الاهتزاز */
    const procHeadNoise = g === 'agree' || g === 'think' ? 0 : g === 'explain' ? 0.3 : 1;
    const procHeadGaze  = g === 'agree' ? 0.1 : (g === 'think' || g === 'explain') ? 0.28 : 1;
    const bsMot = useBrainStore.getState();
    const presBaseSm = getBlendedIntentPresentation({
      committedIntent: bsMot.interactionIntent,
      visualFromIntent: bsMot.intentVisualFrom,
      visualBlend01: bsMot.intentVisualBlend01,
    });
    const cbMot = bsMot.cognitiveAvatarBrain;
    const presPersonality = modulatePresentationForPersonality(
      presBaseSm,
      cbMot.effectiveTraits,
      cbMot.personality.motionSignature,
    );
    const idMul =
      (0.9 + 0.18 * getSmoothedUnifiedEnergy()) *
      (bsMot.interactionIntent === 'emphasizing' ? 1.07 : 1);
    const pres = {
      ...presPersonality,
      headNoiseMul: presPersonality.headNoiseMul * idMul,
      headGazeMul: presPersonality.headGazeMul * idMul,
      humanIdleNeckMul: presPersonality.humanIdleNeckMul * idMul,
      animationSaccadeMul: presPersonality.animationSaccadeMul * idMul,
    };
    const procHeadNoiseI = procHeadNoise * pres.headNoiseMul;
    const procHeadGazeI = procHeadGaze * pres.headGazeMul;

    if (g !== lastEffGestureRef.current) {
      gestureCrossfadeStartMsRef.current = masterClockNowMs();
      if (process.env.NODE_ENV === 'development') {
        if (g !== 'idle') {
          avatarDebug('[VRMSkeletonManager] ▶ Gesture START:', g,
            '| autoUpdateHumanBones:', vrm.humanoid?.autoUpdateHumanBones);
        } else {
          avatarDebug('[VRMSkeletonManager] ⏹ Gesture END — returning to idle');
        }
      }
      lastEffGestureRef.current = g;
    }
    if (g !== 'idle') {
      idleVariantNextSwitchRef.current = 0;
    }

    /** بعد انتهاء GESTURE → IDLE: يبطّئ slerp الأذراع قليلاً ثم يصل إلى 1 (ease-out). */
    let idleArmEaseMul = 1;
    if (motionSource === 'IDLE') {
      const u = (nowMs - idleArmEaseFromMsRef.current) / GESTURE_TO_IDLE_EASE_MS;
      if (u > 0 && u < 1) {
        idleArmEaseMul = 0.3 + 0.7 * (1 - Math.pow(1 - u, 3));
      }
    }

    /** Persistent generative targets — no time-based fade; release via `avatar:generative:reset`. */
    const genMix =
      generativeBonesRef.current.size > 0
        ? THREE.MathUtils.clamp(generativeBlendRef.current, 0, 1)
        : 0;

    const idlePose = idlePoseScratchRef.current;
    idlePose.clear();
    const gesturePose = gesturePoseScratchRef.current;
    gesturePose.clear();
    const collisionPose = collisionPoseScratchRef.current;
    collisionPose.clear();
    const generativePose = generativePoseScratchRef.current;
    generativePose.clear();

    const resolveGenerativeObject = (pk: string): THREE.Object3D | null => {
      switch (pk) {
        case 'rua':
          return ruaRef.current;
        case 'lua':
          return luaRef.current;
        case 'rla':
          return rlaRef.current;
        case 'lla':
          return llaRef.current;
        case 'rh':
          return rhRef.current;
        case 'lh':
          return lhRef.current;
        case 'spine':
          return spineRef.current;
        case 'chest':
          return chestRef.current;
        case 'neck':
          return neckRef.current;
        case 'head':
          return headRef.current;
        case 'hips':
          return hipsRef.current;
        case 'leftShoulder':
          return leftShoulderRef.current;
        case 'rightShoulder':
          return rightShoulderRef.current;
        default:
          return extraGenerativeNodesRef.current.get(pk) ?? null;
      }
    };

    // ─── Procedural bones (poses only; VRMA merged in PoseComposer) ───
    if (motionSource !== 'VRMA') {

    // ─── Breathing — rate and amplitude scale with motorMul (PAD arousal) ───
    // High arousal → faster, shallower breath. Low arousal → slow, deeper.
    const breathEmo = getBreathEmotionRateMul();
    const breathRate  = BREATHE_SPEED_A * (0.7 + motorMul * 0.5) * breathEmo;   // 0.56–1.19 Hz × mood
    const breathRateB = BREATHE_SPEED_B * (0.7 + motorMul * 0.5) * breathEmo;
    const breathAmpMul = 0.55 * (0.8 + motorMul * 0.35);            // 0.44–0.74 scale
    const b1 = Math.sin(t * breathRate);
    const b2 = Math.sin(t * breathRateB + 0.35) * 0.32;
    const b3 = noiseBreath(t * 0.38, 2.2, 0) * 0.14;
    const breath = (b1 + b2 + b3) * breathAmpMul;
    const breatheChest =
      (Math.sin((t - CHEST_PHASE_LAG_SEC) * breathRate) +
       Math.sin((t - CHEST_PHASE_LAG_SEC) * breathRateB + 0.35) * 0.32 +
       noiseBreath((t - CHEST_PHASE_LAG_SEC) * 0.38, 2.2, 0) * 0.14) * breathAmpMul;

    /** Humanization: sway / saccade / spine breath / shoulder coupling — idle only (VRMA unchanged). */
    const idleHuman = motionSource === 'IDLE' && !FREEZE_IDLE_ANIMATIONS;
    /**
     * With VRMA frozen, procedural gestures no longer sit on a looping body clip — keep spine/chest
     * sinusoidal breath during GESTURE so think/listen/speak don’t look rigid.
     */
    const allowProceduralTorsoBreath =
      !FREEZE_IDLE_ANIMATIONS && (idleHuman || (vrmaPlaybackFrozen && motionSource === 'GESTURE'));

    const voiceShoulderAdd = speaking ? (motionBlend?.intentWeight ?? intentFallback) * 0.0085 : 0;
    const breathShoulderLift = allowProceduralTorsoBreath ? breath * BIO_BREATHE_SHLDR + voiceShoulderAdd : 0;
    const breathArmDrift     = idleHuman ? breath * BIO_BREATHE_ARM : 0;

    if (allowProceduralTorsoBreath) {
      const spineBind = m.get('spine');
      if (spineRef.current && spineBind) {
        const ax = breath * BREATHE_SPINE_AMP * 1.06;
        SK_Q.setFromAxisAngle(SK_AXIS_X, ax);
        SK_Q2.copy(spineBind).multiply(SK_Q);
        idlePose.set('spine', SK_Q2.clone());
      }
      const chestBind = m.get('chest');
      if (chestRef.current && chestBind) {
        const ax =
          breatheChest * BREATHE_CHEST_AMP + (speaking ? (motionBlend?.intentWeight ?? intentFallback) * 0.016 : 0);
        SK_Q.setFromAxisAngle(SK_AXIS_X, ax);
        SK_Q2.copy(chestBind).multiply(SK_Q);
        idlePose.set('chest', SK_Q2.clone());
      }
    }

    // ─── Head / Neck noise sway (idle only — keeps VRMA + gesture head clean) ─
    const nx = idleHuman ? noiseHead(t * HEAD_NOISE_SPEED, 0.3, 0) * HEAD_SWAY_AMP * procHeadNoiseI : 0;
    const ny = idleHuman ? noiseHead(0.4, t * HEAD_NOISE_SPEED, 0) * HEAD_SWAY_AMP * procHeadNoiseI : 0;
    const nz = idleHuman ? noiseHead(t * 0.41, 9.1, 0) * HEAD_SWAY_AMP * 0.35 * procHeadNoiseI : 0;

    const humanIdleNeckX =
      idleHuman ? Math.sin(t * HUMAN_IDLE_NECK_PITCH_FREQ + 0.4) * HUMAN_IDLE_NECK_PITCH_AMP * pres.humanIdleNeckMul : 0;
    const humanIdleNeckY =
      idleHuman ? Math.sin(t * HUMAN_IDLE_NECK_YAW_FREQ + 1.1) * HUMAN_IDLE_NECK_YAW_AMP * pres.humanIdleNeckMul : 0;
    const humanIdleNeckZ =
      idleHuman ? Math.sin(t * HUMAN_IDLE_NECK_ROLL_FREQ + 0.6) * HUMAN_IDLE_NECK_ROLL_AMP * pres.humanIdleNeckMul : 0;

    let userAttentionFocus = false;
    let eyeContactNeckPitchBias = 0;
    let eyeContactNeckYawBias = 0;
    /** User emotional mirroring — subtle head tilt / lean while listening */
    let mirrorNeckYaw = 0;
    let mirrorNeckPitch = 0;

    // ★ BIO: subtle neck saccade + idle attention (drift / delayed head / micro eye gaze) — IDLE motion only
    let idleGazeNeckYaw = 0;
    let idleGazeNeckPitch = 0;
    let idleGazeHeadYaw = 0;
    let idleGazeHeadPitch = 0;
    if (idleHuman) {
      const bsAtt = useBrainStore.getState();
      userAttentionFocus =
        (isListeningRef?.current ?? false)
        || bsAtt.interactionIntent === 'listening'
        || bsAtt.isUserSpeaking;
      const focusUserAttention = userAttentionFocus;
      const perceptionCamLive =
        typeof window !== 'undefined' &&
        (window as Window & { __cogniPerceptionCameraLive?: boolean }).__cogniPerceptionCameraLive === true;
      const saccadeAmpMul = perceptionCamLive ? 1 : 1.45;
      const saccadeIvalMin = perceptionCamLive ? BIO_SACCADE_IVAL_MIN : 2800;
      const saccadeIvalMax = perceptionCamLive ? BIO_SACCADE_IVAL_MAX : 6500;
      const idleGazeApplyMul = focusUserAttention ? 0.22 : 1;
      const driftPickScale = focusUserAttention ? 0.08 : 1;

      if (focusUserAttention) {
        const ume = bsAtt.userMirrorEmotion;
        if (ume === 'confused') mirrorNeckYaw = 0.034;
        else if (ume === 'frustrated') mirrorNeckPitch = -0.016;
        else if (ume === 'excited') mirrorNeckPitch = 0.01;
        else if (ume === 'calm') mirrorNeckPitch = 0.008;
      }

      if (idleGazeDriftNextMsRef.current === 0) {
        idleGazeDriftNextMsRef.current =
          nowMs +
          IDLE_GAZE_DRIFT_IVAL_MS_MIN +
          Math.random() * (IDLE_GAZE_DRIFT_IVAL_MS_MAX - IDLE_GAZE_DRIFT_IVAL_MS_MIN);
      }
      if (nowMs >= idleGazeDriftNextMsRef.current) {
        idleGazeDriftTgtYawRef.current =
          (Math.random() - 0.5) * 2 * IDLE_GAZE_DRIFT_AMP * driftPickScale;
        idleGazeDriftTgtPitchRef.current =
          (Math.random() - 0.5) * 2 * IDLE_GAZE_DRIFT_AMP * driftPickScale;
        idleGazeDriftNextMsRef.current =
          nowMs +
          IDLE_GAZE_DRIFT_IVAL_MS_MIN +
          Math.random() * (IDLE_GAZE_DRIFT_IVAL_MS_MAX - IDLE_GAZE_DRIFT_IVAL_MS_MIN);
      }
      if (focusUserAttention) {
        idleGazeDriftTgtYawRef.current = THREE.MathUtils.lerp(
          idleGazeDriftTgtYawRef.current,
          0,
          Math.min(1, safeDelta * 1.1),
        );
        idleGazeDriftTgtPitchRef.current = THREE.MathUtils.lerp(
          idleGazeDriftTgtPitchRef.current,
          0,
          Math.min(1, safeDelta * 1.1),
        );
      }

      const driftK = Math.min(1, safeDelta * IDLE_GAZE_DRIFT_LERP_SPEED);
      idleGazeDriftYawRef.current = THREE.MathUtils.lerp(
        idleGazeDriftYawRef.current,
        idleGazeDriftTgtYawRef.current,
        driftK,
      );
      idleGazeDriftPitchRef.current = THREE.MathUtils.lerp(
        idleGazeDriftPitchRef.current,
        idleGazeDriftTgtPitchRef.current,
        driftK,
      );

      const headDelayA = 1 - Math.exp(-safeDelta / IDLE_GAZE_HEAD_DELAY_TAU);
      idleGazeHeadDlyYawRef.current = THREE.MathUtils.lerp(
        idleGazeHeadDlyYawRef.current,
        idleGazeDriftYawRef.current,
        headDelayA,
      );
      idleGazeHeadDlyPitchRef.current = THREE.MathUtils.lerp(
        idleGazeHeadDlyPitchRef.current,
        idleGazeDriftPitchRef.current,
        headDelayA,
      );

      const moodMotionMul = getMoodMotionScale();
      idleGazeNeckYaw =
        idleGazeDriftYawRef.current * idleGazeApplyMul * pres.humanIdleNeckMul * moodMotionMul;
      idleGazeNeckPitch =
        idleGazeDriftPitchRef.current * idleGazeApplyMul * pres.humanIdleNeckMul * moodMotionMul;
      idleGazeHeadYaw =
        idleGazeHeadDlyYawRef.current *
        IDLE_GAZE_HEAD_FOLLOW *
        idleGazeApplyMul *
        pres.humanIdleNeckMul *
        moodMotionMul;
      idleGazeHeadPitch =
        idleGazeHeadDlyPitchRef.current *
        IDLE_GAZE_HEAD_FOLLOW *
        idleGazeApplyMul *
        pres.humanIdleNeckMul *
        moodMotionMul;

      if (typeof window !== 'undefined' && !focusUserAttention) {
        if (idleMicroGazeNextMsRef.current === 0) {
          idleMicroGazeNextMsRef.current =
            nowMs +
            IDLE_MICRO_GAZE_IVAL_MS_MIN +
            Math.random() * (IDLE_MICRO_GAZE_IVAL_MS_MAX - IDLE_MICRO_GAZE_IVAL_MS_MIN);
        }
        if (nowMs >= idleMicroGazeNextMsRef.current) {
          idleMicroGazeNextMsRef.current =
            nowMs +
            IDLE_MICRO_GAZE_IVAL_MS_MIN +
            Math.random() * (IDLE_MICRO_GAZE_IVAL_MS_MAX - IDLE_MICRO_GAZE_IVAL_MS_MIN);
          window.dispatchEvent(
            new CustomEvent('avatar:gaze', {
              detail: {
                yaw: (Math.random() - 0.5) * 2 * IDLE_MICRO_GAZE_AMP,
                pitch: (Math.random() - 0.5) * 2 * IDLE_MICRO_GAZE_AMP,
                durationMs:
                  IDLE_MICRO_GAZE_DUR_MS_MIN +
                  Math.random() * (IDLE_MICRO_GAZE_DUR_MS_MAX - IDLE_MICRO_GAZE_DUR_MS_MIN),
              },
            }),
          );
        }
      } else {
        idleMicroGazeNextMsRef.current = 0;
      }

      if (saccadeNextMsRef.current === 0) {
        saccadeNextMsRef.current = nowMs + saccadeIvalMin + Math.random() * (saccadeIvalMax - saccadeIvalMin);
      }
      if (nowMs >= saccadeNextMsRef.current) {
        saccadeTgtXRef.current = (Math.random() - 0.5) * 2 * BIO_SACCADE_AMP * saccadeAmpMul;
        saccadeTgtYRef.current = (Math.random() - 0.5) * 2 * BIO_SACCADE_AMP * 0.7 * saccadeAmpMul;
        saccadeNextMsRef.current = nowMs + saccadeIvalMin + Math.random() * (saccadeIvalMax - saccadeIvalMin);
      }
      saccadeXRef.current = THREE.MathUtils.lerp(saccadeXRef.current, saccadeTgtXRef.current, Math.min(1, safeDelta * BIO_SACCADE_SPEED));
      saccadeYRef.current = THREE.MathUtils.lerp(saccadeYRef.current, saccadeTgtYRef.current, Math.min(1, safeDelta * BIO_SACCADE_SPEED));
      saccadeTgtXRef.current = THREE.MathUtils.lerp(saccadeTgtXRef.current, 0, Math.min(1, safeDelta * BIO_SACCADE_DECAY));
      saccadeTgtYRef.current = THREE.MathUtils.lerp(saccadeTgtYRef.current, 0, Math.min(1, safeDelta * BIO_SACCADE_DECAY));

      eyeContactPoseBlendRef.current = THREE.MathUtils.lerp(
        eyeContactPoseBlendRef.current,
        userAttentionFocus ? 1 : 0,
        Math.min(1, safeDelta * 2.8),
      );
      const ecb = eyeContactPoseBlendRef.current;
      eyeContactNeckPitchBias = -0.024 * ecb;
      eyeContactNeckYawBias = 0;
      if (ecb > 0.06 && headRef.current && hipsRef.current) {
        headRef.current.getWorldDirection(_EC_FWD);
        hipsRef.current.getWorldPosition(_EC_HIP);
        _EC_TO_CAM.copy(camera.position).sub(_EC_HIP);
        _EC_FWD.y = 0;
        _EC_TO_CAM.y = 0;
        if (_EC_FWD.lengthSq() > 1e-8 && _EC_TO_CAM.lengthSq() > 1e-8) {
          _EC_FWD.normalize();
          _EC_TO_CAM.normalize();
          const crossY = _EC_FWD.x * _EC_TO_CAM.z - _EC_FWD.z * _EC_TO_CAM.x;
          const dot = THREE.MathUtils.clamp(_EC_FWD.dot(_EC_TO_CAM), -1, 1);
          const yawErr = Math.atan2(crossY, dot);
          eyeContactNeckYawBias = THREE.MathUtils.clamp(yawErr * 0.16, -0.042, 0.042) * ecb;
        }
      }
    } else {
      eyeContactPoseBlendRef.current = THREE.MathUtils.lerp(
        eyeContactPoseBlendRef.current,
        0,
        Math.min(1, safeDelta * 3.6),
      );
      saccadeXRef.current = THREE.MathUtils.lerp(saccadeXRef.current, 0, Math.min(1, safeDelta * 5));
      saccadeYRef.current = THREE.MathUtils.lerp(saccadeYRef.current, 0, Math.min(1, safeDelta * 5));
      saccadeTgtXRef.current = 0;
      saccadeTgtYRef.current = 0;
      idleGazeDriftYawRef.current = THREE.MathUtils.lerp(idleGazeDriftYawRef.current, 0, Math.min(1, safeDelta * 4));
      idleGazeDriftPitchRef.current = THREE.MathUtils.lerp(idleGazeDriftPitchRef.current, 0, Math.min(1, safeDelta * 4));
      idleGazeDriftTgtYawRef.current = 0;
      idleGazeDriftTgtPitchRef.current = 0;
      idleGazeDriftNextMsRef.current = 0;
      idleGazeHeadDlyYawRef.current = THREE.MathUtils.lerp(idleGazeHeadDlyYawRef.current, 0, Math.min(1, safeDelta * 4));
      idleGazeHeadDlyPitchRef.current = THREE.MathUtils.lerp(idleGazeHeadDlyPitchRef.current, 0, Math.min(1, safeDelta * 4));
      idleMicroGazeNextMsRef.current = 0;
    }

    const saccadeBoneAtten = idleHuman && userAttentionFocus ? 0.4 : 1;
    const gYaw =
      (neckGazeYawRef.current +
        (idleHuman ? saccadeYRef.current * pres.saccadeMul * saccadeBoneAtten : 0)) *
      procHeadGazeI;
    const gPitch =
      (neckGazePitchRef.current +
        (idleHuman ? saccadeXRef.current * pres.saccadeMul * saccadeBoneAtten : 0)) *
      procHeadGazeI;

    // ─── VRMA neck / head offsets during gestures ───────────────────────────
    const thinkNkX = g === 'think' ? THINK_NECK_X * gBlend : 0;
    const thinkNkY = g === 'think' ? THINK_NECK_Y * gBlend : 0;
    const thinkNkZ = g === 'think' ? THINK_NECK_Z * gBlend : 0;
    const thinkHdX = g === 'think' ? THINK_HEAD_X * gBlend : 0;
    const thinkHdY = g === 'think' ? THINK_HEAD_Y * gBlend : 0;
    const thinkHdZ = g === 'think' ? THINK_HEAD_Z * gBlend : 0;

    const waveNkX = g === 'wave' ? WAVING_NECK_X * gBlend : 0;
    const waveNkY = g === 'wave' ? WAVING_NECK_Y * gBlend : 0;
    const waveNkZ = g === 'wave' ? WAVING_NECK_Z * gBlend : 0;
    const waveHdX = g === 'wave' ? WAVING_HEAD_X * gBlend : 0;
    const waveHdY = g === 'wave' ? WAVING_HEAD_Y * gBlend : 0;
    const waveHdZ = g === 'wave' ? WAVING_HEAD_Z * gBlend : 0;

    const clapNkX = g === 'clap' ? CLAPPING_NECK_X * gBlend : 0;
    const clapNkY = g === 'clap' ? CLAPPING_NECK_Y * gBlend : 0;
    const clapNkZ = g === 'clap' ? CLAPPING_NECK_Z * gBlend : 0;
    const clapHdX = g === 'clap' ? CLAPPING_HEAD_X * gBlend : 0;
    const clapHdY = g === 'clap' ? CLAPPING_HEAD_Y * gBlend : 0;
    const clapHdZ = g === 'clap' ? CLAPPING_HEAD_Z * gBlend : 0;

    const agreeNkX = 0;
    const agreeNkY = 0;
    const agreeNkZ = 0;
    const agreeHdX = 0;
    const agreeHdY = 0;
    const agreeHdZ = 0;

    // neck/head: gaze + noise + gesture offsets + headpose (pitch→X, yaw→Y — listening forward uses yaw).
    const hpB = headposeBlendRef.current;
    const hpNeckX = headposePitchRef.current * hpB * 0.85;
    const hpNeckY = headposeYawRef.current * hpB * 0.85;
    const hpHeadX = headposePitchRef.current * hpB * 0.55;
    const hpHeadY = headposeYawRef.current * hpB * 0.55;

    /** Brief `avatar:micro:gesture` offsets — amplitudeMul from TTS bridge; hard-capped so one event cannot own the head. */
    const mz = microNudgeRef.current;
    const mzb = mz.blend;
    const MICRO_GESTURE_AXIS_CAP = 0.052;
    const microNkX = THREE.MathUtils.clamp(mz.neckX * mzb, -MICRO_GESTURE_AXIS_CAP, MICRO_GESTURE_AXIS_CAP);
    const microNkY = THREE.MathUtils.clamp(mz.neckY * mzb, -MICRO_GESTURE_AXIS_CAP, MICRO_GESTURE_AXIS_CAP);
    const microHdX = THREE.MathUtils.clamp(mz.headX * mzb, -MICRO_GESTURE_AXIS_CAP, MICRO_GESTURE_AXIS_CAP);

    const neckBind = m.get('neck');
    const headNeckPose = isProceduralGestureFrame ? gesturePose : idlePose;
    if (neckRef.current && neckBind) {
      const [cnx, cny, cnz] = clampNeckEuler(
        nx * NECK_SWAY_MUL +
          gPitch * 0.48 +
          idleGazeNeckPitch +
          mirrorNeckPitch +
          eyeContactNeckPitchBias +
          thinkNkX +
          waveNkX +
          clapNkX +
          agreeNkX +
          hpNeckX +
          microNkX +
          humanIdleNeckX +
          voiceHeadPitchSmRef.current,
        ny * NECK_SWAY_MUL +
          gYaw * 0.48 +
          idleGazeNeckYaw +
          mirrorNeckYaw +
          eyeContactNeckYawBias +
          thinkNkY +
          waveNkY +
          clapNkY +
          agreeNkY +
          hpNeckY +
          microNkY +
          humanIdleNeckY +
          voiceHeadYawSmRef.current,
        nz * NECK_SWAY_MUL + thinkNkZ + waveNkZ + clapNkZ + agreeNkZ + humanIdleNeckZ,
      );
      SK_E.set(cnx, cny, cnz, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(neckBind).multiply(SK_Q);
      headNeckPose.set('neck', SK_Q2.clone());
    }

    const headBind = m.get('head');
    if (headRef.current && headBind) {
      const [chx, chy, chz] = clampHeadEuler(
        nx * 1.05 +
          gPitch * 0.62 +
          idleGazeHeadPitch +
          eyeContactNeckPitchBias * 0.78 +
          thinkHdX +
          waveHdX +
          clapHdX +
          agreeHdX +
          hpHeadX +
          microHdX +
          humanIdleNeckX * 0.85 +
          voiceHeadPitchSmRef.current * 1.08,
        ny * 1.05 +
          gYaw * 0.62 +
          idleGazeHeadYaw +
          eyeContactNeckYawBias * 0.82 +
          thinkHdY +
          waveHdY +
          clapHdY +
          agreeHdY +
          hpHeadY +
          humanIdleNeckY * 0.85 +
          voiceHeadYawSmRef.current * 1.08,
        nz + thinkHdZ + waveHdZ + clapHdZ + agreeHdZ + humanIdleNeckZ * 0.75,
      );
      SK_E.set(chx, chy, chz, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(headBind).multiply(SK_Q);
      headNeckPose.set('head', SK_Q2.clone());
    }

    // ─── Arm pose helpers (absolute quaternions → pose maps; no bone writes) ─
    const armObjToKey = (obj: THREE.Object3D | null): string | null => {
      if (obj === ruaRef.current) return 'rua';
      if (obj === luaRef.current) return 'lua';
      if (obj === rlaRef.current) return 'rla';
      if (obj === llaRef.current) return 'lla';
      if (obj === rhRef.current) return 'rh';
      if (obj === lhRef.current) return 'lh';
      return null;
    };

    const slerpArmEuler = (
      obj: THREE.Object3D | null,
      ex: number,
      ey: number,
      ez: number,
      _legacyKMul: number,
      _isLow?: boolean,
      useIdlePose?: boolean,
    ) => {
      const key = armObjToKey(obj);
      if (!key) return;
      const map = useIdlePose ? idlePose : gesturePose;
      SK_E.set(ex, ey, ez, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      map.set(key, SK_Q.clone());
    };

    const slerpBoneFromBind = (
      obj: THREE.Object3D | null,
      bindKey: string,
      ex: number,
      ey: number,
      ez: number,
      _speed: number,
      useIdlePose = false,
    ) => {
      if (!obj) return;
      const bq = m.get(bindKey);
      if (!bq) return;
      const map = useIdlePose ? idlePose : gesturePose;
      SK_E.set(ex, ey, ez, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(bq).multiply(SK_Q);
      map.set(bindKey, SK_Q2.clone());
    };

    const slerpFingerCurl = (
      obj: THREE.Object3D | null,
      bindKey: string,
      curlAmount: number,
      _speed: number,
      useIdlePose = false,
    ) => {
      if (!obj) return;
      let bq = m.get(bindKey);
      if (!bq) {
        bq = obj.quaternion.clone();
        m.set(bindKey, bq);
      }
      const map = useIdlePose ? idlePose : gesturePose;
      SK_E.set(curlAmount, 0, 0, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(bq).multiply(SK_Q);
      map.set(bindKey, SK_Q2.clone());
    };

    const applySymmetricFingerCurl = (curl01: number, blend: number, useIdlePose = false) => {
      const v = THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curl01, 0, 1)) * blend;
      slerpFingerCurl(rIndexProximalRef.current, 'rIndexProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rRingProximalRef.current, 'rRingProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rThumbProximalRef.current, 'rThumbProximal', v * 0.55, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lIndexProximalRef.current, 'lIndexProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lRingProximalRef.current, 'lRingProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', v, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lThumbProximalRef.current, 'lThumbProximal', v * 0.55, FINGER_SLERP_SPEED, useIdlePose);
    };

    const applySplitFingerCurl = (
      curlR01: number,
      curlL01: number,
      blend: number,
      useIdlePose = false,
    ) => {
      const vR =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curlR01, 0, 1)) * blend;
      const vL =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curlL01, 0, 1)) * blend;
      slerpFingerCurl(rIndexProximalRef.current, 'rIndexProximal', vR, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', vR, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rRingProximalRef.current, 'rRingProximal', vR, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', vR, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(rThumbProximalRef.current, 'rThumbProximal', vR * 0.55, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lIndexProximalRef.current, 'lIndexProximal', vL, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', vL, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lRingProximalRef.current, 'lRingProximal', vL, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', vL, FINGER_SLERP_SPEED, useIdlePose);
      slerpFingerCurl(lThumbProximalRef.current, 'lThumbProximal', vL * 0.55, FINGER_SLERP_SPEED, useIdlePose);
    };

    // ─── Talk nudge (idle only) ─────────────────────────────────────────────
    // ★ BIO: organic sine+noise mix — less robotic, non-repeating
    const talkNudge =
      speaking && motionSource === 'IDLE'
        ? (Math.sin(t * TALK_NUDGE_FREQ) * BIO_ORG_SINE +
           noiseArm(t * BIO_ORG_NOISE_SPD, 2.7, 0) * BIO_ORG_NOISE) *
          TALK_NUDGE_AMP * gestureAmp
        : 0;
    const talkWrist =
      speaking && motionSource === 'IDLE'
        ? (Math.sin(t * TALK_WRIST_FREQ + 0.4) * BIO_ORG_SINE +
           noiseArm(t * BIO_ORG_NOISE_SPD, 6.2, 0) * BIO_ORG_NOISE) *
          TALK_WRIST_AMP * gestureAmp
        : 0;

    // ★ BIO: micro-jitter for wrists — life signal (humans never fully still)
    const wristJitterX = noiseJitter(t * BIO_JITTER_FREQ, 3.4, 0) * BIO_JITTER_WRIST;
    const wristJitterZ = noiseJitter(t * BIO_JITTER_FREQ, 7.8, 0) * BIO_JITTER_WRIST;

    // ═════════════════════════════════════════════════════════════════════════
    //  GESTURE STATE MACHINE
    // ═════════════════════════════════════════════════════════════════════════

    if (g !== 'explain') {
      const finDecay = Math.min(1, safeDelta * 5);
      explainFingerCurlSmoothRef.current = THREE.MathUtils.lerp(
        explainFingerCurlSmoothRef.current,
        0,
        finDecay,
      );
      explainFingerCurlLeftSmoothRef.current = THREE.MathUtils.lerp(
        explainFingerCurlLeftSmoothRef.current,
        0,
        finDecay,
      );
    }

    if (g === 'explain') {
      const cal = (_calibrationRef.current?.gesture === 'explain') ? _calibrationRef.current.pose : null;
      // موجة عضوية خفيفة: سعة صغيرة (0.09) وتردد منخفض (1.4 Hz) + ضوضاء لمنع التكرار.
      // لا نضرب بـ gestureAmp لأنه يضخّم الموجة حتى 2.4× أثناء الكلام (يبدو كتصفيق).
      const wave = (
        Math.sin(t * EXPLAIN_WAVE_FREQ) * BIO_ORG_SINE +
        noiseArm(t * BIO_ORG_NOISE_SPD, 1.4, 0) * BIO_ORG_NOISE
      ) * EXPLAIN_WAVE_AMP * gBlend;
      const antRua = antStrength * ANT_RUA_X_EXPLAIN;
      const eRuaX = cal ? cal.ruaX : EXPLAIN_RUA_X;
      const eRuaY = cal ? cal.ruaY : EXPLAIN_RUA_Y;
      const eRuaZ = cal ? cal.ruaZ : EXPLAIN_RUA_Z;
      const eLuaX = cal ? cal.luaX : EXPLAIN_LUA_X;
      const eLuaY = cal ? cal.luaY : EXPLAIN_LUA_Y;
      const eLuaZ = cal ? cal.luaZ : EXPLAIN_LUA_Z;
      const eRlaZ = cal ? cal.rlaZ : EXPLAIN_RLA_Z;
      const eLlaZ = cal ? cal.llaZ : EXPLAIN_LLA_Z;
      // ★ BIO: gravity droop — arm sags slightly toward down when extended
      const explainGravityZ = BIO_GRAVITY_DROOP * gBlend;
      // INTENT CURVE: intentArm = intentBlend * armBlendMul drives effective reach.
      // holdOsc adds micro-oscillation during HOLD phase — layered on top of the wave.
      const _eHold = 1 + holdOsc * 0.7; // scale wave/reach during hold
      slerpArmEuler(ruaRef.current, (eRuaX + wave * 0.4 + antRua) * _eHold, eRuaY, (eRuaZ + wave + explainGravityZ) * _eHold, 1);
      slerpArmEuler(luaRef.current, (eLuaX - wave * 0.32 - antRua) * _eHold, eLuaY, (eLuaZ - wave - explainGravityZ) * _eHold, 1);
      slerpArmEuler(rlaRef.current, EXPLAIN_RLA_X, 0, (eRlaZ - wave * 0.2) * _eHold, 1, true);
      slerpArmEuler(llaRef.current, EXPLAIN_LLA_X, 0, (eLlaZ + wave * 0.18) * _eHold, 1, true);
      // معصمان: بدون jitter لمنع الاهتزاز الدقيق
      slerpArmEuler(
        rhRef.current,
        cal ? cal.rhX : EXPLAIN_RH_X,
        cal?.rhY ?? EXPLAIN_RH_Y,
        cal ? cal.rhZ : EXPLAIN_RH_Z,
        1,
      );
      slerpArmEuler(
        lhRef.current,
        cal?.lhX ?? EXPLAIN_LH_X,
        cal?.lhY ?? EXPLAIN_LH_Y,
        cal?.lhZ ?? EXPLAIN_LH_Z,
        0.8,
      );

      // ──── CHANGE #1: Shoulder engagement during explain ───────────────────
      // ★ BIO: add breathShoulderLift for natural inhale coupling
      slerpBoneFromBind(rightShoulderRef.current, 'rightShoulder',
        EXPLAIN_SHOULDER_LIFT * gBlend + antStrength * ANT_SHOULDER_R_EXPLAIN + breathShoulderLift, 0, 0, 5);
      slerpBoneFromBind(leftShoulderRef.current, 'leftShoulder',
        EXPLAIN_SHOULDER_LIFT * gBlend + antStrength * ANT_SHOULDER_R_EXPLAIN + breathShoulderLift, 0, 0, 5);

      // ──── CHANGE #1: Subtle hip tilt (weight shift while explaining) ──────
      slerpBoneFromBind(hipsRef.current, 'hips',
        0,
        0,
        Math.sin(t * 0.8) * EXPLAIN_HIP_TILT_Z * gBlend + antStrength * ANT_HIP_Z_EXPLAIN * gBlend,
        4);

      // ──── Finger curl: lerp currentFingerCurl → targetFingerCurl, then map to euler ─────
      const explainFingerBlend = gBlend;
      const targetRFingerCurl =
        cal?.rFingerCurl !== undefined && Number.isFinite(cal.rFingerCurl)
          ? THREE.MathUtils.clamp(cal.rFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : EXPLAIN_R_FINGER_CURL;
      const targetLFingerCurl =
        cal?.lFingerCurl !== undefined && Number.isFinite(cal.lFingerCurl)
          ? THREE.MathUtils.clamp(cal.lFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : EXPLAIN_L_FINGER_CURL;
      const curlLerpK = Math.min(1, safeDelta * 12);
      explainFingerCurlSmoothRef.current = THREE.MathUtils.lerp(
        explainFingerCurlSmoothRef.current,
        targetRFingerCurl,
        curlLerpK,
      );
      explainFingerCurlLeftSmoothRef.current = THREE.MathUtils.lerp(
        explainFingerCurlLeftSmoothRef.current,
        targetLFingerCurl,
        curlLerpK,
      );
      const currentRFingerCurl = explainFingerCurlSmoothRef.current;
      const currentLFingerCurl = explainFingerCurlLeftSmoothRef.current;
      const exCurlValR =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, currentRFingerCurl) * explainFingerBlend;
      const exCurlValL =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, currentLFingerCurl) * explainFingerBlend;

      const applyFingerIf = (bone: THREE.Object3D | null, key: string, curl: number) => {
        if (!bone) return;
        slerpFingerCurl(bone, key, curl, FINGER_SLERP_SPEED);
      };
      applyFingerIf(rIndexProximalRef.current,  'rIndexProximal',  exCurlValR);
      applyFingerIf(rMiddleProximalRef.current, 'rMiddleProximal', exCurlValR);
      applyFingerIf(rRingProximalRef.current,   'rRingProximal',   exCurlValR);
      applyFingerIf(rLittleProximalRef.current, 'rLittleProximal', exCurlValR);
      applyFingerIf(rThumbProximalRef.current,  'rThumbProximal',  exCurlValR * 0.55);
      applyFingerIf(lIndexProximalRef.current,  'lIndexProximal',  exCurlValL);
      applyFingerIf(lMiddleProximalRef.current, 'lMiddleProximal', exCurlValL);
      applyFingerIf(lRingProximalRef.current,   'lRingProximal',   exCurlValL);
      applyFingerIf(lLittleProximalRef.current, 'lLittleProximal', exCurlValL);
      applyFingerIf(lThumbProximalRef.current,  'lThumbProximal',  exCurlValL * 0.55);

    } else if (g === 'point') {
      const cal = (_calibrationRef.current?.gesture === 'point') ? _calibrationRef.current.pose : null;
      // ★ BIO: organic micro-tremor — sine + noise
      const em = (
        Math.sin(t * POINT_MICRO_FREQ) * BIO_ORG_SINE +
        noiseArm(t * BIO_ORG_NOISE_SPD, 4.8, 0) * BIO_ORG_NOISE
      ) * POINT_MICRO_AMP * gArm * gestureAmp;
      const antRua = antStrength * ANT_RUA_X_POINT;
      const pRuaX = cal ? cal.ruaX : POINT_ARM_EXTEND_X;
      const pRuaZ = cal ? cal.ruaZ : POINT_ARM_EXTEND_Z;
      const pRlaZ = cal ? cal.rlaZ : POINT_RLA_Z;
      const pRhX  = cal ? cal.rhX  : POINT_RH_X;
      const pRhZ  = cal ? cal.rhZ  : POINT_RH_Z;
      const pLuaX = cal ? cal.luaX : POINT_LUA_X;
      const pLuaY = cal ? cal.luaY : POINT_LUA_Y;
      const pLuaZ = cal ? cal.luaZ : POINT_LUA_Z;
      // ★ BIO: gravity droop on extended arm
      const pointGravityZ = BIO_GRAVITY_DROOP * 0.8 * gBlend;
      slerpArmEuler(ruaRef.current, pRuaX + em + antRua, cal ? cal.ruaY : POINT_ARM_EXTEND_Y, pRuaZ + pointGravityZ, 1.15 * gArm + 0.1);
      slerpArmEuler(rlaRef.current, POINT_RLA_X, 0, pRlaZ, 1.1 * gArm + 0.1);
      // ★ BIO: wrist jitter + snappier wrist speed
      slerpArmEuler(
        rhRef.current,
        pRhX + wristJitterX,
        cal?.rhY ?? 0,
        pRhZ + wristJitterZ,
        1.2 * gArm + 0.1,
      );
      slerpArmEuler(luaRef.current, pLuaX, pLuaY, pLuaZ, 0.35);
      slerpArmEuler(llaRef.current, POINT_LLA_X, 0, POINT_LLA_Z, 0.35);
      slerpArmEuler(
        lhRef.current,
        cal?.lhX ?? 0,
        cal?.lhY ?? 0,
        cal?.lhZ ?? 0,
        0.35,
      );

      // ──── CHANGE #5: Point finger — index extended, others curled ─────────
      const pointFingerBlend = gBlend;
      const ptRCurlT =
        cal?.rFingerCurl !== undefined && Number.isFinite(cal.rFingerCurl)
          ? THREE.MathUtils.clamp(cal.rFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : null;
      const ptLCurlT =
        cal?.lFingerCurl !== undefined && Number.isFinite(cal.lFingerCurl)
          ? THREE.MathUtils.clamp(cal.lFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : null;
      const ptIdx =
        ptRCurlT !== null
          ? THREE.MathUtils.lerp(-0.05, 0.4, ptRCurlT) * pointFingerBlend
          : -0.05 * pointFingerBlend;
      const ptOther =
        ptRCurlT !== null
          ? THREE.MathUtils.lerp(0.08, FINGER_CURL_POINT, ptRCurlT) * pointFingerBlend
          : FINGER_CURL_POINT * pointFingerBlend;
      const ptThumb =
        ptRCurlT !== null
          ? THREE.MathUtils.lerp(0.06, FINGER_CURL_POINT * 0.65, ptRCurlT) * pointFingerBlend
          : FINGER_CURL_POINT * 0.6 * pointFingerBlend;
      const ptLIdx =
        ptLCurlT !== null
          ? THREE.MathUtils.lerp(-0.05, 0.4, ptLCurlT) * pointFingerBlend
          : -0.05 * pointFingerBlend;
      const ptLOther =
        ptLCurlT !== null
          ? THREE.MathUtils.lerp(0.08, FINGER_CURL_POINT, ptLCurlT) * pointFingerBlend
          : FINGER_CURL_POINT * pointFingerBlend;
      const ptLThumb =
        ptLCurlT !== null
          ? THREE.MathUtils.lerp(0.06, FINGER_CURL_POINT * 0.65, ptLCurlT) * pointFingerBlend
          : FINGER_CURL_POINT * 0.6 * pointFingerBlend;
      slerpFingerCurl(rIndexProximalRef.current,  'rIndexProximal',  ptIdx, FINGER_SLERP_SPEED);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', ptOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(rRingProximalRef.current,   'rRingProximal',   ptOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', ptOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(rThumbProximalRef.current,  'rThumbProximal',  ptThumb, FINGER_SLERP_SPEED);
      slerpFingerCurl(lIndexProximalRef.current,  'lIndexProximal',  ptLIdx, FINGER_SLERP_SPEED);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', ptLOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(lRingProximalRef.current,   'lRingProximal',   ptLOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', ptLOther, FINGER_SLERP_SPEED);
      slerpFingerCurl(lThumbProximalRef.current,  'lThumbProximal',  ptLThumb, FINGER_SLERP_SPEED);

      slerpBoneFromBind(hipsRef.current, 'hips', 0, 0, POINT_HIP_TILT_Z * gBlend + antStrength * ANT_HIP_Z_POINT * gBlend, 4);

    } else if (g === 'think') {
      const cal = (_calibrationRef.current?.gesture === 'think') ? _calibrationRef.current.pose : null;
      // استهداف مباشر للوضعية الكاملة (بدون mix) مع kMul=3 (سريع ومرئي).
      // gBlend + follow-through يتحكمان في التدرج عبر slerpScale — لا نحتاج mix منفصل.
      const antRua = antStrength * ANT_RUA_X_THINK;
      const tRuaX = (cal ? cal.ruaX : THINK_RUA_X) + antRua;
      const tRuaY = cal ? cal.ruaY : THINK_RUA_Y;
      const thinkOscCfg = GESTURE_OSCILLATIONS.think;
      const thinkRuaZOsc =
        thinkOscCfg?.bone === 'ruaZ'
          ? Math.sin(t * Math.PI * 2 * thinkOscCfg.frequency) * thinkOscCfg.amplitude * gBlend * intentArm
          : 0;
      const tRuaZ = (cal ? cal.ruaZ : THINK_RUA_Z) + thinkRuaZOsc;
      const tRlaZ = cal ? cal.rlaZ : THINK_RLA_Z;
      const tRhX  = cal ? cal.rhX : THINK_RH_X;
      const tRhY  = cal?.rhY ?? THINK_RH_Y;
      const tRhZ  = cal ? cal.rhZ : THINK_RH_Z;
      const tLuaX = cal ? cal.luaX : THINK_LUA_X;
      const tLuaY = cal ? cal.luaY : THINK_LUA_Y;
      const tLuaZ = cal ? cal.luaZ : THINK_LUA_Z;
      const tLlaX = THINK_LLA_X;
      const tLlaZ = cal ? cal.llaZ : THINK_LLA_Z;
      const tLhX  = cal?.lhX ?? THINK_LH_X;
      const tLhY  = cal?.lhY ?? THINK_LH_Y;
      const tLhZ  = cal?.lhZ ?? THINK_LH_Z;

      // INTENT CURVE: intentArm drives the blend; holdOsc adds micro-oscillation at peak.
      // thinkK is now only a scaling hint — actual speed comes from armK (FIX1+PHASE2).
      const thinkK = 1.5 * intentArm + 0.12;
      slerpArmEuler(ruaRef.current, tRuaX * (1 + holdOsc), tRuaY, tRuaZ * (1 + holdOsc * 0.6), thinkK);
      slerpArmEuler(rlaRef.current, THINK_RLA_X * (1 + holdOsc * 0.8), 0, tRlaZ * (1 + holdOsc * 0.7), thinkK, true);
      slerpArmEuler(rhRef.current,  tRhX * (1 + holdOsc * 0.5), tRhY, tRhZ * (1 + holdOsc * 0.4), thinkK * 0.9, true);
      slerpArmEuler(luaRef.current, tLuaX, tLuaY, tLuaZ,  thinkK * 0.7);
      slerpArmEuler(llaRef.current, tLlaX, 0, tLlaZ,       thinkK * 0.7, true);
      slerpArmEuler(lhRef.current,  tLhX, tLhY, tLhZ,      thinkK * 0.65, true);

      slerpBoneFromBind(
        rightShoulderRef.current,
        'rightShoulder',
        THINK_RSHOULDER_X * gBlend + antStrength * ANT_SHOULDER_R_THINK,
        THINK_RSHOULDER_Y * gBlend,
        THINK_RSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        leftShoulderRef.current,
        'leftShoulder',
        THINK_LSHOULDER_X * gBlend,
        THINK_LSHOULDER_Y * gBlend,
        THINK_LSHOULDER_Z * gBlend,
        5,
      );

      slerpBoneFromBind(
        hipsRef.current,
        'hips',
        THINK_HIPS_X * gBlend,
        THINK_HIPS_Y * gBlend,
        THINK_HIPS_Z * gBlend,
        4,
      );
      slerpBoneFromBind(
        spineRef.current,
        'spine',
        THINK_SPINE_X * gBlend,
        THINK_SPINE_Y * gBlend,
        THINK_SPINE_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        chestRef.current,
        'chest',
        THINK_CHEST_X * gBlend,
        THINK_CHEST_Y * gBlend,
        THINK_CHEST_Z * gBlend,
        5,
      );

      const thinkFingerBlend = gBlend;
      const thRCurlT =
        cal?.rFingerCurl !== undefined && Number.isFinite(cal.rFingerCurl)
          ? THREE.MathUtils.clamp(cal.rFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : null;
      const thLCurlT =
        cal?.lFingerCurl !== undefined && Number.isFinite(cal.lFingerCurl)
          ? THREE.MathUtils.clamp(cal.lFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : null;
      const thIdx =
        thRCurlT !== null
          ? THREE.MathUtils.lerp(0.02, FINGER_CURL_THINK * 0.9, thRCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * 0.7 * thinkFingerBlend;
      const thMid =
        thRCurlT !== null
          ? THREE.MathUtils.lerp(0.05, FINGER_CURL_THINK, thRCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * thinkFingerBlend;
      const thThumb =
        thRCurlT !== null
          ? THREE.MathUtils.lerp(0.02, FINGER_CURL_THINK * 0.45, thRCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * 0.4 * thinkFingerBlend;
      const thLIdx =
        thLCurlT !== null
          ? THREE.MathUtils.lerp(0.02, FINGER_CURL_THINK * 0.9, thLCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * 0.7 * thinkFingerBlend;
      const thLMid =
        thLCurlT !== null
          ? THREE.MathUtils.lerp(0.05, FINGER_CURL_THINK, thLCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * thinkFingerBlend;
      const thLThumb =
        thLCurlT !== null
          ? THREE.MathUtils.lerp(0.02, FINGER_CURL_THINK * 0.45, thLCurlT) * thinkFingerBlend
          : FINGER_CURL_THINK * 0.4 * thinkFingerBlend;
      slerpFingerCurl(rIndexProximalRef.current,  'rIndexProximal',  thIdx, FINGER_SLERP_SPEED);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', thMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(rRingProximalRef.current,   'rRingProximal',   thMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', thMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(rThumbProximalRef.current,  'rThumbProximal',  thThumb, FINGER_SLERP_SPEED);
      slerpFingerCurl(lIndexProximalRef.current,  'lIndexProximal',  thLIdx, FINGER_SLERP_SPEED);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', thLMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(lRingProximalRef.current,   'lRingProximal',   thLMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', thLMid, FINGER_SLERP_SPEED);
      slerpFingerCurl(lThumbProximalRef.current,  'lThumbProximal',  thLThumb, FINGER_SLERP_SPEED);

    } else if (g === 'wave') {
      const cal = (_calibrationRef.current?.gesture === 'wave') ? _calibrationRef.current.pose : null;
      // ★ BIO: animated waving motion — gestureAmp مُحدَّد بـ 1.2× لمنع التضخيم الزائد أثناء الكلام
      const micro = (
        Math.sin(t * WAVING_MICRO_FREQ) * BIO_ORG_SINE +
        noiseArm(t * BIO_ORG_NOISE_SPD, 9.1, 0) * BIO_ORG_NOISE
      ) * WAVING_MICRO_AMP * gArm * Math.min(gestureAmp, 1.2);

      // INTENT CURVE: holdOsc amplifies the wave micro-motion during hold phase.
      const wRuaX = cal ? cal.ruaX : WAVING_RUA_X;
      const wRuaZ = cal ? cal.ruaZ : WAVING_RUA_Z;
      const wRlaZ = cal ? cal.rlaZ : WAVING_RLA_Z;
      const _wHold = 1 + holdOsc * 0.9; // wave looks bigger at peak of HOLD phase
      /** أرضية لمضاعف slerp حتى لا يبقى intentArm منخفضاً في prep فيُبطّئ الموج بشكل «slow motion». */
      const waveK = (mul: number) => Math.max(0.68, mul * intentArm + 0.1);

      // Hello-wave: side-to-side hand roll on rhZ (see GESTURE_OSCILLATIONS.wave).
      const waveOscCfg = GESTURE_OSCILLATIONS.wave;
      const gestureIntens = THREE.MathUtils.clamp(gestureContextRef.current.intensity, 0, 1);
      const baseRhZ = ((cal ? cal.rhZ : WAVING_RH_Z) + wristJitterZ * 0.5) * _wHold;
      let targetRhZ = baseRhZ;
      if (waveOscCfg?.bone === 'rhZ' && progress < 1) {
        const waveOsc =
          Math.sin(t * Math.PI * 2 * waveOscCfg.frequency) * waveOscCfg.amplitude * gestureIntens;
        targetRhZ += waveOsc * gBlend;
      }
      targetRhZ = THREE.MathUtils.clamp(targetRhZ, -0.58, 0.58);

      if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR) {
        const logNow = masterClockNowMs();
        if (logNow - waveOscLogMsRef.current > 500) {
          waveOscLogMsRef.current = logNow;
          avatarDebug(`[WAVE_OSC] rhZ = ${targetRhZ.toFixed(3)}`);
        }
      }

      slerpArmEuler(
        ruaRef.current,
        (wRuaX + micro * 1.2) * _wHold,
        cal ? cal.ruaY : WAVING_RUA_Y,
        wRuaZ * _wHold,
        waveK(1.1),
      );
      slerpArmEuler(
        rlaRef.current,
        (WAVING_RLA_X + micro * 0.3) * _wHold,
        0,
        wRlaZ * _wHold,
        waveK(1),
        true,
      );
      slerpArmEuler(
        rhRef.current,
        ((cal ? cal.rhX : WAVING_RH_X) + wristJitterX * 0.5) * _wHold,
        (cal?.rhY ?? WAVING_RH_Y) + micro * 0.15,
        targetRhZ,
        waveK(0.9),
        true,
      );

      // Left arm (resting at side)
      slerpArmEuler(luaRef.current, WAVING_LUA_X, WAVING_LUA_Y, WAVING_LUA_Z, 0.4);
      slerpArmEuler(llaRef.current, WAVING_LLA_X, 0, WAVING_LLA_Z, 0.4);
      slerpArmEuler(
        lhRef.current,
        cal?.lhX ?? WAVING_LH_X,
        cal?.lhY ?? WAVING_LH_Y,
        cal?.lhZ ?? WAVING_LH_Z,
        0.35,
      );

      // Shoulders, torso
      slerpBoneFromBind(
        rightShoulderRef.current,
        'rightShoulder',
        WAVING_RSHOULDER_X * gBlend,
        WAVING_RSHOULDER_Y * gBlend,
        WAVING_RSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        leftShoulderRef.current,
        'leftShoulder',
        WAVING_LSHOULDER_X * gBlend,
        WAVING_LSHOULDER_Y * gBlend,
        WAVING_LSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        hipsRef.current,
        'hips',
        WAVING_HIPS_X * gBlend,
        WAVING_HIPS_Y * gBlend,
        WAVING_HIPS_Z * gBlend,
        4,
      );
      slerpBoneFromBind(
        spineRef.current,
        'spine',
        WAVING_SPINE_X * gBlend,
        WAVING_SPINE_Y * gBlend,
        WAVING_SPINE_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        chestRef.current,
        'chest',
        WAVING_CHEST_X * gBlend,
        WAVING_CHEST_Y * gBlend,
        WAVING_CHEST_Z * gBlend,
        5,
      );
      applySymmetricFingerCurl(FINGER_CURL_WAVE, gBlend);

    } else if (g === 'test_elbow') {
      if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && ruaRef.current && rlaRef.current) {
        const logNow = masterClockNowMs();
        if (logNow - testElbowLogMsRef.current > 220) {
          testElbowLogMsRef.current = logNow;
          const curRua = new THREE.Euler().setFromQuaternion(ruaRef.current.quaternion, 'YXZ');
          const curRla = new THREE.Euler().setFromQuaternion(rlaRef.current.quaternion, 'YXZ');
          avatarDebug(
            `[TEST_ELBOW] target ruaZ=${_ARM_TE.ruaZ.toFixed(4)} rlaZ=${_ARM_TE.rlaZ.toFixed(4)} rlaX=${_ARM_TE.rlaX.toFixed(4)}`,
          );
          avatarDebug(
            `[TEST_ELBOW] current ruaZ=${curRua.z.toFixed(4)} rlaZ=${curRla.z.toFixed(4)} rlaX=${curRla.x.toFixed(4)}`,
          );
        }
      }
      slerpArmEuler(ruaRef.current, _ARM_TE.ruaX, _ARM_TE.ruaY, _ARM_TE.ruaZ, 1);
      slerpArmEuler(rlaRef.current, _ARM_TE.rlaX, 0, _ARM_TE.rlaZ, 1, true);
      slerpArmEuler(rhRef.current, _ARM_TE.rhX, _ARM_TE.rhY, _ARM_TE.rhZ, 1, true);
      slerpArmEuler(luaRef.current, ARM_IDLE.luaX, ARM_IDLE.luaY, ARM_IDLE.luaZ, 0.55, undefined, true);
      slerpArmEuler(llaRef.current, ARM_IDLE.llaX, 0, ARM_IDLE.llaZ, 0.55, true, true);
      slerpArmEuler(lhRef.current, ARM_IDLE.lhX, ARM_IDLE.lhY, ARM_IDLE.lhZ, 0.5, true, true);
      applySymmetricFingerCurl(0.06, gBlend);

    } else if (g === 'clap') {
      // idle + ARM_OFFSETS.clap (ثابت)
      slerpArmEuler(ruaRef.current, _ARM_CL.ruaX, _ARM_CL.ruaY, _ARM_CL.ruaZ, 1);
      slerpArmEuler(rlaRef.current, _ARM_CL.rlaX, 0, _ARM_CL.rlaZ, 1);
      slerpArmEuler(luaRef.current, _ARM_CL.luaX, _ARM_CL.luaY, _ARM_CL.luaZ, 1);
      slerpArmEuler(llaRef.current, _ARM_CL.llaX, 0, _ARM_CL.llaZ, 1);
      applySymmetricFingerCurl(FINGER_CURL_CLAP, gBlend);

    } else if (g === 'agree') {
      const cal = (_calibrationRef.current?.gesture === 'agree') ? _calibrationRef.current.pose : null;
      // موافقة هادئة: أهداف ثابتة (لا sin / لا jitter / لا gArm). idle→pose عبر gBlend + slerp سريع.
      const ab = THREE.MathUtils.clamp(gBlend, 0, 1);
      const mix = (idle: number, pose: number) => THREE.MathUtils.lerp(idle, pose, ab);
      const id = ARM_IDLE;
      const ruaX = mix(id.ruaX, cal ? cal.ruaX : AGREEING_RUA_X);
      const ruaY = mix(id.ruaY, cal ? cal.ruaY : AGREEING_RUA_Y);
      const ruaZ = mix(id.ruaZ, cal ? cal.ruaZ : AGREEING_RUA_Z);
      const rlaX = mix(id.rlaX, AGREEING_RLA_X);
      const rlaZ = mix(id.rlaZ, cal ? cal.rlaZ : AGREEING_RLA_Z);
      const rhX = mix(id.rhX, cal ? cal.rhX : AGREEING_RH_X);
      const rhY = mix(id.rhY, cal?.rhY ?? AGREEING_RH_Y);
      const rhZ = mix(id.rhZ, cal ? cal.rhZ : AGREEING_RH_Z);
      const luaX = mix(id.luaX, cal ? cal.luaX : AGREEING_LUA_X);
      const luaY = mix(id.luaY, cal ? cal.luaY : AGREEING_LUA_Y);
      const luaZ = mix(id.luaZ, cal ? cal.luaZ : AGREEING_LUA_Z);
      const llaX = mix(id.llaX, AGREEING_LLA_X);
      const llaZ = mix(id.llaZ, cal ? cal.llaZ : AGREEING_LLA_Z);
      const lhX = mix(id.lhX, cal?.lhX ?? AGREEING_LH_X);
      const lhY = mix(id.lhY, cal?.lhY ?? AGREEING_LH_Y);
      const lhZ = mix(id.lhZ, cal?.lhZ ?? AGREEING_LH_Z);

      slerpArmEuler(ruaRef.current, ruaX, ruaY, ruaZ, 1);
      slerpArmEuler(rlaRef.current, rlaX, 0, rlaZ, 1);
      slerpArmEuler(rhRef.current, rhX, rhY, rhZ, 1);
      slerpArmEuler(luaRef.current, luaX, luaY, luaZ, 1);
      slerpArmEuler(llaRef.current, llaX, 0, llaZ, 1);
      slerpArmEuler(lhRef.current, lhX, lhY, lhZ, 1);

      // Shoulders, torso
      slerpBoneFromBind(
        rightShoulderRef.current,
        'rightShoulder',
        AGREEING_RSHOULDER_X * gBlend,
        AGREEING_RSHOULDER_Y * gBlend,
        AGREEING_RSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        leftShoulderRef.current,
        'leftShoulder',
        AGREEING_LSHOULDER_X * gBlend,
        AGREEING_LSHOULDER_Y * gBlend,
        AGREEING_LSHOULDER_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        hipsRef.current,
        'hips',
        AGREEING_HIPS_X * gBlend,
        AGREEING_HIPS_Y * gBlend,
        AGREEING_HIPS_Z * gBlend,
        4,
      );
      slerpBoneFromBind(
        spineRef.current,
        'spine',
        AGREEING_SPINE_X * gBlend,
        AGREEING_SPINE_Y * gBlend,
        AGREEING_SPINE_Z * gBlend,
        5,
      );
      slerpBoneFromBind(
        chestRef.current,
        'chest',
        AGREEING_CHEST_X * gBlend,
        AGREEING_CHEST_Y * gBlend,
        AGREEING_CHEST_Z * gBlend,
        5,
      );
      const tr =
        cal?.rFingerCurl !== undefined && Number.isFinite(cal.rFingerCurl)
          ? THREE.MathUtils.clamp(cal.rFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : AGREE_FINGER_CURL_R;
      const tl =
        cal?.lFingerCurl !== undefined && Number.isFinite(cal.lFingerCurl)
          ? THREE.MathUtils.clamp(cal.lFingerCurl, 0, 1)
          : cal?.fingerCurl !== undefined && Number.isFinite(cal.fingerCurl)
            ? THREE.MathUtils.clamp(cal.fingerCurl, 0, 1)
            : AGREE_FINGER_CURL_L;
      applySplitFingerCurl(tr, tl, gBlend);

    } else if (
      motionSource === 'IDLE' &&
      !isTestElbowGesture &&
      !GESTURE_OVERRIDE_IDLE
    ) {
      // ─── Idle: arms lowered + دوران وضعيات خفيف كل 8–12 ث ────────────────
      // motionSource === IDLE يضمن عدم التزامن مع GESTURE أو VRMA.
      const nowIdle = masterClockNowMs();
      if (idleVariantNextSwitchRef.current === 0) {
        idleVariantNextSwitchRef.current =
          nowIdle + IDLE_VARIANT_INTERVAL_MIN + Math.random() * (IDLE_VARIANT_INTERVAL_MAX - IDLE_VARIANT_INTERVAL_MIN);
      }
      if (nowIdle >= idleVariantNextSwitchRef.current) {
        const choices = (['neutral', 'weight_left', 'casual'] as const).filter(
          (v) => v !== idleVariantRef.current,
        );
        idleVariantRef.current = choices[Math.floor(Math.random() * choices.length)] ?? 'neutral';
        idleVariantNextSwitchRef.current =
          nowIdle + IDLE_VARIANT_INTERVAL_MIN + Math.random() * (IDLE_VARIANT_INTERVAL_MAX - IDLE_VARIANT_INTERVAL_MIN);
      }

      let idleOffsetX = 0;
      let idleOffsetZ = 0;
      let hipTiltZIdle = 0;

      if (listening) {
        // Arms same as neutral idle — no extra right/left arm pose while listening
        const icL = _idleCalRef.current;
        slerpArmEuler(
          ruaRef.current,
          (icL ? icL.ruaX : IDLE_RUA_X),
          IDLE_RUA_Y,
          (icL ? icL.ruaZ : IDLE_RUA_Z) + talkNudge + (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1.2 * idleArmEaseMul,
          undefined,
          true,
        );
        slerpArmEuler(
          luaRef.current,
          (icL ? icL.luaX : IDLE_LUA_X),
          IDLE_LUA_Y,
          (icL ? icL.luaZ : IDLE_LUA_Z) + talkNudge * 0.88 - (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1.2 * idleArmEaseMul,
          undefined,
          true,
        );
        slerpArmEuler(rlaRef.current, icL ? icL.rlaX : IDLE_LOWER_ARM_X, 0, (icL ? icL.rlaZ : 0) + 0.02 + talkNudge * 0.35, 0.85 * idleArmEaseMul, true, true);
        slerpArmEuler(llaRef.current, IDLE_LOWER_ARM_X, 0, -0.02 - talkNudge * 0.35, 0.85 * idleArmEaseMul, true, true);
        slerpArmEuler(rhRef.current,  wristJitterX * 0.5, 0, talkWrist + wristJitterZ * 0.5, 0.75 * idleArmEaseMul, undefined, true);
        slerpArmEuler(lhRef.current,  -wristJitterX * 0.5, 0, -talkWrist * 0.9 - wristJitterZ * 0.5, 0.75 * idleArmEaseMul, undefined, true);
        slerpBoneFromBind(rightShoulderRef.current, 'rightShoulder', breathShoulderLift, 0, 0, 4, true);
        slerpBoneFromBind(leftShoulderRef.current,  'leftShoulder',  breathShoulderLift, 0, 0, 4, true);
        slerpBoneFromBind(hipsRef.current, 'hips', 0, 0, 0, 3, true);
      } else {
        switch (idleVariantRef.current) {
          case 'neutral':
            break;
          case 'weight_left':
            hipTiltZIdle = 0.018;
            idleOffsetX = 0.02;
            break;
          case 'casual':
            idleOffsetZ = 0.06;
            hipTiltZIdle = -0.012;
            break;
        }

        // Prefer live idle calibration from GestureCalibrator; fall back to constants.
        const ic = _idleCalRef.current;

        slerpArmEuler(
          ruaRef.current,
          (ic ? ic.ruaX : IDLE_RUA_X) + idleOffsetX,
          IDLE_RUA_Y,
          (ic ? ic.ruaZ : IDLE_RUA_Z) + talkNudge + idleOffsetZ + (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1 * idleArmEaseMul,
          undefined,
          true,
        );
        slerpArmEuler(
          luaRef.current,
          (ic ? ic.luaX : IDLE_LUA_X) + idleOffsetX,
          IDLE_LUA_Y,
          (ic ? ic.luaZ : IDLE_LUA_Z) + talkNudge * 0.88 - idleOffsetZ - (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1 * idleArmEaseMul,
          undefined,
          true,
        );
        slerpArmEuler(rlaRef.current, ic ? ic.rlaX : IDLE_LOWER_ARM_X, 0, (ic ? ic.rlaZ : 0) + 0.02 + talkNudge * 0.35, 0.85 * idleArmEaseMul, true, true);
        slerpArmEuler(llaRef.current, IDLE_LOWER_ARM_X, 0, -0.02 - talkNudge * 0.35, 0.85 * idleArmEaseMul, true, true);
        // ★ BIO: wrist jitter in idle (subtle life signal)
        slerpArmEuler(rhRef.current,  wristJitterX * 0.5, 0, talkWrist + wristJitterZ * 0.5, 0.75 * idleArmEaseMul, undefined, true);
        slerpArmEuler(lhRef.current,  -wristJitterX * 0.5, 0, -talkWrist * 0.9 - wristJitterZ * 0.5, 0.75 * idleArmEaseMul, undefined, true);

        if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && ruaRef.current && luaRef.current) {
          const logNow = masterClockNowMs();
          if (logNow - lastIdleZLogMsRef.current > 900) {
            lastIdleZLogMsRef.current = logNow;
            const ruaTarget = (ic ? ic.ruaZ : IDLE_RUA_Z) + talkNudge + idleOffsetZ;
            const luaTarget = (ic ? ic.luaZ : IDLE_LUA_Z) + talkNudge * 0.88 - idleOffsetZ;
            IDLE_APPLIED_E.setFromQuaternion(ruaRef.current.quaternion, 'YXZ');
            const rZ = IDLE_APPLIED_E.z;
            IDLE_APPLIED_E.setFromQuaternion(luaRef.current.quaternion, 'YXZ');
            const lZ = IDLE_APPLIED_E.z;
            const ruaDown = ruaTarget > 0.8;
            const luaDown = luaTarget < -0.8;
            avatarDebug(
              `[Idle] target RUA.z=${ruaTarget.toFixed(3)} applied≈${rZ.toFixed(3)} ${ruaDown ? '✅ down tgt' : '⚠ RUA_Z tweak?'}`,
              `| LUA.z tgt=${luaTarget.toFixed(3)} applied≈${lZ.toFixed(3)} ${luaDown ? '✅ down tgt' : '⚠ LUA_Z tweak?'}`,
            );
          }
        }

        // ★ BIO: Shoulders rise with breath in idle — natural inhale coupling
        slerpBoneFromBind(rightShoulderRef.current, 'rightShoulder', breathShoulderLift, 0, 0, 4, true);
        slerpBoneFromBind(leftShoulderRef.current,  'leftShoulder',  breathShoulderLift, 0, 0, 4, true);
        slerpBoneFromBind(hipsRef.current, 'hips', 0, 0, 0, 3, true);
      }

      // ──── CHANGE #5: Relax fingers to bind pose in idle ───────────────────
      slerpFingerCurl(rIndexProximalRef.current,  'rIndexProximal',  0, 3, true);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', 0, 3, true);
      slerpFingerCurl(rRingProximalRef.current,   'rRingProximal',   0, 3, true);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', 0, 3, true);
      slerpFingerCurl(rThumbProximalRef.current,  'rThumbProximal',  0, 3, true);
      slerpFingerCurl(lIndexProximalRef.current,  'lIndexProximal',  0, 3, true);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', 0, 3, true);
      slerpFingerCurl(lRingProximalRef.current,   'lRingProximal',   0, 3, true);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', 0, 3, true);
      slerpFingerCurl(lThumbProximalRef.current,  'lThumbProximal',  0, 3, true);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  HAND-BODY COLLISION GUARD
    //  يُضاف إلى collisionPose (يُدمَج لاحقاً في PoseComposer).
    //  يقرأ المواضع العالمية من الإطار السابق (1 frame lag = ~16 ms، غير ملحوظ).
    //  يُطبّق دوراناً تصحيحياً مباشراً على RUA/LUA دون تجاوز الـ slerp.
    // ═════════════════════════════════════════════════════════════════════════
    // أثناء أي إيماءة غير idle (ref) أو أثناء VRMA: لا تُطبَّق — كانت تُعيد الذراعين نحو وضع التصادم مع الصدر.
    const ruaKinematicLock = genMix > 0.02 && generativeBonesRef.current.has('rua');
    const luaKinematicLock = genMix > 0.02 && generativeBonesRef.current.has('lua');

    if (
      motionSource === 'IDLE' &&
      !isTestElbowGesture &&
      chestRef.current &&
      ruaRef.current &&
      luaRef.current
    ) {
      // نقطة مرجعية: مركز الجذع (الصدر)
      chestRef.current.getWorldPosition(_chestWorld);
      const effRadius = BODY_COLLISION_RADIUS + HAND_BODY_SAFETY_MARGIN;

      // ── اليد اليمنى (RUA) ──────────────────────────────────────────────
      if (rhRef.current && !localAxisCalibActive && !ruaKinematicLock) {
        rhRef.current.getWorldPosition(_rHandWorld);
        // المسافة الأفقية فقط (X وZ) — نتجاهل Y لأن اليد قد تكون فوق الصدر بشكل مقصود
        const rdx = _rHandWorld.x - _chestWorld.x;
        const rdz = _rHandWorld.z - _chestWorld.z;
        const rHorizDist = Math.sqrt(rdx * rdx + rdz * rdz);
        if (rHorizDist < effRadius) {
          // عمق الاختراق × القوة = مقدار دوران الدفع (راديان)
          const rPen = effRadius - rHorizDist;
          const rPush = rPen * HAND_BODY_PUSH_STRENGTH;
          // الذراع اليمنى: Z+ يخفض الذراع نحو idle → يبعدها عن الجسم
          _collPushRot.set(0, 0, rPush, 'YXZ');
          _collPushQ.setFromEuler(_collPushRot);
          _collBaseQ.copy(ruaRef.current.quaternion).multiply(_collPushQ);
          collisionPose.set('rua', _collBaseQ.clone());
          if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && rPen > 0.02) {
            avatarDebug(`[Collision] RHand penetration=${rPen.toFixed(3)}m push=${rPush.toFixed(3)}rad`);
          }
        }
      }

      // ── اليد اليسرى (LUA) ──────────────────────────────────────────────
      if (lhRef.current && !luaKinematicLock) {
        lhRef.current.getWorldPosition(_lHandWorld);
        const ldx = _lHandWorld.x - _chestWorld.x;
        const ldz = _lHandWorld.z - _chestWorld.z;
        const lHorizDist = Math.sqrt(ldx * ldx + ldz * ldz);
        if (lHorizDist < effRadius) {
          const lPen = effRadius - lHorizDist;
          const lPush = lPen * HAND_BODY_PUSH_STRENGTH;
          // الذراع اليسرى: Z- يخفض الذراع → يبعدها عن الجسم
          _collPushRot.set(0, 0, -lPush, 'YXZ');
          _collPushQ.setFromEuler(_collPushRot);
          _collBaseQ.copy(luaRef.current.quaternion).multiply(_collPushQ);
          collisionPose.set('lua', _collBaseQ.clone());
          if (process.env.NODE_ENV === 'development' && DEBUG_AVATAR && lPen > 0.02) {
            avatarDebug(`[Collision] LHand penetration=${lPen.toFixed(3)}m push=${lPush.toFixed(3)}rad`);
          }
        }
      }
    }

    } // motionSource !== 'VRMA'

    // ═════════════════════════════════════════════════════════════════════════
    //  GENERATIVE GESTURE OVERLAY — runs under IDLE and VRMA (per-bone VRMA attenuation below).
    // ═════════════════════════════════════════════════════════════════════════
    if (genMix > 0.02) {
      const gb = generativeBonesRef.current;
      const slerpGen = (poseKey: string, obj: THREE.Object3D | null) => {
        const rot = gb.get(poseKey);
        if (!rot || !obj) return;
        GEN_E.set(rot.x, rot.y, rot.z, 'YXZ');
        GEN_Q.setFromEuler(GEN_E);
        generativePose.set(poseKey, GEN_Q.clone());
      };
      for (const pk of gb.keys()) {
        slerpGen(pk, resolveGenerativeObject(pk));
      }
      const expandedGen = expandGenerativeSuppressedKeys(gb.keys());
      for (const pk of expandedGen) {
        if (gb.has(pk)) continue;
        const obj = resolveGenerativeObject(pk);
        if (obj) generativePose.set(pk, obj.quaternion.clone());
      }
    }

    const vrmaBonePoseRaw = vrmaPlaybackFrozen
      ? EMPTY_BONE_POSE
      : (vrmaPoseRef?.current?.bones ?? EMPTY_BONE_POSE);
    const vrmaBonePose =
      !vrmaPlaybackFrozen && motionSource === 'VRMA' && vrmaBonePoseRaw.size > 0
        ? stripVrmaGhostArmIdentitySamples(vrmaBonePoseRaw, m)
        : vrmaBonePoseRaw;
    let gestureLayerW: number;
    let generativeLayerW: number;
    let collisionLayerW: number;
    let idleLayerW: number;
    let vrmaLayerW: number;
    if (VRMA_ISOLATION_TEST && !vrmaPlaybackFrozen) {
      gestureLayerW = 0;
      generativeLayerW = 0;
      collisionLayerW = 0;
      idleLayerW = 0;
      vrmaLayerW = vrmaBonePose.size > 0 ? 1 : 0;
    } else {
      gestureLayerW = isProceduralGestureFrame
        ? THREE.MathUtils.clamp(intentArm * 0.85 + gBlend * 0.15, 0, 1)
        : 0;
      generativeLayerW =
        genMix > 0.02 ? THREE.MathUtils.clamp(genMix, 0, 1) : 0;
      collisionLayerW = collisionPose.size > 0 ? 1 : 0;
      idleLayerW = motionSource === 'VRMA' ? 0 : 1;
      vrmaLayerW = motionSource === 'VRMA' && vrmaBonePose.size > 0 ? 1 : 0;
    }
    if (vrmaPlaybackFrozen) {
      vrmaLayerW = 0;
    }
    if (proceduralOnly) {
      vrmaLayerW = 0;
    }

    /** Any generative target → global collision layer off (per-bone locks also zero VRMA/collision/idle/gesture). */
    const generativeExternalActive = genMix > 0.02;
    if (generativeExternalActive && collisionLayerW > 0) {
      collisionLayerW = KINEMATIC_GLOBAL_COLLISION_WHILE_GENERATIVE;
    }

    const kinematicBoneWeightOverrides = new Map<string, PerBonePoseBlendWeights>();
    if (genMix > 0.02) {
      const lockWeights: PerBonePoseBlendWeights = {
        idle: KINEMATIC_GENERATIVE_LOCK_IDLE,
        vrma: KINEMATIC_GENERATIVE_LOCK_VRMA,
        collision: KINEMATIC_GENERATIVE_LOCK_COLLISION,
        gesture: KINEMATIC_GENERATIVE_LOCK_GESTURE,
        generative: 1,
      };
      for (const k of expandGenerativeSuppressedKeys(generativeBonesRef.current.keys())) {
        kinematicBoneWeightOverrides.set(k, lockWeights);
      }
    }

    /**
     * VRMA clip active: procedural humanization / micro / cinematic must not stack on bones.
     * In procedural-only mode this is always false — we WANT the humanization layers to run.
     */
    const isolateVrmaLayers = !proceduralOnly && motionSource === 'VRMA';

    const vrmaForBlend = mergeVrmaPoseWithArmFallback(
      motionSource,
      vrmaLayerW,
      vrmaBonePose,
      m,
    );

    const transcriptText = getEmbodimentUtteranceTextForSemantics() ?? '';
    const cognitiveEmb = deriveEmbodimentFromLLM({
      text: transcriptText,
      ...getCognitiveOrchestratorInputOverlay(),
      isUserSpeaking: listening,
      isAgentSpeaking: speaking,
    });
    const semanticHints = stepSmoothedSemanticHints(
      cognitiveEmb.hints ?? deriveSpeechSemanticHints(transcriptText || undefined),
      safeDelta,
    );
    updateEmbodimentState({
      ...cognitiveEmb,
      speech: {
        energy: speechDriveSnap.energy,
        phrasePhase: speechDriveSnap.phrasePhase,
        syllablePulse: speechDriveSnap.syllablePulse,
        active: speechDriveSnap.active,
        inPause: speechDriveSnap.inPause,
      },
      hints: semanticHints,
    });

    motionDriver.update(safeDelta, {
      embodiment: getEmbodimentState(),
      vrmaBasePose: vrmaBonePose,
      vrmaBlendInput: vrmaForBlend,
      motionSource,
    });

    const finalPose = blendPoseLayers({
      bind: m,
      idle: idlePose,
      generative: generativePose,
      gesture: gesturePose,
      collision: collisionPose,
      vrma: vrmaForBlend,
      weights: {
        idle: idleLayerW,
        generative: generativeLayerW,
        gesture: gestureLayerW,
        collision: collisionLayerW,
        vrma: vrmaLayerW,
      },
      boneWeightOverrides:
        kinematicBoneWeightOverrides.size > 0 ? kinematicBoneWeightOverrides : undefined,
    });

    const embFrame = getEmbodimentState();
    const vrmaPose = clonePoseMap(finalPose);
    const intentPose = generateIntentPose(embFrame, t, m);
    const vrmaFrozenForIntent = isVrmaPlaybackGloballyDisabled();
    const speechOn = embFrame.speech.active;
    const speechFactor = speechOn
      ? 0.42 + 0.58 * Math.min(1, Math.max(0, embFrame.speech.energy))
      : 0.64;
    let intentBlendW = THREE.MathUtils.clamp(embFrame.intent.intensity * speechFactor, 0, 1);
    if (!speechOn && embFrame.intent.activeIntent) {
      intentBlendW = Math.max(intentBlendW, embFrame.intent.intensity * 0.58);
    }
    if (vrmaFrozenForIntent && motionSource !== 'VRMA') {
      intentBlendW = Math.min(1, intentBlendW * 1.1);
    }
    const canBlendIntent =
      intentPose.size > 0 &&
      intentBlendW > 1e-4 &&
      vrmaPose.size > 0 &&
      !!embFrame.intent.activeIntent;
    if (canBlendIntent) {
      if (motionSource === 'VRMA' && vrmaLayerW > 0) {
        blendPoseInto(finalPose, intentPose, intentBlendW * 0.74);
      } else if (vrmaFrozenForIntent || motionSource !== 'VRMA') {
        blendPoseInto(finalPose, intentPose, intentBlendW);
      }
    }

    const proceduralSuppressionKeys =
      genMix > 0.02 && generativeBonesRef.current.size > 0
        ? expandGenerativeSuppressedKeys(generativeBonesRef.current.keys())
        : undefined;

    const behaviorPayload = brainSnap.behaviorContractPayload;
    let humSnap: HumanizationSnapshot | null = null;

    runWithProceduralSuppression(proceduralSuppressionKeys, () => {
      if (!isolateVrmaLayers) {
        safeCall('presenceLayer', () => applyPresenceFromEmbodiment(finalPose, embFrame, {
          motionSource,
          elapsedSec: t,
          delta: safeDelta,
          gestureLayerW,
          isTalking: speaking,
        }), undefined);

        safeCall('intentMotor', () => applyIntentMotor(finalPose, embFrame, safeDelta, {
          motionSource,
          gestureLayerW,
          onMotionApplied: () => {
            recordActivity();
          },
          eyeContact:
            headRef.current
              ? {
                  cameraPosition: camera.position,
                  headWorldPosition: headRef.current.getWorldPosition(_EYE_HEAD_WORLD),
                }
              : undefined,
        }), undefined);

        safeCall('motionDriver', () => applyMotionDriver(finalPose, embFrame, safeDelta, {
          motionSource,
          gestureLayerW,
        }), undefined);
      }

      if (!isolateVrmaLayers) {
        const humRaw = tickHumanization({
          delta: safeDelta,
          nowMs,
          speaking,
          thinking,
          payload: behaviorPayload,
        });
        const cogAmp =
          getCognitiveGestureAmplitudeScale() * getPerceptionStrangerGestureMul();
        humSnap = {
          ...humRaw,
          breathAmpMul: humRaw.breathAmpMul * cogAmp,
          noiseAmpRad: humRaw.noiseAmpRad * cogAmp,
          motionSpeedMul: humRaw.motionSpeedMul * cogAmp,
          saccadeYaw: humRaw.saccadeYaw * cogAmp,
          saccadePitch: humRaw.saccadePitch * cogAmp,
          fixationYaw: humRaw.fixationYaw * cogAmp,
          fixationPitch: humRaw.fixationPitch * cogAmp,
          stabilizeDriftYaw: humRaw.stabilizeDriftYaw * cogAmp,
          stabilizeDriftPitch: humRaw.stabilizeDriftPitch * cogAmp,
          anticipationNeckTilt: humRaw.anticipationNeckTilt * cogAmp,
          freezeHealNeckTilt: humRaw.freezeHealNeckTilt * cogAmp,
          freezeHealShoulder: humRaw.freezeHealShoulder * cogAmp,
        };
        safeCall('humanization', () => applyHumanizationLayer(finalPose, safeDelta, humSnap!), undefined);
        safeCall('attentionSeeking', () => applyAttentionSeekingLayer(finalPose, t, getPerceptionAttentionSeekingStrength()), undefined);

        // ── New motion layers (biomechanical + finger + gaze + timing) ────────
        // 1) LLM intent wins if provided; otherwise rule-based classifier runs on
        //    the current utterance text (same source used by semantic hints).
        const _llmIntent = embFrame.intent.activeIntent ?? '';
        let _activeIntent = _llmIntent;
        if (!_activeIntent) {
          const _utter = getEmbodimentUtteranceTextForSemantics() ?? '';
          const _detected = detectIntent(_utter);
          if (_detected !== 'neutral') _activeIntent = _detected;
        }
        const _timingWeight = tickGestureTiming(_activeIntent);

        // Simple motion-state hooks (body/gaze layers below also read _activeIntent directly).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _motionState = ((globalThis as any).__cogniMotionState ??= {
          openGesture: 0, headTilt: 0, headNod: 0,
        });
        _motionState.openGesture =
          _activeIntent === 'explaining' || _activeIntent === 'emphasizing' ? 1 : 0;
        _motionState.headTilt =
          _activeIntent === 'thinking'   ? 0.05 :
          _activeIntent === 'questioning' ? 0.08 : 0;
        _motionState.headNod =
          _activeIntent === 'confirming' || _activeIntent === 'agreeing' ? 0.10 : 0;

        // ── TASK 5 — motionState presence check (throttled, ~1/s) ─────────────
        if (typeof performance !== 'undefined') {
          const _msNow = performance.now();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _msLast = (globalThis as any).__motionStateLogLastMs ?? 0;
          if (_msNow - _msLast > 1000) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__motionStateLogLastMs = _msNow;
            console.log('[MOTION_STATE]', {
              openGesture:  _motionState.openGesture,
              headTilt:     _motionState.headTilt,
              headNod:      _motionState.headNod,
              timingWeight: _timingWeight.toFixed(3),
              activeIntent: _activeIntent || '(none)',
              speaking,
            });
          }
        }

        // ── TASK 6 — forced motionState override (enable: window.__forceMotionState = true) ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((typeof window !== 'undefined') && (window as any).__forceMotionState) {
          const _ft6 = performance.now() * 0.002;
          _motionState.headNod     = Math.sin(_ft6) * 0.3;
          _motionState.headTilt    = Math.cos(_ft6) * 0.2;
          _motionState.openGesture = 1.0;
          console.log('[FORCED_MOTION_STATE]', _motionState);
        }

        // ── Capture bone rotations BEFORE intent apply ────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _shouldTrace = (() => {
          const _nowT = typeof performance !== 'undefined' ? performance.now() : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _lastT = (globalThis as any).__frameTraceLastMs ?? 0;
          if (_nowT - _lastT < 500) return false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__frameTraceLastMs = _nowT;
          return true;
        })();

        const _readEuler = (key: string): { x: number; y: number; z: number } => {
          const q = finalPose.get(key);
          if (!q) return { x: NaN, y: NaN, z: NaN };
          const _eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
          _eTmp.setFromQuaternion(q, 'YXZ');
          return { x: _eTmp.x, y: _eTmp.y, z: _eTmp.z };
        };

        const _boneBefore = _shouldTrace
          ? {
              head: _readEuler('head'),
              neck: _readEuler('neck'),
              lua: _readEuler('lua'),
              rua: _readEuler('rua'),
              lla: _readEuler('lla'),
              rla: _readEuler('rla'),
              lIndexProx: _readEuler('lIndexProximal'),
            }
          : null;

        // ── Apply motionState onto finalPose bones (the missing connection) ──
        const _applied = safeCall('intentMotion', () => applyIntentMotionState(finalPose, _motionState, _timingWeight, _activeIntent), { applied: false, headNod: 0, headTilt: 0, armOpen: 0 });

        if (_shouldTrace) {
          const _afterIntent = {
            head: _readEuler('head'),
            neck: _readEuler('neck'),
            lua: _readEuler('lua'),
            rua: _readEuler('rua'),
            lla: _readEuler('lla'),
            rla: _readEuler('rla'),
            lIndexProx: _readEuler('lIndexProximal'),
          };
          const _delta = (b: string, a: { x: number; y: number; z: number }) => {
            const b0 = (_boneBefore as Record<string, { x: number; y: number; z: number }>)[b];
            return {
              dx: Number((a.x - b0.x).toFixed(4)),
              dy: Number((a.y - b0.y).toFixed(4)),
              dz: Number((a.z - b0.z).toFixed(4)),
            };
          };
          console.log('[FRAME_TRACE]', {
            intent: _activeIntent,
            timingWeight: Number(_timingWeight.toFixed(3)),
            motionState: { ..._motionState },
            speaking,
          });
          console.log('[BONE_MAPPING]', {
            head: finalPose.has('head'),
            neck: finalPose.has('neck'),
            lua: finalPose.has('lua'),
            rua: finalPose.has('rua'),
            lla: finalPose.has('lla'),
            rla: finalPose.has('rla'),
            lh: finalPose.has('lh'),
            rh: finalPose.has('rh'),
            lIndexProx: finalPose.has('lIndexProximal'),
            totalKeys: finalPose.size,
          });
          console.log('[BONE_DELTA_AFTER_INTENT]', {
            head: _delta('head', _afterIntent.head),
            neck: _delta('neck', _afterIntent.neck),
            lua:  _delta('lua',  _afterIntent.lua),
            rua:  _delta('rua',  _afterIntent.rua),
            lla:  _delta('lla',  _afterIntent.lla),
            rla:  _delta('rla',  _afterIntent.rla),
            lIndexProx: _delta('lIndexProx', _afterIntent.lIndexProx),
          });
          console.log('[TIMING_WEIGHT]', Number(_timingWeight.toFixed(4)));
          console.log('[AMPLIFIED_MOTION]', {
            hn: Number((_applied.headNod ?? 0).toFixed(4)),
            ht: Number((_applied.headTilt ?? 0).toFixed(4)),
            og: Number((_applied.armOpen ?? 0).toFixed(4)),
            weight: Number(_timingWeight.toFixed(4)),
          });
          console.log('[CINEMATIC]', {
            intent: _activeIntent,
            weight: Number(_timingWeight.toFixed(4)),
            hn: Number((_applied.headNod ?? 0).toFixed(4)),
            ht: Number((_applied.headTilt ?? 0).toFixed(4)),
            og: Number((_applied.armOpen ?? 0).toFixed(4)),
            cinematicMode: _timingWeight > 0.4,
          });
          console.log('[AXIS_APPLIED]', {
            lua: `${BONE_AXIS_MAP.lua.open.axis}·${BONE_AXIS_MAP.lua.open.sign}`,
            rua: `${BONE_AXIS_MAP.rua.open.axis}·${BONE_AXIS_MAP.rua.open.sign}`,
            lla: `${BONE_AXIS_MAP.lla.open.axis}·${BONE_AXIS_MAP.lla.open.sign}`,
            rla: `${BONE_AXIS_MAP.rla.open.axis}·${BONE_AXIS_MAP.rla.open.sign}`,
            lh:  `${BONE_AXIS_MAP.lh.open.axis}·${BONE_AXIS_MAP.lh.open.sign}`,
            rh:  `${BONE_AXIS_MAP.rh.open.axis}·${BONE_AXIS_MAP.rh.open.sign}`,
          });
          console.log('[POSE_AFTER_INTENT]', {
            head: _afterIntent.head,
            neck: _afterIntent.neck,
          });
          console.log('[POSE_AFTER_INTENT_ARMS]', {
            lua: _afterIntent.lua,
            rua: _afterIntent.rua,
            lla: _afterIntent.lla,
            rla: _afterIntent.rla,
          });
          // Stash for end-of-frame override detection
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__afterIntentSnapshot = _afterIntent;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__readEuler = _readEuler;
        }

        // ── Priority attenuation global — presence/idle read this flag ───────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__intentAttenuation = _timingWeight;
        safeCall('biomechanical', () => applyBiomechanicalCorrections(
          finalPose,
          t,
          humSnap!.breathAmpMul,
          speaking,
        ), undefined);
        safeCall('finger',       () => applyFingerMicroLayer(finalPose, t, speaking), undefined);
        safeCall('gaze',         () => applyGazeIntentLayer(finalPose, _activeIntent, safeDelta, vrm), undefined);
        safeCall('neural',       () => applyNeuralLayer(finalPose, t, !!speaking, _timingWeight), undefined);
        safeCall('subconscious', () => applySubconsciousLayer(finalPose, t, _timingWeight, !!speaking), undefined);

        // Throttled checkpoint log (~1/s)
        if (typeof performance !== 'undefined') {
          const _now = performance.now();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _last = (globalThis as any).__motionLayerLastLog ?? 0;
          if (_now - _last > 1000) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__motionLayerLastLog = _now;
            const ts = getGestureTimingSnapshot();
            const _utterNow = getEmbodimentUtteranceTextForSemantics() ?? '';
            const _detailed = detectIntentDetailed(_utterNow);
            console.log('[INTENT]', _activeIntent);
            console.log('[INTENT_ACTIVE]', _activeIntent !== 'neutral' && _activeIntent !== '');
            console.log('[INTENT_TRACE]', {
              llmIntent: _llmIntent,
              ruleIntent: _detailed.intent,
              confidence: _detailed.confidence,
              reason: _detailed.reason,
              utterSample: _utterNow.slice(0, 80),
            });
            console.log('[FILE_EXECUTED] motionLayers', {
              intent: _activeIntent,
              timingPhase: ts.phase,
              timingWeight: Number(ts.weight.toFixed(3)),
              breathAmp: Number(humSnap.breathAmpMul.toFixed(3)),
              speaking,
              motionState: _motionState,
              applied: _applied,
            });
          }
        }
        // ── End new motion layers ─────────────────────────────────────────────
      }

      if (!isolateVrmaLayers) {
        safeCall('cinematic', () => applyCinematicMicroLayer(finalPose, safeDelta, t, {
          speaking,
          energy: Math.max(0.15, speechDriveSnap.energy),
          syllablePulse: speechDriveSnap.syllablePulse,
        }), undefined);
        safeCall('microHuman', () => applyMicroHumanBehavior(finalPose, embFrame, safeDelta, t, speaking), undefined);
        safeCall('idleMicro', () => applyIdleMicroPresence(finalPose, embFrame, safeDelta, {
          motionSource,
          gestureLayerW,
        }), undefined);
      }
    });

    if (humSnap && shouldTriggerBlinkEdge(humSnap) && typeof window !== 'undefined') {
      const em = behaviorPayload?.emotion ?? 'neutral';
      window.dispatchEvent(
        new CustomEvent('avatar:blink', {
          detail: { durationMs: blinkDurationMsForEmotion(em), style: 'normal' },
        }),
      );
    }

    if (VRMA_IDLE_MICRO_INJECT && motionSource === 'VRMA' && !speaking) {
      if (nextIdleMicroInjectAtMsRef.current === 0) {
        nextIdleMicroInjectAtMsRef.current = nowMs + 8000;
      }
      if (nowMs >= nextIdleMicroInjectAtMsRef.current && typeof window !== 'undefined') {
        const beat = Math.floor(nowMs / 1000);
        nextIdleMicroInjectAtMsRef.current = nowMs + 8000 + (beat % 3) * 1000;
        window.dispatchEvent(
          new CustomEvent('avatar:micro:gesture', {
            detail: { kind: 'nod', durationMs: 240 },
          }),
        );
      }
    } else {
      nextIdleMicroInjectAtMsRef.current = 0;
    }

    /** Procedural sway — unified energy only (audio already in unified mix). */
    const personaMotion = getCogniPersonaPerformanceScales();
    const proceduralMul = speaking ? personaMotion.proceduralIntensityMul : 1;

    logDebugThrottledCallback('MOTION', 'motion-source', 900, () => {
      logDebug('MOTION', '[MOTION_SOURCE]', {
        motionSource,
        vrmaLayerW: Number(vrmaLayerW.toFixed(3)),
        gestureLayerW: Number(gestureLayerW.toFixed(3)),
        idleLayerW: Number(idleLayerW.toFixed(3)),
        isolateVrmaLayers,
        proceduralOnly,
        proceduralApplied: !isolateVrmaLayers,
      });
    });

    /** Phase 20 — micro breathing / sway on spine & shoulders on VRMA clips, **or** when VRMA playback is frozen (substitute clip life). While speaking, keep overlay on so “life” does not depend on vrma weight alone. */
    if (
      !FREEZE_IDLE_ANIMATIONS &&
      !VRMA_ISOLATION_TEST &&
      ((motionSource === 'VRMA' && vrmaLayerW > 0.02) || vrmaPlaybackFrozen || speaking)
    ) {
      safeCall('vrmaOverlay', () => applyProceduralVrmaLifeOverlay(finalPose, t, safeDelta, {
        intensityMul: proceduralMul,
        neckSway: personaMotion.neckSway,
      }), undefined);
    }

    if (isAvatarMotionTraceOn() && motionTraceFrameRef.current % 100 === 0) {
      const vrmaLifeIntensityMul = proceduralMul;
      const vrmaLifeOverlayActive =
        !FREEZE_IDLE_ANIMATIONS &&
        !VRMA_ISOLATION_TEST &&
        ((motionSource === 'VRMA' && vrmaLayerW > 0.02) || vrmaPlaybackFrozen || speaking);
      motionTraceLog('VRMSkeletonManager useFrame [every 100 frames]', {
        frame: motionTraceFrameRef.current,
        clockSec: t,
        speaking,
        motionSource,
        vrmaLayerW,
        gestureLayerW,
        idleLayerW,
        vrmaLifeIntensityMul,
        vrmaLifeOverlayActive,
        speechDriveEnergy: speechDriveSnap.energy,
        speechDriveActive: speechDriveSnap.active,
        unifiedEnergySmoothed: getSmoothedUnifiedEnergy(),
        analyserConnected: Boolean(analyserNode),
      });
    }

    if (
      isDebugMotion() &&
      motionSource === 'VRMA' &&
      vrmaLayerW > 0 &&
      typeof process !== 'undefined' &&
      process.env.NODE_ENV === 'development' &&
      typeof performance !== 'undefined'
    ) {
      const _n = masterClockNowMs();
      if (_n >= __vrmaBlendInputLogNextAt) {
        __vrmaBlendInputLogNextAt = _n + 900;
        // eslint-disable-next-line no-console -- DEBUG: confirm vrma layer input vs long bone names
        console.log(
          'FINAL POSE KEYS (vrmaForBlend → blendPoseLayers `vrma`, not raw vrmaPoseRef)',
          [...vrmaForBlend.keys()],
        );
        // eslint-disable-next-line no-console -- DEBUG: long vs short pose keys on blend input
        console.log('vrmaForBlend arm name checks', {
          leftUpperArm: vrmaForBlend.has('leftUpperArm'),
          rightUpperArm: vrmaForBlend.has('rightUpperArm'),
          leftLowerArm: vrmaForBlend.has('leftLowerArm'),
          rightLowerArm: vrmaForBlend.has('rightLowerArm'),
          lua: vrmaForBlend.has('lua'),
          rua: vrmaForBlend.has('rua'),
          lla: vrmaForBlend.has('lla'),
          rla: vrmaForBlend.has('rla'),
        });
      }
    }

    if (localAxisCalibActive) {
      const bRua = m.get('rua');
      if (bRua) {
        const seg = Math.min(2, Math.floor(localAxisCalibElapsedMs / 1000));
        if (localAxisCalibPhaseLoggedRef.current !== seg) {
          localAxisCalibPhaseLoggedRef.current = seg;
          const axisLetter = seg === 0 ? 'X' : seg === 1 ? 'Y' : 'Z';
          // eslint-disable-next-line no-console -- intentional live diagnostic
          console.info(`[LocalAxisCalib] Testing Axis ${axisLetter} on rightUpperArm`);
        }
        if (seg === 0) {
          _LOCAL_AXIS_QDELTA.setFromAxisAngle(_LOCAL_AXIS_VX, LOCAL_AXIS_CALIB_RAD);
        } else if (seg === 1) {
          _LOCAL_AXIS_QDELTA.setFromAxisAngle(_LOCAL_AXIS_VY, LOCAL_AXIS_CALIB_RAD);
        } else {
          _LOCAL_AXIS_QDELTA.setFromAxisAngle(_LOCAL_AXIS_VZ, LOCAL_AXIS_CALIB_RAD);
        }
        _LOCAL_AXIS_QOUT.copy(bRua).multiply(_LOCAL_AXIS_QDELTA);
        finalPose.set('rua', _LOCAL_AXIS_QOUT.clone());
      }
    } else if (
      RUN_LOCAL_AXIS_CALIBRATION &&
      localAxisCalibStartMsRef.current != null &&
      !localAxisCalibDoneRef.current &&
      localAxisCalibElapsedMs >= LOCAL_AXIS_CALIB_DURATION_MS
    ) {
      localAxisCalibDoneRef.current = true;
      // eslint-disable-next-line no-console -- diagnostic summary vs armGestureReference
      console.info(
        '[LocalAxisCalib] Sequence finished. Interpret visually: which 1s block moved the hand most toward world +Y (up)? ' +
          'This test used +0.5 rad about each **bone-local** axis (axis-angle × bind). ' +
          'Compare to armGestureReference.ts: right forward = −X, up = −Z (local YXZ) — ' +
          'Euler channels need not match bone-local basis vectors one-to-one; note any mismatch you see.',
      );
    }

    if (MOTION_PIPELINE_DEBUG) {
      const lip = readLipSyncProbeFromWindow();
      logMotionPipelineFrame({
        speaking,
        energy: Number(speechDriveSnap.energy.toFixed(4)),
        syllablePulse: Number(speechDriveSnap.syllablePulse.toFixed(4)),
        gestureLayerW: Number(gestureLayerW.toFixed(4)),
        stabilizeMix: readStabilizeMixFromWindow(),
        motionSource,
        vrmaLayerW: Number(vrmaLayerW.toFixed(3)),
        idleLayerW: Number(idleLayerW.toFixed(3)),
        vrmaForBlendKeys: vrmaForBlend.size,
        finalPoseKeys: finalPose.size,
        hasNeck: finalPose.has('neck'),
        hasHead: finalPose.has('head'),
        speechActive: speechDriveSnap.active,
        inPause: speechDriveSnap.inPause,
        cinematicLayerWouldRun: true,
        microHumanWouldRun: true,
        visemeCount: lip?.visemeCount ?? 0,
        audioCurrentTime:
          lip?.audioCurrentTime != null ? Number(lip.audioCurrentTime.toFixed(5)) : null,
      });
    }

    const brainMs = useBrainStore.getState();
    const embT = brainMs.lastEmbodimentMotionAtMs;
    const embStale = embT > 0 && nowMs - embT > 2000;
    if (
      VRMA_IDLE_MICRO_INJECT &&
      motionSource === 'VRMA' &&
      embStale &&
      nowMs - lastEmbodimentFailsafeAtMsRef.current > 3000
    ) {
      lastEmbodimentFailsafeAtMsRef.current = nowMs;
      brainMs.pulseEmbodimentMotion(nowMs);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('avatar:micro:gesture', { detail: { kind: 'nod', durationMs: 240 } }),
        );
      }
    }

    /** Kinematic hold: re-stamp commanded Eulers after procedural stacks; snap full limb chain (no slerp drift). */
    let kinematicSnapKeys: Set<string> | undefined;
    if (genMix > 0.02 && !localAxisCalibActive) {
      kinematicSnapKeys = new Set<string>();
      const gb = generativeBonesRef.current;
      const expandedSnap = expandGenerativeSuppressedKeys(gb.keys());
      for (const key of expandedSnap) {
        const rot = gb.get(key);
        if (rot) {
          GEN_E.set(rot.x, rot.y, rot.z, 'YXZ');
          GEN_Q.setFromEuler(GEN_E);
          finalPose.set(key, GEN_Q.clone());
        }
        kinematicSnapKeys.add(key);
      }
      if (kinematicSnapKeys.size === 0) kinematicSnapKeys = undefined;
    }

    // ── End-of-frame override detection (final compare vs after-intent) ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _afterIntentSnap = (globalThis as any).__afterIntentSnapshot;
    if (_afterIntentSnap) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__afterIntentSnapshot = null;
      const _read = (key: string): { x: number; y: number; z: number } => {
        const q = finalPose.get(key);
        if (!q) return { x: NaN, y: NaN, z: NaN };
        const _eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
        _eTmp.setFromQuaternion(q, 'YXZ');
        return { x: _eTmp.x, y: _eTmp.y, z: _eTmp.z };
      };
      const _finalSnap = {
        head: _read('head'), neck: _read('neck'),
        lua: _read('lua'), rua: _read('rua'),
        lla: _read('lla'), rla: _read('rla'),
        lIndexProx: _read('lIndexProximal'),
      };
      const _override = (b: keyof typeof _finalSnap) => {
        const a = _afterIntentSnap[b] as { x: number; y: number; z: number };
        const f = _finalSnap[b];
        return {
          ox: Number((f.x - a.x).toFixed(4)),
          oy: Number((f.y - a.y).toFixed(4)),
          oz: Number((f.z - a.z).toFixed(4)),
        };
      };
      console.log('[BONE_DELTA_AFTER_ALL]', {
        head: _override('head'), neck: _override('neck'),
        lua: _override('lua'), rua: _override('rua'),
        lla: _override('lla'), rla: _override('rla'),
        lIndexProx: _override('lIndexProx'),
      });
      console.log('[POSE_BEFORE_VRM]', {
        head: _finalSnap.head,
        neck: _finalSnap.neck,
        lua:  _finalSnap.lua,
        rua:  _finalSnap.rua,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__poseForAfterVrmCheck = true;
    }

    // ── PHASE 1: Critical path asserts (non-throwing) ─────────────────────────
    assertOrLog(finalPose.size > 0,                   'finalPose_empty_before_apply');
    assertOrLog(!!vrm.humanoid,                       'vrm_humanoid_null');
    assertOrLog(safeDelta >= 0 && safeDelta < 0.5,    `safeDelta_out_of_range:${safeDelta.toFixed(4)}`);

    // ── PHASE 2: Health-based motion scaling (behind AVATAR_SAFE_MODE) ────────
    if (AVATAR_SAFE_MODE && errorState.active) {
      const _health = getHealthScore();
      if (_health < 1.0) {
        finalPose.forEach((q, key) => {
          const rest = bindRef.current.get(key);
          if (rest) q.slerp(rest, (1 - _health) * 0.5);
        });
        if (AVATAR_DEBUG) {
          console.log('[ERROR_BEHAVIOR_LINK]', {
            health:       _health.toFixed(2),
            activeErrors: getErrorCount(),
            disabledLayers: [...errorState.disabledLayers],
          });
        }
      }
    }

    // ── PHASE 1: Beacon — perf-throttled, every 3 s (AVATAR_DEBUG only) ───────
    if (AVATAR_DEBUG) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _beaconNow = typeof performance !== 'undefined' ? performance.now() : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _lastBeacon = (globalThis as any).__avatarBeaconLastMs ?? 0;
      if (_beaconNow - _lastBeacon >= 3000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__avatarBeaconLastMs = _beaconNow;
        console.log('[AVATAR_AUDIT:BEACON]', {
          timeSec:          t.toFixed(1),
          fps:              Math.round(1 / (safeDelta || 0.016)),
          speaking,
          motionSource,
          finalPoseSize:    finalPose.size,
          errorsLogged:     getErrorCount(),
          systemHealth:     getHealthScore().toFixed(2),
          selfHealingActive: errorState.active,
          disabledLayers:   [...errorState.disabledLayers],
        });
      }
    }

    // ── PHASE 3: Self-healing tick — auto-resets errorState after 3 s clean ───
    tickSelfHealing();

    // TASK 4: sniper probes (only active when window.__sniperActive = true)
    // activateSniper(['finalPose'])  — pauses DevTools exactly on throw
    sniper('finalPose', () => {
      if (finalPose.size === 0) throw new Error('finalPose is empty');
      if (!vrm.humanoid)       throw new Error('vrm.humanoid is null');
    });

    safeCall('finalPoseToVrm', () => applyFinalPoseToVrm({
      finalPose,
      humanoid: vrm.humanoid ?? null,
      kinematicSnapKeys,
      smoothLambda: 8,
      maxRotationPerFrameRad: 0.35,
      boneRefs: {
        hips: hipsRef.current,
        spine: spineRef.current,
        chest: chestRef.current,
        neck: neckRef.current,
        head: headRef.current,
        leftShoulder: leftShoulderRef.current,
        rightShoulder: rightShoulderRef.current,
        lua: luaRef.current,
        rua: ruaRef.current,
        lla: llaRef.current,
        rla: rlaRef.current,
        lh: lhRef.current,
        rh: rhRef.current,
        rIndexProximal: rIndexProximalRef.current,
        rMiddleProximal: rMiddleProximalRef.current,
        rRingProximal: rRingProximalRef.current,
        rLittleProximal: rLittleProximalRef.current,
        rThumbProximal: rThumbProximalRef.current,
        lIndexProximal: lIndexProximalRef.current,
        lMiddleProximal: lMiddleProximalRef.current,
        lRingProximal: lRingProximalRef.current,
        lLittleProximal: lLittleProximalRef.current,
        lThumbProximal: lThumbProximalRef.current,
      },
      delta: safeDelta,
    }), undefined);

    // ─── [POSE_AFTER_VRM] — read actual scene-graph rotations post-apply ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((globalThis as any).__poseForAfterVrmCheck) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__poseForAfterVrmCheck = false;
      const _eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
      const _readNode = (node: THREE.Object3D | null | undefined) => {
        if (!node) return { x: NaN, y: NaN, z: NaN };
        _eTmp.setFromQuaternion(node.quaternion, 'YXZ');
        return {
          x: Number(_eTmp.x.toFixed(4)),
          y: Number(_eTmp.y.toFixed(4)),
          z: Number(_eTmp.z.toFixed(4)),
        };
      };
      let _luaNode: THREE.Object3D | null = luaRef.current;
      let _ruaNode: THREE.Object3D | null = ruaRef.current;
      let _llaNode: THREE.Object3D | null = llaRef.current;
      let _rlaNode: THREE.Object3D | null = rlaRef.current;
      if (vrm.humanoid) {
        try {
          if (!_luaNode) _luaNode = vrm.humanoid.getNormalizedBoneNode('leftUpperArm') ?? null;
          if (!_ruaNode) _ruaNode = vrm.humanoid.getNormalizedBoneNode('rightUpperArm') ?? null;
          if (!_llaNode) _llaNode = vrm.humanoid.getNormalizedBoneNode('leftLowerArm') ?? null;
          if (!_rlaNode) _rlaNode = vrm.humanoid.getNormalizedBoneNode('rightLowerArm') ?? null;
        } catch { /* ignore */ }
      }
      console.log('[POSE_AFTER_VRM]', {
        head: _readNode(headRef.current),
        neck: _readNode(neckRef.current),
        lua:  _readNode(_luaNode),
        rua:  _readNode(_ruaNode),
        lla:  _readNode(_llaNode),
        rla:  _readNode(_rlaNode),
      });
    }

    // ─── vrm.update() — Phase 20 “heartbeat” ──────────────────────────────────
    // Every frame while the canvas runs: propagate humanoid + expressionManager + spring bones.
    // AnimationController (priority −2) and LipSyncManager (−1) write morphs first; this applies them.
    // TASK 2: pre-vrm.update snapshot (throttled ~1/s)
    const _diagNow  = typeof performance !== 'undefined' ? performance.now() : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _diagLast = (globalThis as any).__diagSnapshotLastMs ?? 0;
    const _doDiagSnap = _diagNow - _diagLast > 1000;
    if (_doDiagSnap) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__diagSnapshotLastMs = _diagNow;
      const _eT = new THREE.Euler(0, 0, 0, 'YXZ');
      const _snapB = (node: THREE.Object3D | null) => {
        if (!node) return null;
        _eT.setFromQuaternion(node.quaternion, 'YXZ');
        return { x: +_eT.x.toFixed(4), y: +_eT.y.toFixed(4), z: +_eT.z.toFixed(4) };
      };
      const _preSnap = { head: _snapB(headRef.current), lua: _snapB(luaRef.current), rua: _snapB(ruaRef.current) };
      console.log('[DIAG_PRE_VRM_UPDATE]', _preSnap);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__diagPreSnap = _preSnap;
    }

    if (!VRM_HARD_ISOLATION) {
      vrm.update(safeDelta);
    }

    // TASK 2: post-vrm.update snapshot + override-detection
    if (_doDiagSnap) {
      const _eT2 = new THREE.Euler(0, 0, 0, 'YXZ');
      const _snapB2 = (node: THREE.Object3D | null) => {
        if (!node) return null;
        _eT2.setFromQuaternion(node.quaternion, 'YXZ');
        return { x: +_eT2.x.toFixed(4), y: +_eT2.y.toFixed(4), z: +_eT2.z.toFixed(4) };
      };
      const _postSnap = { head: _snapB2(headRef.current), lua: _snapB2(luaRef.current), rua: _snapB2(ruaRef.current) };
      console.log('[DIAG_POST_VRM_UPDATE]', _postSnap);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _preStored = (globalThis as any).__diagPreSnap as { head: { x: number } | null } | undefined;
      if (_preStored?.head && _postSnap.head) {
        const _headDelta = Math.abs(_postSnap.head.x - _preStored.head.x);
        if (_headDelta > 0.01) {
          console.warn(
            '[DIAG_VRM_UPDATE_OVERRIDE] WARNING vrm.update() changed head.x by', _headDelta.toFixed(4),
            '=> vrm.lookAt or autoUpdateHumanBones is resetting bones!',
            { before: _preStored.head.x, after: _postSnap.head.x },
          );
        } else {
          console.log('[DIAG_VRM_UPDATE_OVERRIDE] OK head.x stable across vrm.update()');
        }
      }
    }

    // TASK 1: forced direct bone write test (enable: window.__forcedMotionTest = true)
    // Run AFTER vrm.update() so this is the LAST write.
    // If arms/head MOVE  => render pipeline OK, bug is upstream
    // If arms/head STILL => bone/render pipeline broken
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((typeof window !== 'undefined') && (window as any).__forcedMotionTest) {
      const _fmtSin = Math.sin(performance.now() * 0.002) * 0.3;
      if (headRef.current) headRef.current.rotation.x = _fmtSin;
      if (luaRef.current)  luaRef.current.rotation.z  =  0.8;
      if (ruaRef.current)  ruaRef.current.rotation.z  = -0.8;
      if (neckRef.current) neckRef.current.rotation.y = Math.sin(performance.now() * 0.001) * 0.15;
      console.log('[FORCED_MOTION_TEST]', {
        head_x:    headRef.current?.rotation.x.toFixed(3) ?? 'NULL_REF',
        lua_z:     luaRef.current?.rotation.z.toFixed(3)  ?? 'NULL_REF',
        rua_z:     ruaRef.current?.rotation.z.toFixed(3)  ?? 'NULL_REF',
        refsExist: { head: !!headRef.current, lua: !!luaRef.current, rua: !!ruaRef.current },
        verdict:   (!headRef.current && !luaRef.current)
          ? 'REFS_NULL => bone mapping broken'
          : 'refs_valid => if no movement, check scene graph parenting',
      });
    }

    enforceAvatarRootStability(vrm);

    prevMotionSourceRef.current = motionSource;
  }, 0);

  return null;
}