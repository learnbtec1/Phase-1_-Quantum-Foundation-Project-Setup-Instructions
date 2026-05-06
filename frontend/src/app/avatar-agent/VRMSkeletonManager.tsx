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
import { applyUpperArmGestureCalib } from './motion/gestureWorldCalibration';
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
  applyBiomechanicalLayer,
  detectBothArms,
  loadAxisMapFromStorage,
  getAxisMapSnapshot,
  applyIntentMotionState,
  applyNeuralLayer,
  applySubconsciousLayer,
  BONE_AXIS_MAP,
  setBoneAxisMap,
  type BiomechContext,
} from './motion/biomechanicalCorrectionLayer';
import { applyFingerMicroLayer } from './motion/fingerMicroLayer';
import { applyHumanMicroBehavior } from './motion/humanMicroBehavior';
import { applyGazeIntentLayer } from './motion/gazeIntentLayer';
import { tickGestureTiming, getGestureTimingSnapshot } from './motion/gestureTiming';
import { detectIntent, detectIntentDetailed } from './motion/intentClassifier';
import {
  pushBehavior as pushBehaviorEvent,
  pushBehaviorFromSemanticDecision,
  tickBehaviorTimeline,
  getCurrentBehavior,
  getBehaviorQueueDepth,
  getInertiaSnapshot,
  getLastBehaviorAudit,
  getAnticipationOverlay,
  setEmotion as setBehaviorEmotion,
  getEmotion as getBehaviorEmotion,
  clearBehaviorQueue,
  type BehaviorFrame,
  type TimelineGestureId,
} from './motion/behaviorTimeline';
import {
  resolveSemanticGesture,
  resetSemanticGestureBridgeState,
} from './motion/semanticGestureBridge';
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
import {
  tickUnifiedEnergy,
  getSmoothedUnifiedEnergy,
  tickStableMotionEnergy,
  getStableMotionEnergy,
} from '@/lib/avatar/unifiedEnergyModel';
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
import {
  BoneAuthority,
  tickFrameCounter as tickAuthorityFrameCounter,
  resetBoneAuthorityFrame,
  registerBoneAuthority,
  applyBoneRotationSafe,
  captureSignatureSnapshot,
  diffAndRegisterAuthority,
  readLiveBoneSnapshot,
  traceInput as traceAuthorityInput,
  tracePoseComposer,
  traceBeforeApply,
  traceAfterApply,
  traceAfterVrmUpdate,
  traceFinalFrame,
  detectPoseLoss,
  detectVrmOverride,
  tickFreezeDetector,
  logRootMotion,
  beginFrameTraceGroup,
  endFrameTraceGroup,
  emitRootCauseIfAny,
  computeVrmaSafetyOverrides,
  tickLocomotionWatcher,
  TRACKED_POSE_KEYS,
  TRACKED_HUMANOID_NAMES,
} from './motion/__boneAuthority';
import {
  getBehaviorState,
  applyBehaviorSyncModifiers,
  checkSyncAlignment,
  checkFreezeVsSpeech,
  enforceHardSyncGuarantee,
  validateEmotionEffect,
  validateIntentEffect,
  validateAvatarPipeline,
  mergeBehaviorEngineMotionScalars,
} from './motion/__behaviorSync';
import { applySpeechFusion, peekSpeechEnergy } from './motion/__speechFusion';
import {
  computeProceduralLowerBody,
  applyLowerBodyState,
  type LowerBodyContext,
} from './motion/proceduralLowerBody';
import { applyPersonalityMotion } from './motion/__personalityMotion';
import { applyMotionDynamics, resetMotionDynamics } from './motion/__motionDynamics';
import {
  applyDirectionalMotionModulation,
  applyAvatarForwardCorrection,
  classifyForward,
  getAvatarForward,
  getFwdCorrectionKey,
  getArmAxisKey,
} from './motion/directionalMotionModulation';
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
import { recordActivity, getMotionTraceOverlayState } from '@/lib/avatar/motionDiagnostics';
import { getMotionSchedulerCooldownDebug } from '@/lib/avatar/motionScheduler';
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
//   Bone-local only (NOT world +Z): RIGHT Forward = −X, Up = −Z, Down = +Z.
//   LEFT: Forward = +X (mirror); Z mirrors idle hang.
//   World/scene forward remains +Z — see `config/avatar.ts`.
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

// ─── TTS fallback signal (no allocations per frame) ─────────────────────
// Smooth pseudo-speech envelope for when window.__ttsFailed === true.
// Two summed sines mimic a syllable cadence + sub-syllabic micro-modulation.
// Range stays in [~0.0, ~0.6]; floor clamp guarantees a floor that prevents
// the motion pipeline from collapsing to dead-state.
function getFallbackEnergy(time: number): number {
  const e = 0.3 + 0.2 * Math.sin(time * 6) + 0.1 * Math.sin(time * 13);
  return e < 0.05 ? 0.05 : e;
}

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
const INTENT_HOLD_OSC_AMP  = 0.052; // ±5.2% of target amplitude
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
const FOLLOW_ARM_BLEND_BUMP = 0.14;

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
const BIO_FOLLOW_OVERSHOOT = 0.072;
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

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION-LOOP AUDIT — module-scope state (zero per-frame allocs).
//
// Tracks frame count, FPS, stage timestamps, and override detection.
// One [EXECUTION_DIAGNOSIS] log per second with the complete report.
// ═══════════════════════════════════════════════════════════════════════════
const _execLoop = {
  frameCount:        0,
  fpsWindowStartMs:  0,
  fpsWindowFrames:   0,
  measuredFps:       0,
  earlyReturnReason: null as string | null,  // last frame's early-return cause
  // Stage timestamps from the most recent completed frame (ms).
  s_motionEnd:       0,
  s_finalPoseEnd:    0,
  s_humanoid1End:    0,
  s_biomechEnd:      0,
  s_humanoid2End:    0,
  s_frameEnd:        0,
  s_motionExecuted:  false,
  s_finalPoseExecuted: false,
  s_humanoid1Executed: false,
  s_biomechExecuted: false,
  s_humanoid2Executed: false,
  // Override detection snapshots (leftUpperArm raw rotation z).
  ov_afterBio:       NaN,
  ov_atFrameEnd:     NaN,
  lastDiagnosisMs:   0,
};

/** Hard-proof execution trace (debug only; reset each useFrame). */
function _resetExecTraceGlobals(): void {
  if (typeof globalThis === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  g.__execTraceBiomech = false;
  g.__execTraceHumanoid2 = false;
  g.__execTracePoseApplied = false;
}

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
  /** Exponential smoothing state for upper-arm / shoulder gesture targets (follow-through lag). */
  const smoothedGestureArmRef = useRef<Map<string, THREE.Quaternion>>(new Map());

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
  /** Throttle [MOTION_AUTHORITY_HARD] when idle blend wins despite timeline gesture. */
  const lastMotionAuthorityHardWarnMsRef = useRef(0);
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
  /** Auto-talk gesture cycling state — used by SINGLE_CONTROLLER intent-driven trigger. */
  const talkGestureActiveRef = useRef(false);
  /** Earliest ms the auto-trigger may fire next (cool-down between cycles). */
  const talkGestureNextAtMsRef = useRef(0);
  /**
   * Per-utterance semantic-gesture debounce key.
   * Hash of current utterance text — guarantees a greeting fires `wave` AT MOST
   * once per utterance even though `useFrame` re-evaluates intent every tick.
   * Cleared on `avatar:speak:end` so the next utterance is classified fresh.
   */
  const lastSemanticUtteranceHashRef = useRef<string>('');
  /** The semantic intent we already fired this utterance (prevents re-fire). */
  const lastSemanticIntentFiredRef = useRef<string>('');
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

  // ── HARD-LINK: avatar:speak:start/:end → localSpeakingRef ─────────────────
  // Defense-in-depth: even if isTalkingRef (parent-managed) does not update for
  // any reason (race conditions, missing parent listener), we keep our own
  // local mirror updated directly from window events.  Speaking source used
  // for energy injection = isTalkingRef.current || localSpeakingRef.current
  const localSpeakingRef = useRef(false);
  const localSpeakingUntilMsRef = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStart = (e: Event): void => {
      localSpeakingRef.current = true;
      const detail = (e as CustomEvent<{ durationMs?: number }>).detail;
      if (detail?.durationMs && Number.isFinite(detail.durationMs)) {
        localSpeakingUntilMsRef.current =
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) +
          detail.durationMs + 250;
      } else {
        localSpeakingUntilMsRef.current = 0;
      }
      console.log('[SPEAKING_STATE]', { speaking: true, source: 'avatar:speak:start' });
    };
    const onEnd = (): void => {
      localSpeakingRef.current = false;
      localSpeakingUntilMsRef.current = 0;
      console.log('[SPEAKING_STATE]', { speaking: false, source: 'avatar:speak:end' });
      // Allow rhythm / anticipation / inertia state to settle from the current
      // motion values rather than snapping — the decay is built into the module.
      // We still reset on end so next utterance starts fresh.
      resetMotionDynamics();
      // Clear semantic-gesture per-utterance memory so the next greeting/agree/
      // think/etc. utterance can re-fire its dedicated gesture.
      lastSemanticUtteranceHashRef.current = '';
      lastSemanticIntentFiredRef.current = '';
      resetSemanticGestureBridgeState();
      // Drop any queued behaviors so the next utterance starts from a clean
      // timeline (prevents stale wave/explain firing into the next sentence).
      clearBehaviorQueue();
    };
    window.addEventListener('avatar:speak:start', onStart as EventListener);
    window.addEventListener('avatar:speak:end',   onEnd);
    return () => {
      window.removeEventListener('avatar:speak:start', onStart as EventListener);
      window.removeEventListener('avatar:speak:end',   onEnd);
    };
  }, []);

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

    // ── BehaviorTimeline DevTools API ───────────────────────────────────────
    // Manual gesture trigger via the timeline (with full anticipation / action /
    // recovery phases). Useful for testing without running speech.
    //   window.__pushBehavior('wave')
    //   window.__pushBehavior('wave', { intensity:1, baseDurationMs:2400 })
    //   window.__setEmotion({ valence:0.8, arousal:0.9 })   // joyful, energetic
    w.__pushBehavior = (
      type: TimelineGestureId,
      opts?: { baseDurationMs?: number; intensity?: number; priority?: number; source?: string },
    ) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return pushBehaviorEvent(type, now, { source: 'devtools', ...(opts ?? {}) });
    };
    w.__setEmotion = (next: { valence?: number; arousal?: number }) => {
      setBehaviorEmotion(next);
      return getBehaviorEmotion();
    };
    w.__getEmotion = () => getBehaviorEmotion();

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

      // ── Arm-axis detector + axis map inspector (callable from DevTools) ────
      // window.__detectArmAxis()      → probe both arms, log [ARM_AXIS_REPORT], no change
      // window.__detectArmAxis(true)  → probe + patch BONE_AXIS_MAP + save to localStorage
      // window.__armAxisMap()         → show current BONE_AXIS_MAP state
      // window.__armDebug             → live per-frame rotation snapshot (from biomechanical layer)
      // (hooks registered by separate useEffect below — already wired)
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

  // ── Self-calibrating arm-axis system (runs once per VRM load) ─────────────
  //
  // On every VRM mount:
  //   1. Try to restore a previously saved axis map from localStorage (zero cost).
  //   2. If cache hit  → apply immediately, skip probe, log [ARM_AXIS_LOADED_FROM_CACHE].
  //   3. If cache miss → run a one-shot probe (read-only, <1ms) and log results.
  //      The probe does NOT patch automatically; the dev must call
  //      window.__detectArmAxis(true) once to confirm and persist the result.
  //
  // Per-frame work: zero. The probe never runs inside useFrame.
  // Window API:
  //   window.__detectArmAxis()      → probe + log, no change
  //   window.__detectArmAxis(true)  → probe + patch BONE_AXIS_MAP + save to localStorage
  //   window.__armAxisMap()         → inspect current BONE_AXIS_MAP state
  //   localStorage.removeItem('cogni_arm_axis_map_v1')  → clear cache for re-probe
  useEffect(() => {
    if (!vrm?.humanoid) return;
    const humanoid = vrm.humanoid;

    // STEP 6 — Model key: scopes all localStorage entries to this specific VRM
    // so multiple avatars never overwrite each other's calibration data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelKey: string | undefined = (vrm as any).meta?.title || (vrm as any).meta?.name || undefined;

    // ── STEP 1 / 2: Use liftNode (vrm.scene.parent) as correction target ──────
    // Rotating vrm.scene directly can conflict with VRM's internal lookAt and
    // floorLock updates. liftNode is the designated transform-adjustment layer
    // in the scene hierarchy: AvatarRoot → liftNode → vrm.scene.
    // Fallback: if liftNode is missing (unusual), rotate vrm.scene.
    const liftNode  = vrm.scene?.parent ?? null;
    const vrmRoot   = (liftNode ?? vrm.scene) as THREE.Object3D | null;

    // ── STEP 8 — PIPELINE ORDER (enforced here, must not be reordered) ────────
    // 1. applyAvatarForwardCorrection   ← world forward must be +Z before probe
    // 2. loadAxisMapFromStorage         ← arm axis cache (model-keyed)
    // 3. detectBothArms (if no cache)   ← one-shot probe
    // --- per-frame motion pipeline follows in useFrame ---

    // ── 1. Forward correction ─────────────────────────────────────────────────
    if (vrmRoot) {
      try {
        applyAvatarForwardCorrection(vrmRoot, modelKey);
      } catch (e) {
        console.warn('[FORWARD_CORRECTION] Failed:', e);
      }
    }

    // ── 2. Register DevTools window hooks ─────────────────────────────────────
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__detectArmAxis         = (patchMap = false) => detectBothArms(humanoid, patchMap, modelKey);
      w.__armAxisMap            = () => getAxisMapSnapshot();
      w.__avatarForward         = () => vrmRoot ? getAvatarForward(vrmRoot) : null;
      w.__avatarForwardClassify = () => vrmRoot ? classifyForward(vrmRoot) : null;
      /** window.__setAvatarForwardCorrection(90) → manual override in degrees */
      w.__setAvatarForwardCorrection = (angleDeg: number) => {
        if (!vrmRoot) { console.warn('[FORWARD_CORRECTION] no root'); return; }
        const rad = angleDeg * Math.PI / 180;
        vrmRoot.rotation.y = rad;
        vrmRoot.updateWorldMatrix(true, true);
        try {
          localStorage.setItem(
            getFwdCorrectionKey(modelKey),
            JSON.stringify({ correctionY: rad, classification: 'MANUAL' }),
          );
        } catch { /* ignore */ }
        console.log('[FORWARD_CORRECTION] manual override applied', {
          angleDeg, rad: +rad.toFixed(4),
          forwardAfter: getAvatarForward(vrmRoot),
          modelKey: modelKey ?? 'default',
        });
      };
      /** Clears both forward + arm-axis cache for this model */
      w.__clearAvatarCalibration = () => {
        try {
          localStorage.removeItem(getFwdCorrectionKey(modelKey));
          localStorage.removeItem(getArmAxisKey(modelKey));
          console.log('[CALIBRATION] cleared for model', modelKey ?? 'default');
        } catch { /* ignore */ }
      };
      console.log('[ARM_AXIS_HOOK_READY] __detectArmAxis / __armAxisMap / __avatarForward / __clearAvatarCalibration registered', { modelKey: modelKey ?? 'default' });
    }

    // ── 3. Arm-axis self-calibration (model-keyed — STEP 6) ──────────────────
    const cached = loadAxisMapFromStorage(modelKey);
    if (cached) return;

    try {
      detectBothArms(humanoid, false, modelKey);
      console.log('[ARM_AXIS_INITIAL_PROBE] Probe complete. Call window.__detectArmAxis(true) to persist.', { modelKey: modelKey ?? 'default' });
    } catch (e) {
      console.warn('[ARM_AXIS_INITIAL_PROBE] Failed:', e);
    }
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
    _resetExecTraceGlobals();
    const _traceTestBone = vrm?.humanoid?.getRawBoneNode?.('rightUpperArm' as never);

    // ── EXECUTION-LOOP AUDIT — frame entry ────────────────────────────────────
    // Reset per-frame stage flags so a missing stage is visible in the report.
    _execLoop.frameCount += 1;
    _execLoop.fpsWindowFrames += 1;
    _execLoop.s_motionExecuted = false;
    _execLoop.s_finalPoseExecuted = false;
    _execLoop.s_humanoid1Executed = false;
    _execLoop.s_biomechExecuted = false;
    _execLoop.s_humanoid2Executed = false;
    _execLoop.earlyReturnReason = null;
    const _execNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (_execLoop.fpsWindowStartMs === 0) _execLoop.fpsWindowStartMs = _execNow;

    if (isAvatarMotionTraceOn()) {
      motionTraceFrameRef.current += 1;
    }
    // Per-frame hard guard: evict VRMA authority in procedural-only mode.
    assertNoVrmaLeak();

    // ── BONE AUTHORITY: per-frame state reset ─────────────────────────────────
    // Must run before any layer touches finalPose / bones so the conflict map
    // is fresh.  Returns the new frame counter — used by the trace throttle
    // (every 20th frame) and the freeze detector (≥90 frames without motion).
    tickAuthorityFrameCounter();
    resetBoneAuthorityFrame();

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
      _execLoop.earlyReturnReason = 'BONES_NOT_READY (ruaRef.current is null)';
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
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__EXECUTION_TRACE = {
          useFrameRunning: true,
          vrmLoaded: !!vrm && !!vrm.humanoid,
          bonesAvailable: !!_traceTestBone,
          earlyReturnTriggered: true,
          poseApplied: false,
          biomechRunning: false,
          humanoidUpdated: false,
          rootCause:
            'useFrame returned before procedural stack — ruaRef.current is null (bones not cached or humanoid missing normalized refs)',
        };
      }
      return;
    }

    // ── BONE AUTHORITY: open the per-frame trace group ────────────────────────
    // Lazy-open: only fires on log frames (every 20th frame, gated by
    // AVATAR_DEBUG).  Always paired with endFrameTraceGroup() at the bottom
    // of useFrame so we never leak nested console groups.
    beginFrameTraceGroup();

    // ── Speaking source: parent-managed ref OR local event-driven ref ─────────
    // The local ref keeps speaking=true for the dispatched `durationMs` even if
    // the parent never flips isTalkingRef (e.g. silent-speak fallback path).
    const _localSpeakActive =
      localSpeakingRef.current &&
      (localSpeakingUntilMsRef.current === 0 ||
       (typeof performance !== 'undefined' ? performance.now() : Date.now()) <
         localSpeakingUntilMsRef.current);
    if (localSpeakingRef.current && !_localSpeakActive) {
      // Auto-clear when our internal duration expired (failsafe in case
      // `avatar:speak:end` was dropped).
      localSpeakingRef.current = false;
      localSpeakingUntilMsRef.current = 0;
    }

    function getUnifiedSpeakingState(): boolean {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lifecycle =
        typeof window !== 'undefined'
          ? ((window as any).__speechLifecycle as
              | {
                  isSpeaking?: boolean;
                  blockedCount?: { prematureEnd: number; overlappingStart: number; debounced: number };
                }
              | null
              | undefined)
          : null;

      const bc = lifecycle?.blockedCount;
      if (bc && (bc.prematureEnd > 0 || bc.overlappingStart > 0)) {
        if (typeof window !== 'undefined' && !(window as Window & { __speakBlockWarned?: boolean }).__speakBlockWarned) {
          (window as Window & { __speakBlockWarned?: boolean }).__speakBlockWarned = true;
          console.warn('[SPEAK_BLOCK_DETECTED]', bc);
        }
        // Temporary bypass: motion/effects layers saw speaking=false while TTS played — unblock gestures.
        return true;
      }

      const fromLifecycle = lifecycle?.isSpeaking === true;
      const fromRef = isTalkingRef.current === true;
      return fromLifecycle || fromRef || _localSpeakActive;
    }

    // ── TTS fail-safe (time-limited + decaying + context-aware) ──────────────
    // The fallback is **not** a permanent override.  It opens a 3 s window
    // starting at __ttsFailedAt and decays linearly to 0; speaking is gated by
    // the synthetic energy crossing 0.08 so the avatar returns to idle when
    // the envelope drops below that floor.  All state lives on window — no
    // per-frame allocations.
    const _fbNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const FALLBACK_DURATION_MS = 3000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _wAny = (typeof window !== 'undefined' ? (window as any) : null);
    const _ttsFailedAt =
      _wAny && typeof _wAny.__ttsFailedAt === 'number' ? _wAny.__ttsFailedAt : 0;
    const _fbAgeMs = _ttsFailedAt > 0 ? _fbNowMs - _ttsFailedAt : Number.POSITIVE_INFINITY;
    const fallbackActive =
      _wAny?.__ttsFailed === true && _ttsFailedAt > 0 && _fbAgeMs < FALLBACK_DURATION_MS;
    const _fbDecay = fallbackActive
      ? Math.max(0, 1 - Math.min(_fbAgeMs / FALLBACK_DURATION_MS, 1))
      : 0;
    const _fbT = _fbNowMs * 0.001;
    const _fallbackEnergyValue = fallbackActive ? getFallbackEnergy(_fbT) * _fbDecay : 0;

    const speaking =
      getUnifiedSpeakingState() ||
      (fallbackActive && _fallbackEnergyValue > 0.08);

    if (_wAny) {
      _wAny.__SPEAK_DEBUG = {
        lifecycle: _wAny.__speechLifecycle ?? null,
        isTalkingRef: isTalkingRef.current,
        fallbackActive,
        fallbackEnergy: _fallbackEnergyValue,
        unified: speaking,
      };
    }

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

    // ═══════════════════════════════════════════════════════════════════════════
    // PIPER → ENERGY PIPELINE (Tasks 1–7)
    //   Task 1: HTMLAudioElement → analyser via wireAnalyser() in AvatarCanvas
    //   Task 2: createMediaElementSource + createAnalyser (fftSize=512)
    //   Task 3: getByteTimeDomainData → RMS in readAnalyserRms01()
    //   Task 4: Normalized * 2.85 + clamp01 (in extractor)
    //   Task 5: audioRms01 → tickUnifiedEnergy (below)
    //   Task 6: Silent-speak + emergency fallback (sine pulse)
    //   Task 7: [PIPER_RMS] debug log every ~250ms while speaking
    // ═══════════════════════════════════════════════════════════════════════════
    const analyserNode = analyserRef?.current ?? null;
    let audioRms01 = 0;
    let audioRmsSource: 'analyser' | 'emergency' | 'silent-speak' | 'safety-guard' | 'silent' = 'silent';
    if (analyserNode) {
      audioRms01 = readAnalyserRms01(analyserNode, timeDomainBufRef);
      audioRmsSource = 'analyser';
      if (speaking && audioRms01 < 0.02) {
        const _t = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.002;
        audioRms01 = 0.35 + Math.abs(Math.sin(_t)) * 0.35;
        audioRmsSource = 'silent-speak';
      }
    } else if (speaking) {
      const _t = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.002;
      audioRms01 = 0.35 + Math.abs(Math.sin(_t)) * 0.35;
      audioRmsSource = 'emergency';
    }
    // ── TASK 3: Safety guard — speaking MUST always produce non-zero energy ──
    // If speaking flipped true between branches (race), or any branch returned 0,
    // force a baseline so motion never freezes mid-utterance.
    if (audioRms01 === 0 && speaking) {
      audioRms01 = 0.40;
      audioRmsSource = 'safety-guard';
    }
    // ── TASK 4: [PIPER_RMS] + [FINAL_RMS] — debug only, ≤ ~0.5/s (motion debug env)
    if (
      isDebugMotion() &&
      speaking &&
      typeof performance !== 'undefined'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _piperLast = (globalThis as any).__piperRmsLogLastMs ?? 0;
      const _piperNow  = performance.now();
      if (_piperNow - _piperLast > 2000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__piperRmsLogLastMs = _piperNow;
        console.log('[PIPER_RMS]', {
          rms:           Number(audioRms01.toFixed(3)),
          source:        audioRmsSource,
          analyserWired: !!analyserNode,
          speaking,
        });
        console.log('[FINAL_RMS]', Number(audioRms01.toFixed(3)));
      }
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
    const _unifiedNow = getSmoothedUnifiedEnergy();
    patchSpeechEmotionEnergy(_unifiedNow);

    // ── Energy pipeline (real viseme → smoothed TTS → decaying fallback) ─────
    // Resolution order:
    //   1. Real viseme/speech energy when present (>0.01).
    //   2. Smoothed unified TTS energy (window.__lastTTSEnergy) when fallback
    //      window is **not** active — prevents stale energy from masking the
    //      synthetic envelope while the 3 s window is open.
    //   3. The decaying synthetic fallback when fallbackActive.
    //   4. Otherwise 0.
    function getUnifiedEnergy(): number {
      const e = peekSpeechEnergy();
      if (e > 0.01) return e;
      const fallbackRaw = _wAny?.__lastTTSEnergy;
      const ttsFallback =
        typeof fallbackRaw === 'number' && Number.isFinite(fallbackRaw) ? fallbackRaw : 0;
      if (ttsFallback > 0.01 && !fallbackActive) return ttsFallback;
      if (fallbackActive) return _fallbackEnergyValue;
      return 0;
    }
    const motionEnergyUnified = getUnifiedEnergy();
    tickStableMotionEnergy(motionEnergyUnified, speaking, safeDelta);
    const stableMotionEnergy = getStableMotionEnergy();

    if (_wAny) {
      _wAny.__ENERGY_DEBUG = {
        motionEnergy: motionEnergyUnified,
        stableMotionEnergy,
        ttsEnergy: _wAny.__lastTTSEnergy ?? null,
        fallbackActive,
        fallbackEnergy: _fallbackEnergyValue,
        decay: _fbDecay,
      };
      _wAny.__TTS_FALLBACK_DEBUG = {
        active:  fallbackActive,
        ageMs:   Number.isFinite(_fbAgeMs) ? _fbAgeMs : null,
        decay:   _fbDecay,
        energy:  _fallbackEnergyValue,
        speaking,
      };
    }

    // ── [ENERGY_FLOW] — gated + throttled (≤ ~0.5/s) when NEXT_PUBLIC_DEBUG_MOTION*
    // Captures the exact values that drive motion so we can verify the
    // audioRms01 → tickUnifiedEnergy → getSmoothedUnifiedEnergy chain.
    if (isDebugMotion() && typeof performance !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _efLast = (globalThis as any).__energyFlowLogLastMs ?? 0;
      const _efNow  = performance.now();
      if (_efNow - _efLast > 2000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__energyFlowLogLastMs = _efNow;
        // Accumulate a rolling 4-sample window so we can answer
        // "is unifiedEnergy changing over time?" in one console entry.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _win: number[] = (globalThis as any).__energyFlowWindow ?? [];
        _win.push(+_unifiedNow.toFixed(3));
        if (_win.length > 4) _win.shift();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__energyFlowWindow = _win;
        const _minW  = Math.min(..._win);
        const _maxW  = Math.max(..._win);
        const _changing = (_maxW - _minW) > 0.02;
        console.log('[ENERGY_FLOW]', {
          audioRms01:    +audioRms01.toFixed(3),
          speaking,
          rmsSource:     audioRmsSource,
          unifiedEnergy: +_unifiedNow.toFixed(3),
          window4:       [..._win],
          energyChanging: _changing,
        });
        if (!_changing && speaking) {
          console.warn(
            '[ENERGY_FLOW] ⚠️ unifiedEnergy is CONSTANT while speaking —',
            'check tickUnifiedEnergy inputs or brainSnap.intentEnergy',
          );
        }
      }
    }
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
      // Amplitude is driven solely by `tickBehaviorTimeline` → envelope (no stacking).
      if (ab.pose === 'thinking' && gestureStateRef.current === 'idle' && !thinkGestureActiveRef.current) {
        thinkGestureActiveRef.current = true;
        pushBehaviorEvent('think', nowMs, {
          baseDurationMs: 3000,
          intensity:      0.75,
          priority:       90,
          source:           'auto:thinking-avatarBehavior',
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // BEHAVIOR ENGINE — Stage 4 semantic gesture bridge
      //
      // Utterance / listen context → resolveSemanticGesture →
      // pushBehaviorFromSemanticDecision → BehaviorTimeline queue →
      // tickBehaviorTimeline → legacy gesture refs (no direct bone writes).
      // Cyclic generic gesture spam removed — cooldowns live in the bridge.
      const _autoCanFire =
        !vrmaActiveRef?.current &&
        speaking &&
        gestureStateRef.current === 'idle' &&
        !thinkGestureActiveRef.current &&
        nowMs >= talkGestureNextAtMsRef.current;

      const _autoCanFireListen =
        !vrmaActiveRef?.current &&
        !speaking &&
        listening &&
        gestureStateRef.current === 'idle' &&
        !thinkGestureActiveRef.current &&
        nowMs >= talkGestureNextAtMsRef.current;

      if (_autoCanFireListen) {
        const dListen = resolveSemanticGesture({
          detectedIntent: 'neutral',
          ruleConfidence: 0,
          llmIntent: null,
          utteranceText: '',
          utteranceHash: '',
          speaking: false,
          listening: true,
          nowMs,
          stableMotionEnergy,
        });
        const evListen =
          dListen.gesture === 'listen' && dListen.confidence >= 0.45
            ? pushBehaviorFromSemanticDecision(dListen, nowMs)
            : null;
        if (typeof window !== 'undefined') {
          const curL = getCurrentBehavior();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__SEMANTIC_GESTURE_DEBUG = {
            semanticIntent: 'listening',
            selectedGesture: dListen.gesture,
            confidence: +dListen.confidence.toFixed(3),
            blockedByCooldown: dListen.debugCooldownHit === true,
            speaking,
            stableEnergy: +stableMotionEnergy.toFixed(3),
            activeGestureTimeline: evListen?.type ?? curL?.type ?? 'idle',
            fallbackToIdle: dListen.gesture === 'idle',
          };
        }
        if (evListen) {
          talkGestureActiveRef.current = true;
          talkGestureNextAtMsRef.current = evListen.startTime + evListen.duration + 480 + Math.random() * 140;
        }
      }

      // FORENSIC_CP: semanticBridge — كان يُقيَّد بـ utteranceHash فيُطلق التايملاين مرة واحدة لكل نص ثابت،
      // فيبقى الذراع IDLE طوال الجملة الطويلة رغم [PROCEDURAL EXECUTED] (رأس فقط).
      if (_autoCanFire) {
        const _utterText = getEmbodimentUtteranceTextForSemantics() ?? '';
        if (_utterText.length > 0) {
          const _utterHash = `${_utterText.length}:${_utterText.slice(0, 32)}`;
          const _hashChanged = _utterHash !== lastSemanticUtteranceHashRef.current;
          const _scheduleDue = nowMs >= talkGestureNextAtMsRef.current;
          if (_hashChanged || _scheduleDue) {
            if (_hashChanged) {
              lastSemanticUtteranceHashRef.current = _utterHash;
            }
            const _det = detectIntentDetailed(_utterText);
            const decision = resolveSemanticGesture({
              detectedIntent: _det.intent,
              ruleConfidence: _det.confidence,
              llmIntent: ab.intent,
              utteranceText: _utterText,
              utteranceHash: _utterHash,
              speaking,
              listening: false,
              nowMs,
              stableMotionEnergy,
            });
            const ev =
              decision.gesture !== 'idle' && decision.confidence >= 0.38
                ? pushBehaviorFromSemanticDecision(decision, nowMs)
                : null;
            if (typeof window !== 'undefined') {
              const cur = getCurrentBehavior();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__SEMANTIC_GESTURE_DEBUG = {
                semanticIntent: _det.intent,
                selectedGesture: decision.gesture,
                confidence: +decision.confidence.toFixed(3),
                blockedByCooldown: decision.debugCooldownHit === true,
                speaking,
                stableEnergy: +stableMotionEnergy.toFixed(3),
                activeGestureTimeline: ev?.type ?? cur?.type ?? 'idle',
                fallbackToIdle: decision.gesture === 'idle',
                ruleReason: _det.reason,
                firedOn: _hashChanged ? 'utterance-change' : 'schedule-cooldown',
              };
            }
            if (ev) {
              talkGestureActiveRef.current = true;
              lastSemanticIntentFiredRef.current = _det.intent;
              talkGestureNextAtMsRef.current = ev.startTime + ev.duration + 420 + Math.random() * 180;
              if (typeof window !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__behaviorEngine = {
                  lastFiredGesture: ev.type,
                  lastFiredSource: `semanticBridge:${decision.sourceIntent}`,
                  lastFiredAtMs: nowMs,
                  firedThisUtterance: _det.intent,
                  timelineEventDurationMs: ev.duration,
                  timelinePhases: ev.phases,
                  timelineIntensity: ev.intensity,
                };
              }
              if (process.env.NODE_ENV === 'development') {
                // eslint-disable-next-line no-console
                console.log('[BEHAVIOR_GESTURE_FIRED]', {
                  gesture: ev.type,
                  source: decision.sourceIntent,
                  durationMs: ev.duration,
                  phases: ev.phases,
                  intensity: +ev.intensity.toFixed(2),
                  queueDepth: getBehaviorQueueDepth(),
                  nextAt: Math.round(talkGestureNextAtMsRef.current),
                  trigger: _hashChanged ? 'hash' : 'cooldown',
                });
              }
            }
          }
        }
      } else if (talkGestureActiveRef.current && (gestureStateRef.current === 'idle' || !speaking)) {
        talkGestureActiveRef.current = false;
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
      pushBehaviorEvent('think', nowMs, {
        baseDurationMs: 3000,
        intensity:      0.75,
        priority:       90,
        source:           'auto:thinking-cognitive',
      });
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

    // ─── Behavior Timeline Engine — per-frame tick (single source of truth) ──
    // Drives the active behavior lifecycle (anticipation → action → recovery),
    // advances the queue when an event completes, and SYNCS its output into
    // the legacy gesture refs so the existing rendering pipeline (slerpArmEuler
    // + applyFinalPoseToVrm) continues to work unchanged.
    //
    // Order requirement: must run BEFORE the gesture state machine below so
    // `gestureStateRef.current` reflects the timeline's resolved state for
    // this frame.
    const _behaviorFrame: BehaviorFrame = tickBehaviorTimeline(nowMs);
    // FIX 2 + FIX 3: envelope-only amplitude — no Math.max stacking; when the
    // timeline has no active event the envelope is 0 → no lingering gesture gain.
    // Clamp ≥0 so anticipation-phase negative envelopes never invert downstream gAmp.
    gestureAmplitudeMulRef.current = Math.max(0, _behaviorFrame.envelope);
    if (_behaviorFrame.event) {
      const _ev = _behaviorFrame.event;
      // Sync the timeline event into the legacy refs every frame. The
      // renderer reads these to compute progress / fade-in / fade-out.
      gestureStateRef.current   = _ev.type as GestureId;
      gestureStartRef.current   = _ev.startTime;
      gestureDurationRef.current = _ev.duration;
    } else if (gestureStateRef.current !== 'idle' && !vrmaActiveRef?.current) {
      // Timeline reports idle but the renderer is still in a gesture state
      // (legacy bridge). Let the existing duration-based transition at
      // ~L 2854 finish naturally; do not force-clear here.
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
    // FORENSIC_CP: إن وُجد حدث تايملاين بنسبة ظهور، لا يجوز أن يبقى المصدر IDLE (إصلاح انزلاق السلطة).
    if (
      !vrmaActive &&
      motionSource === 'IDLE' &&
      _behaviorFrame.event !== null &&
      _behaviorFrame.envelope > 0.06 &&
      _behaviorFrame.event.type !== 'idle'
    ) {
      motionSource = 'GESTURE';
    }
    const g = rawG;

    if (motionSource === 'IDLE' && prevMotionSourceRef.current === 'GESTURE') {
      idleArmEaseFromMsRef.current = nowMs;
    }

    const elapsed = nowMs - gestureStartRef.current;
    const dur = Math.max(1, gestureDurationRef.current);
    let progress = Math.min(1, elapsed / dur);
    // FORENSIC_CP: لا تُصفّر الإيماءة بالمدّة إذا كان التايملاين لا يزال يعرض حدثًا (منع desync).
    if (!vrmaActive && g !== 'idle' && progress >= 1 && !_behaviorFrame.event) {
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
      if (!useIdlePose && (key === 'rua' || key === 'lua')) {
        applyUpperArmGestureCalib(SK_Q);
      }
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

      // ── BehaviorTimeline anticipation overlay (wind-up before wave) ──
      // During the anticipation phase the right upper arm is pulled slightly
      // BACKWARD (positive ruaX) and the left arm pulled toward the body
      // before the action phase swings them into the wave pose. This is the
      // "opposite motion first" signature of natural human gesture.
      const _antRua_wave = getAnticipationOverlay(_behaviorFrame, 'rua');
      const _antLua_wave = getAnticipationOverlay(_behaviorFrame, 'lua');

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
        (wRuaX + micro * 1.2) * _wHold + _antRua_wave,
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

      // Left arm (resting at side) — anticipation pulls slightly inward.
      slerpArmEuler(luaRef.current, WAVING_LUA_X + _antLua_wave, WAVING_LUA_Y, WAVING_LUA_Z, 0.4);
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
        ? THREE.MathUtils.clamp(
            intentArm * 0.92 + gBlend * 0.14 + gestureAmplitudeMulRef.current * 0.18,
            rawG !== 'idle' ? 0.44 : 0,
            1,
          )
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

    // ── PART 2 (Bone Authority): VRMA safety override ─────────────────────────
    // When an INTENT is active during VRMA playback, cap VRMA weight on the
    // gesture-critical bones (head, neck, upper/lower arms, shoulders) so the
    // clip cannot silently overwrite the intent gesture.  Lower limbs and
    // torso keep full VRMA — they carry the clip's idle sway / locomotion.
    const _intentIntensity = cognitiveEmb.intent?.intensity ?? 0;
    const _intentActive    = !!cognitiveEmb.intent?.activeIntent && _intentIntensity > 0.2;
    const _vrmaSafety = computeVrmaSafetyOverrides({
      motionSource,
      vrmaLayerW,
      intentIntensity: _intentIntensity,
      intentActive:    _intentActive,
    });
    if (_vrmaSafety) {
      for (const bone of _vrmaSafety.bones) {
        const existingOverride = kinematicBoneWeightOverrides.get(bone) ?? {};
        const existingVrma = existingOverride.vrma;
        // Math.min so we never weaken a stricter generative lock that's
        // already in place (the weakest VRMA wins for the bone).
        const newVrma = existingVrma !== undefined
          ? Math.min(existingVrma, _vrmaSafety.vrmaReduced)
          : _vrmaSafety.vrmaReduced;
        kinematicBoneWeightOverrides.set(bone, {
          ...existingOverride,
          vrma: newVrma,
        });
      }
    }

    // Motion recovery: during procedural semantic gestures, upper body favors gesture
    // blend so idle bind pose cannot visually swallow open-hand / reach poses.
    if (
      !generativeExternalActive &&
      isProceduralGestureFrame &&
      rawG !== 'idle' &&
      motionSource === 'GESTURE' &&
      !VRMA_ISOLATION_TEST
    ) {
      const gStrong = THREE.MathUtils.clamp(gestureLayerW * 1.08, 0.48, 1);
      const iSoft = THREE.MathUtils.clamp(1 - gStrong * 0.5, 0.38, 0.92);
      for (const bone of [
        'lua',
        'rua',
        'lla',
        'rla',
        'leftShoulder',
        'rightShoulder',
        'chest',
      ]) {
        const prev = kinematicBoneWeightOverrides.get(bone) ?? {};
        kinematicBoneWeightOverrides.set(bone, {
          ...prev,
          idle: Math.min(prev.idle ?? 1, iSoft),
          gesture: Math.max(prev.gesture ?? 0, gStrong),
        });
      }
    }

    // Conversational inertia (visual): lag upper arms + shoulders toward authored gesture.
    if (isProceduralGestureFrame && rawG !== 'idle' && !VRMA_ISOLATION_TEST) {
      const _gsm = smoothedGestureArmRef.current;
      const _smoothArmBone = (bone: string, tauSec: number) => {
        const tgt = gesturePose.get(bone);
        if (!tgt) return;
        let sm = _gsm.get(bone);
        if (!sm) {
          sm = tgt.clone();
          _gsm.set(bone, sm);
        } else {
          const a = 1 - Math.exp(-safeDelta / tauSec);
          sm.slerp(tgt, THREE.MathUtils.clamp(a, 0, 1));
        }
        gesturePose.set(bone, sm.clone());
      };
      _smoothArmBone('lua', 0.084);
      _smoothArmBone('rua', 0.084);
      _smoothArmBone('leftShoulder', 0.118);
      _smoothArmBone('rightShoulder', 0.118);
    } else if (!isProceduralGestureFrame) {
      smoothedGestureArmRef.current.clear();
    }

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

    // ── BONE AUTHORITY: PoseComposer trace + pose-loss detection ──────────────
    // Initial authority claim — every key currently in finalPose came directly
    // from blendPoseLayers (idle / generative / gesture / collision / VRMA mix).
    // Subsequent procedural layers (presence, intent, micro, etc.) will diff-register
    // *additional* authority below; conflicting writes surface as [AUTHORITY_CONFLICT].
    for (const key of finalPose.keys()) {
      // Map "currently dominant blend source" → authority for this initial claim.
      // Heuristic: VRMA wins when its weight is non-trivial; otherwise INTENT.
      registerBoneAuthority(key, vrmaLayerW > 0.05 ? BoneAuthority.VRMA : BoneAuthority.INTENT);
    }
    tracePoseComposer({
      finalPose,
      weights: {
        idle:       +idleLayerW.toFixed(3),
        generative: +generativeLayerW.toFixed(3),
        gesture:    +gestureLayerW.toFixed(3),
        collision:  +collisionLayerW.toFixed(3),
        vrma:       +vrmaLayerW.toFixed(3),
      },
    });
    detectPoseLoss(finalPose);

    // ── window.__MOTION_AUTHORITY_FORENSICS (نهاية سلطة الخلط الأولى) ─────────
    if (typeof window !== 'undefined' && _execLoop.frameCount % 16 === 0) {
      const _bLua = m.get('lua');
      const _fLua = finalPose.get('lua');
      let finalArmMagnitude = 0;
      if (_bLua && _fLua) {
        finalArmMagnitude =
          2 *
          Math.acos(THREE.MathUtils.clamp(Math.abs(_fLua.dot(_bLua)), 0, 1));
      }
      const gesturePoseWritten = gesturePose.has('lua') && gesturePose.has('rua');
      const gesturePoseApplied = gesturePoseWritten && gestureLayerW > 0.08;
      const idleOverwriteDetected =
        !!_behaviorFrame.event &&
        idleLayerW > 0.88 &&
        gestureLayerW < 0.18;
      const vrmaOverwriteDetected = vrmaLayerW > 0.25 && motionSource === 'VRMA';
      const wEff = {
        idle: idleLayerW,
        gesture: gestureLayerW,
        vrma: vrmaLayerW,
        generative: generativeLayerW,
      };
      const dominant = Object.entries(wEff).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'bind';
      let overwrittenBy = 'none';
      if (idleOverwriteDetected) overwrittenBy = 'idleBlendHighVsLowGestureWeight';
      else if (vrmaOverwriteDetected) overwrittenBy = 'vrmaLayer';
      const overlay = getMotionTraceOverlayState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__MOTION_AUTHORITY_FORENSICS = {
        currentMotionSource: motionSource,
        gestureEnvelope: +_behaviorFrame.envelope.toFixed(4),
        gestureLayerWeight: +gestureLayerW.toFixed(4),
        idleLayerWeight: +idleLayerW.toFixed(4),
        finalDominantLayer: dominant,
        finalArmMagnitude: +finalArmMagnitude.toFixed(4),
        gesturePoseWritten,
        gesturePoseApplied,
        finalPoseApplied: finalPose.size > 0,
        overwrittenBy,
        idleOverwriteDetected,
        vrmaOverwriteDetected,
        finalBlendWeights: {
          idle: +idleLayerW.toFixed(3),
          gesture: +gestureLayerW.toFixed(3),
          vrma: +vrmaLayerW.toFixed(3),
          generative: +generativeLayerW.toFixed(3),
        },
        motionDiagnosticsState: overlay,
        authorityWinner:
          dominant === 'gesture'
            ? 'blend:gesture'
            : dominant === 'idle'
              ? 'blend:idle'
              : dominant === 'vrma'
                ? 'blend:vrma'
                : 'blend:generative',
        timelineEventType: _behaviorFrame.event?.type ?? null,
        gestureStateRef: gestureStateRef.current,
      };
      if (
        idleOverwriteDetected &&
        nowMs - lastMotionAuthorityHardWarnMsRef.current > 2800
      ) {
        lastMotionAuthorityHardWarnMsRef.current = nowMs;
        // eslint-disable-next-line no-console
        console.warn('[MOTION_AUTHORITY_HARD]', {
          reason: 'Timeline has active gesture but blend weights favor idle',
          timelineType: _behaviorFrame.event?.type,
          envelope: +_behaviorFrame.envelope.toFixed(3),
          gestureLayerW: +gestureLayerW.toFixed(3),
          idleLayerW: +idleLayerW.toFixed(3),
          motionSource,
        });
      }
    }

    // Snapshot tracked keys so layers below can diff-register their authority.
    const _authoritySnap = new Map<string, string>();
    captureSignatureSnapshot(finalPose, TRACKED_POSE_KEYS, _authoritySnap);

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

    // ── ROOT-CAUSE FIX (PART 1) ──────────────────────────────────────────────
    // motionState computation must happen UNCONDITIONALLY — before any
    // `if (!isolateVrmaLayers)` gate.  Previously it lived inside the
    // procedural block and was skipped during VRMA playback, which left
    // `motionState.headNod` / `motionState.openGesture` at zero while
    // speaking.  That zero state is what the behavior-sync layer detected
    // and "fixed" with `[SYNC_FORCE_INJECTION]`.  Eliminating the gate
    // eliminates the artificial injection.
    //
    // The intent classifier, gesture-timing tick, and speech-rhythm baseline
    // all run here.  `applyIntentMotionState` itself still runs inside the
    // procedural block at full weight (existing behaviour), and an additional
    // reduced-weight invocation runs in the VRMA branch below so the speech-
    // driven head/arm motion is visible during clip playback as well.
    const _llmIntent = embFrame.intent.activeIntent ?? '';
    let _activeIntent = _llmIntent;
    if (!_activeIntent) {
      const _utter = getEmbodimentUtteranceTextForSemantics() ?? '';
      const _detected = detectIntent(_utter);
      if (_detected !== 'neutral') _activeIntent = _detected;
    }
    let _timingWeight = tickGestureTiming(_activeIntent);
    // Speech-coupling floor: when speaking, ensure intent motion is never attenuated below
    // `0.3 + energy * 0.4`. Reads previous-frame smoothed energy from the speech-fusion bus
    // (1-frame lag is imperceptible). Pure floor — never lowers.
    if (speaking) {
      const _speechEnergyForTiming = stableMotionEnergy;
      const _speechFloor = 0.28 + _speechEnergyForTiming * 0.34;
      if (_speechFloor > _timingWeight) _timingWeight = _speechFloor;
    }

    // ── [MOTION_INPUT] diagnostic (STEP 1 — throttled 1 s) ───────────────────
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _dg = (globalThis as any);
      const _dgNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!_dg.__motionInputLastMs || _dgNow - _dg.__motionInputLastMs > 1000) {
        _dg.__motionInputLastMs = _dgNow;
        const _inputLog = {
          speaking,
          energy:        +stableMotionEnergy.toFixed(3),
          energyRaw:   +motionEnergyUnified.toFixed(3),
          timingWeight:  +_timingWeight.toFixed(3),
          intent:        _activeIntent || '(none)',
          diagnosis:
            !speaking ? 'NOT_SPEAKING — motion baseline will be zero' :
            stableMotionEnergy < 0.01 ? 'ENERGY_ZERO — viseme feed inactive' :
            _timingWeight < 0.05 ? 'TIMING_SUPPRESSED — intent not driving' :
            'INPUTS_OK',
        };
        // eslint-disable-next-line no-console
        console.log('[MOTION_INPUT]', _inputLog);
        // Expose for window-level inspection (STEP 2 prerequisite)
        _dg.__motionInput = _inputLog;
      }
    }

    // EXEC-AUDIT: motion stage marker (after intent + timing computed)
    _execLoop.s_motionEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _execLoop.s_motionExecuted = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _motionState = ((globalThis as any).__cogniMotionState ??= {
      openGesture: 0, headTilt: 0, headNod: 0,
    });
    _motionState.openGesture =
      _activeIntent === 'explaining' || _activeIntent === 'emphasizing' ? 1 : 0;
    _motionState.headTilt =
      _activeIntent === 'thinking'    ? 0.05 :
      _activeIntent === 'questioning' ? 0.08 : 0;
    _motionState.headNod =
      _activeIntent === 'confirming' || _activeIntent === 'agreeing' ? 0.10 : 0;

    // SPEECH-RHYTHM BASELINE — non-zero motion whenever the avatar speaks,
    // regardless of intent classification or VRMA state.
    if (speaking) {
      const _tSpeech = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.0012;
      if (_motionState.headNod === 0) {
        _motionState.headNod = Math.abs(Math.sin(_tSpeech)) * 0.12;
      }
      if (_motionState.openGesture === 0) {
        _motionState.openGesture = 0.25 + Math.abs(Math.sin(_tSpeech * 0.7)) * 0.25;
      }

      // ── Intent-driven gesture enrichment (additive, energy-coupled) ──
      // Adds intent-specific motion ON TOP of the speech baseline above so
      // each intent has a recognisable signature, even at low energy.
      const _intentEnergy = stableMotionEnergy;
      const _eCap = Math.min(0.88, Math.max(0, _intentEnergy));
      if (_activeIntent === 'explaining') {
        // Head nod tracks **stable** speech energy; gesture bump clamped (no arm spikes).
        _motionState.headNod += _eCap * 0.035;
        _motionState.openGesture += 0.22 * (0.35 + 0.65 * _eCap);
      } else if (_activeIntent === 'emphasizing') {
        const _burst = Math.abs(Math.sin(_tSpeech * 5.5));
        _motionState.headNod += _burst * 0.13 * (0.28 + 0.72 * _eCap);
        _motionState.openGesture += 0.22 * (0.28 + 0.72 * _eCap);
      } else if (_activeIntent === 'questioning') {
        _motionState.headNod += _eCap * 0.018;
      }
    }

    // Behavior Engine — multiplicative bias on motionState (does not replace baseline).
    mergeBehaviorEngineMotionScalars(_motionState, {
      speaking,
      intent: _activeIntent,
      emotion: behaviorPayload?.emotion ?? 'neutral',
      intensity: embFrame.intent.intensity ?? 0,
    });

    // ── Optional forced-motion override (debug-only) — perceptually smooth blend ──
    // Position: AFTER mergeBehaviorEngineMotionScalars, BEFORE _VIS_AMP.
    // Zero-cost when alpha = 0 (branch exits immediately, motionState untouched).
    // No motion detector / guard is affected (all run inside the merge above).
    //
    // Enhancement summary vs prior version:
    //   1. Delta-based lerp  → real + alpha*(forced−real), identical math, explicit
    //      delta variable enables clamping in step 3.
    //   2. Frozen forced-state snapshot → on fade-out we blend from the snapshot
    //      captured while alpha≈1, not from forced(t), so the source value is
    //      frozen and cannot oscillate as the sinusoid ticks during fade-out.
    //   3. Per-channel delta clamp → prevents single-frame spike when forced and
    //      real motion diverge sharply (threshold 0.18 per channel).
    //   4. Asymmetric τ: rise 100 ms / fall 280 ms for a smoother perceptual exit.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _w = (typeof window !== 'undefined' ? (window as any) : undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _g = (globalThis as any);

      // Persistent blend state (initialised once, lives on globalThis).
      const _blend = (_g.__forceBlendState ??= {
        active:      false,
        alpha:       0,
        target:      0,
        lastUpdate:  performance.now(),
        // Enhancement 2: snapshot of forced values captured while alpha ≥ 0.97
        snapHN:      0,
        snapHT:      0,
        snapOG:      0,
        snapValid:   false,
      });

      const _nowFB = performance.now();
      const _dtFB  = Math.max(0, Math.min(100, _nowFB - _blend.lastUpdate));
      _blend.lastUpdate = _nowFB;

      const _forceEnabled = !!(_w && _w.__forceMotionState);
      _blend.target = _forceEnabled ? 1 : 0;
      _blend.active = _forceEnabled || _blend.alpha > 1e-4;

      // Enhancement 4: asymmetric time constants.
      const _TAU_RISE_MS = 100;
      const _TAU_FALL_MS = 280;
      const _tau = (_blend.target > _blend.alpha) ? _TAU_RISE_MS : _TAU_FALL_MS;
      const _k   = 1 - Math.exp(-_dtFB / _tau);
      _blend.alpha += (_blend.target - _blend.alpha) * _k;
      if (_blend.target === 0 && _blend.alpha < 1e-4)       _blend.alpha = 0;
      else if (_blend.target === 1 && _blend.alpha > 1 - 1e-4) _blend.alpha = 1;

      if (_blend.alpha > 0) {
        const _ft6 = _nowFB * 0.002;
        const _liveHN = Math.sin(_ft6) * 0.3;
        const _liveHT = Math.cos(_ft6) * 0.2;
        const _liveOG = 1.0;

        // Enhancement 2: capture snapshot when fully forced; reuse it on fade-out
        // so the source value is frozen (no sinusoidal ticking during the decay).
        if (_blend.alpha >= 0.97) {
          _blend.snapHN    = _liveHN;
          _blend.snapHT    = _liveHT;
          _blend.snapOG    = _liveOG;
          _blend.snapValid = true;
        }
        const _srcHN = _blend.snapValid ? _blend.snapHN : _liveHN;
        const _srcHT = _blend.snapValid ? _blend.snapHT : _liveHT;
        const _srcOG = _blend.snapValid ? _blend.snapOG : _liveOG;

        // Enhancement 3: delta clamp — prevents spike when channels diverge sharply.
        const _DELTA_CLAMP = 0.18;
        const _clamp = (v: number) => Math.max(-_DELTA_CLAMP, Math.min(_DELTA_CLAMP, v));

        const _a = _blend.alpha;

        // Enhancement 1: explicit delta blend (real + alpha * clamp(forced − real)).
        _motionState.headNod     += _clamp(_srcHN - _motionState.headNod)     * _a;
        _motionState.headTilt    += _clamp(_srcHT - _motionState.headTilt)    * _a;
        _motionState.openGesture += _clamp(_srcOG - _motionState.openGesture) * _a;
      } else {
        // alpha reached exactly 0 — clear snapshot so next activation starts fresh.
        _blend.snapValid = false;
      }

      if (_w) {
        _w.__forceBlendState = {
          alpha:      +_blend.alpha.toFixed(4),
          target:     _blend.target,
          active:     _blend.active,
          snapValid:  _blend.snapValid,
        };
      }

      const _prevTarget = _g.__forceBlendPrevTarget;
      if (_prevTarget !== _blend.target) {
        _g.__forceBlendPrevTarget = _blend.target;
        console.log('[FORCE_BLEND]', {
          alpha:  +_blend.alpha.toFixed(3),
          target: _blend.target,
          edge:   _blend.target === 1 ? 'rising' : 'falling',
        });
      } else if (_blend.target === 0 && _blend.alpha === 0 && _g.__forceBlendDoneZero !== true) {
        _g.__forceBlendDoneZero = true;
        _g.__forceBlendDoneOne  = false;
        console.log('[FORCE_BLEND]', { alpha: 0, target: 0, edge: 'fade-out-complete' });
      } else if (_blend.target === 1 && _blend.alpha === 1 && _g.__forceBlendDoneOne !== true) {
        _g.__forceBlendDoneOne  = true;
        _g.__forceBlendDoneZero = false;
        console.log('[FORCE_BLEND]', { alpha: 1, target: 1, edge: 'fade-in-complete' });
      }
    }

    // ── Speech + Emotion + Motion fusion (additive only, never overwrites) ──
    // Position: AFTER mergeBehaviorEngineMotionScalars + force-blend, BEFORE _VIS_AMP.
    // Reads the latest viseme magnitude pushed by LipSyncManager and adds small,
    // smoothed deltas to head/gesture channels. Cannot zero motion → all guards
    // upstream remain valid. `jawOpen` is created on `_motionState` here for
    // future downstream consumers (no current reader; safe additive field).
    applySpeechFusion(
      _motionState as { headNod: number; headTilt: number; openGesture: number; jawOpen?: number },
      {
        speaking,
        emotion: behaviorPayload?.emotion ?? 'neutral',
        intensity: embFrame.intent.intensity ?? 0,
        now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      },
    );

    // ── Personality modulation (additive form of multiplication, never zeros) ──
    // Position: AFTER speech fusion, BEFORE _VIS_AMP. Amplifies / dampens the
    // already-finalised channels per active profile (teacher / friend / coach /
    // neutral). Toggle at runtime via `window.__personalityProfile`.
    applyPersonalityMotion(_motionState, {
      speaking,
      energy: stableMotionEnergy,
      timeSec: t,
      intent: _activeIntent,
    });

    // ── Motion dynamics: Rhythm · Anticipation · Inertia ──────────────────
    // Position: AFTER personality, BEFORE _VIS_AMP.
    // Adds:
    //   • RHYTHM      — speech-coupled micro-oscillation (adaptive Hz).
    //   • ANTICIPATION — leading-edge overshoot on intent change / speech start.
    //   • INERTIA      — momentum carry-through so motion eases out naturally.
    // All deltas additive; frame-rate-independent via safeDelta.
    applyMotionDynamics(_motionState, {
      speaking,
      energy:   stableMotionEnergy,
      intent:   _activeIntent,
      timeSec:  t,
      deltaSec: safeDelta,
    });

    // ── Direction-aware modulation (forward vs target / camera) ─────────────
    // AFTER motion dynamics, BEFORE _VIS_AMP. Boost when facing listener;
    // damp nod/gesture when avatar faces clearly away. Read-only on transforms.
    // Uses liftNode (vrm.scene.parent) — same root as forward correction — so
    // the yaw correction applied once at load is picked up here automatically.
    applyDirectionalMotionModulation(_motionState, {
      avatarRoot: vrm?.scene?.parent ?? vrm?.scene ?? null,
      targetWorld: camera.position,
      energy: stableMotionEnergy,
    });

    // Stage 3 — extra output smoothing on head (nod/tilt) before visibility amp;
    // openGesture slightly faster so arms stay conversational without vibration.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _g = globalThis as any;
      _g.__procHeadNodSmoothed ??= 0;
      _g.__procHeadTiltSmoothed ??= 0;
      _g.__procOpenGestSmoothed ??= 0;
      const aH = speaking ? 0.17 : 0.11;
      const aG = speaking ? 0.24 : 0.14;
      _g.__procHeadNodSmoothed = THREE.MathUtils.lerp(_g.__procHeadNodSmoothed, _motionState.headNod, aH);
      _g.__procHeadTiltSmoothed = THREE.MathUtils.lerp(_g.__procHeadTiltSmoothed, _motionState.headTilt, aH * 0.92);
      _g.__procOpenGestSmoothed = THREE.MathUtils.lerp(_g.__procOpenGestSmoothed, _motionState.openGesture, aG);
      if (!speaking) {
        _g.__procHeadNodSmoothed *= 0.9;
        _g.__procHeadTiltSmoothed *= 0.9;
        _g.__procOpenGestSmoothed *= 0.88;
      }
      _motionState.headNod = _g.__procHeadNodSmoothed;
      _motionState.headTilt = _g.__procHeadTiltSmoothed;
      _motionState.openGesture = _g.__procOpenGestSmoothed;
    }

    // Visibility amplification (tight clamps prevent cinematic distortion).
    // Reduced from 3.0 → 1.3 after +Z-Forward alignment to stop arm over-extension
    // (V-Pose / arms-flying-up). Final downstream clamps still bound each channel.
    const _VIS_AMP = 1.3;
    const _ampedMotionState = {
      headNod:     Math.max(-0.3, Math.min(0.3,  _motionState.headNod     * _VIS_AMP)),
      headTilt:    Math.max(-0.3, Math.min(0.3,  _motionState.headTilt    * _VIS_AMP)),
      openGesture: Math.max(0,    Math.min(0.8,  _motionState.openGesture * _VIS_AMP)),
    };

    // ── [MOTION_TRACE] / [FINAL_MOTION_CHECK] — full-frame motion observability ──
    // Throttled console output covering every stage required by the audit spec:
    //   energy → intent → timingWeight → motionState → envelope → finalOutput.
    // Stage-isolating logs ([BEHAVIOR_KILLED_MOTION] etc.) live inside the merge
    // function; this block is the consolidated post-merge checkpoint.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _g = (globalThis as any);
      const _now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const _MOTION_TRACE_MS = 750;
      if (!_g.__lastMotionTraceLogAt) _g.__lastMotionTraceLogAt = -Infinity;
      if (_now - _g.__lastMotionTraceLogAt > _MOTION_TRACE_MS) {
        _g.__lastMotionTraceLogAt = _now;
        const _energy = stableMotionEnergy;
        const _envelope = speaking ? Math.max(_energy, 0.2) : _energy;
        const _suppressed =
          speaking &&
          Math.abs(_ampedMotionState.headNod) < 0.001 &&
          _ampedMotionState.openGesture < 0.001;
        // eslint-disable-next-line no-console
        console.log('[MOTION_TRACE]', {
          energy:        +_energy.toFixed(3),
          intent:        _activeIntent || '(none)',
          speaking,
          timingWeight:  +_timingWeight.toFixed(3),
          envelope:      +_envelope.toFixed(3),
          proceduralOnly: isProceduralOnlyMotion(),
          motionState: {
            headNod:     +_motionState.headNod.toFixed(3),
            headTilt:    +_motionState.headTilt.toFixed(3),
            openGesture: +_motionState.openGesture.toFixed(3),
          },
          finalOutput: {
            headNod:     +_ampedMotionState.headNod.toFixed(3),
            headTilt:    +_ampedMotionState.headTilt.toFixed(3),
            openGesture: +_ampedMotionState.openGesture.toFixed(3),
          },
          suppressed: _suppressed,
        });
        // eslint-disable-next-line no-console
        console.log('[FINAL_MOTION_CHECK]', {
          energy:      +_energy.toFixed(3),
          headNod:     +_ampedMotionState.headNod.toFixed(3),
          openGesture: +_ampedMotionState.openGesture.toFixed(3),
          ok:          !_suppressed,
        });
      }
    }
    // Expose timing weight to presence/idle layers (priority attenuation).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__intentAttenuation = _timingWeight;
    // ── END root-cause hoist ─────────────────────────────────────────────────

    runWithProceduralSuppression(proceduralSuppressionKeys, () => {
      if (!isolateVrmaLayers) {
        safeCall('presenceLayer', () => applyPresenceFromEmbodiment(finalPose, embFrame, {
          motionSource,
          elapsedSec: t,
          delta: safeDelta,
          gestureLayerW,
          isTalking: speaking,
        }), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

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
        diffAndRegisterAuthority(BoneAuthority.INTENT, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

        safeCall('motionDriver', () => applyMotionDriver(finalPose, embFrame, safeDelta, {
          motionSource,
          gestureLayerW,
        }), undefined);
        diffAndRegisterAuthority(BoneAuthority.INTENT, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
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
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('attentionSeeking', () => applyAttentionSeekingLayer(finalPose, t, getPerceptionAttentionSeekingStrength()), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

        // ── New motion layers (biomechanical + finger + gaze + timing) ────────
        // motionState / _activeIntent / _timingWeight / _ampedMotionState are
        // computed unconditionally above (PART 1 root-cause hoist).  Here we
        // only consume them.

        // ── [PHASE_2] + [MOTION_STATE] log — motion debug only, ≤ ~0.5/s ───────
        if (isDebugMotion() && typeof performance !== 'undefined') {
          const _msNow = performance.now();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _msLast = (globalThis as any).__motionStateLogLastMs ?? 0;
          if (_msNow - _msLast > 2000) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__motionStateLogLastMs = _msNow;
            const _allZero =
              _motionState.headNod === 0 &&
              _motionState.headTilt === 0 &&
              _motionState.openGesture === 0;
            console.log('[MOTION_STATE]', {
              openGesture:  +_motionState.openGesture.toFixed(4),
              headTilt:     +_motionState.headTilt.toFixed(4),
              headNod:      +_motionState.headNod.toFixed(4),
              timingWeight: +_timingWeight.toFixed(3),
              activeIntent: _activeIntent || '(none)',
              speaking,
            });
            console.log('[PHASE_2]', {
              motionGenerated: !_allZero,
              headNod:        +_motionState.headNod.toFixed(4),
              headTilt:       +_motionState.headTilt.toFixed(4),
              openGesture:    +_motionState.openGesture.toFixed(4),
              intent:         _activeIntent || '(none)',
              speaking,
              note: _allZero ? 'ALL_ZERO — check intent classifier' : 'OK',
            });
            if (_allZero && !speaking) {
              console.warn('[PHASE_2] ⚠️ motionState is all-zero (not speaking — normal)');
            }
          }
        }

        // ── [VISIBLE_MOTION] + [LAYER_BALANCE] — motion debug only, ≤ ~0.5/s ──
        if (isDebugMotion() && typeof performance !== 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _vmLast = (globalThis as any).__visMotionLogLastMs ?? 0;
          const _vmNow  = performance.now();
          if (_vmNow - _vmLast > 2000) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__visMotionLogLastMs = _vmNow;
            console.log('[VISIBLE_MOTION]', {
              headNod:     +_ampedMotionState.headNod.toFixed(4),
              headTilt:    +_ampedMotionState.headTilt.toFixed(4),
              openGesture: +_ampedMotionState.openGesture.toFixed(4),
              amp:         _VIS_AMP,
              speaking,
            });
            // [LAYER_BALANCE] — shows how layers interplay this frame
            const _intentW = Math.min(1, Math.max(0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (globalThis as any).__intentAttenuation ?? 0
            ));
            const _presenceMul = 1 - _intentW * 0.7;    // matches presenceLayer
            const _idleMul     = 1 - _intentW * 0.8;    // matches idleMicroPresence
            console.log('[LAYER_BALANCE]', {
              intentW:    +_intentW.toFixed(3),
              presenceMul: +_presenceMul.toFixed(3),
              idleMul:     +_idleMul.toFixed(3),
              intentDominant: _intentW > 0.5,
              headNodClamped:    +_ampedMotionState.headNod.toFixed(4),
              openGestureClamped: +_ampedMotionState.openGesture.toFixed(4),
            });
          }
        }

        // ── Capture bone rotations BEFORE intent apply ────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _shouldTrace = (() => {
          if (!isDebugMotion()) return false;
          const _nowT = typeof performance !== 'undefined' ? performance.now() : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const _lastT = (globalThis as any).__frameTraceLastMs ?? 0;
          if (_nowT - _lastT < 2000) return false;
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
        const _applied = safeCall('intentMotion', () => applyIntentMotionState(finalPose, _ampedMotionState, _timingWeight, _activeIntent), { applied: false, headNod: 0, headTilt: 0, armOpen: 0 });
        diffAndRegisterAuthority(BoneAuthority.INTENT, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

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

        // (priority attenuation global is now set unconditionally above —
        // see PART 1 root-cause hoist near runWithProceduralSuppression).
        safeCall('biomechanical', () => applyBiomechanicalCorrections(
          finalPose,
          t,
          humSnap!.breathAmpMul,
          speaking,
        ), undefined);
        diffAndRegisterAuthority(BoneAuthority.INTENT, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('finger',       () => applyFingerMicroLayer(finalPose, t, speaking), undefined);
        // finger writes only finger bones — not in TRACKED_POSE_KEYS, no diff needed.
        safeCall('gaze',         () => applyGazeIntentLayer(finalPose, _activeIntent, safeDelta, vrm), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('neural',       () => applyNeuralLayer(finalPose, t, !!speaking, _timingWeight), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('subconscious', () => applySubconsciousLayer(finalPose, t, _timingWeight, !!speaking), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

        // humanMicro is placed AFTER the inner block — always runs (moved below)

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
      } else {
        // ── PART 1 root-cause: apply intent motion under VRMA isolation ─────
        // The procedural block above is skipped when a VRMA clip is playing,
        // which left motionState orphaned and forced the behavior-sync layer
        // to inject motion every frame.  Now we apply `applyIntentMotionState`
        // with REDUCED weight (× 0.5) so the speech-rhythm baseline + intent
        // contributions reach the head / arms even during clip playback.
        // VRMA stays dominant on the body; the clip's lower-limb / spine
        // motion is preserved.  This eliminates SYNC_FORCE_INJECTION at root.
        safeCall(
          'intentMotion-vrma',
          () => applyIntentMotionState(finalPose, _ampedMotionState, _timingWeight * 0.5, _activeIntent),
          { applied: false, headNod: 0, headTilt: 0, armOpen: 0 },
        );
        diffAndRegisterAuthority(BoneAuthority.INTENT, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
      }

      // ── HUMAN MICRO-BEHAVIOR: blink + breathing + saccades ──────────────────
      // Runs ALWAYS — regardless of motionSource (VRMA, GESTURE, IDLE).
      // Blink and breathing are biological constants, not animation-state-dependent.
      safeCall('humanMicro', () => applyHumanMicroBehavior(
        finalPose,
        t,
        safeDelta,
        !!speaking,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__cogniMotionState?.activeIntent ?? '',
        {
          expressionManager: vrm.expressionManager
            ? { setValue: (n: string, v: number) => vrm.expressionManager?.setValue(n as never, v) }
            : undefined,
        },
      ), undefined);
      diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);

      if (!isolateVrmaLayers) {
        safeCall('cinematic', () => applyCinematicMicroLayer(finalPose, safeDelta, t, {
          speaking,
          energy: Math.max(0.15, speechDriveSnap.energy),
          syllablePulse: speechDriveSnap.syllablePulse,
        }), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('microHuman', () => applyMicroHumanBehavior(finalPose, embFrame, safeDelta, t, speaking), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
        safeCall('idleMicro', () => applyIdleMicroPresence(finalPose, embFrame, safeDelta, {
          motionSource,
          gestureLayerW,
        }), undefined);
        diffAndRegisterAuthority(BoneAuthority.MICRO, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
      }
    });

    // ── BONE AUTHORITY: input trace + per-frame intent claim summary ──────────
    // Emit once we know the active intent + speaking state.  Throttled internally.
    traceAuthorityInput({
      gestures:      embFrame.intent.activeIntent ? [embFrame.intent.activeIntent] : [],
      motorCommands: { motorMul, gestureLayerW: +gestureLayerW.toFixed(3), vrmaLayerW: +vrmaLayerW.toFixed(3) },
      performance:   { motionSource, idle: +idleLayerW.toFixed(3) },
      emotion:       behaviorPayload?.emotion ?? 'neutral',
      intent:        embFrame.intent.activeIntent ?? '',
      speaking,
    });

    // ── BEHAVIOR SYNC: aggregate speech/emotion/intent + apply additive deltas
    // (BEFORE applyFinalPoseToVrm).  Modifiers are small (≤ 0.05 rad) and
    // multiplied onto existing pose quaternions — never replace.  The sync
    // checks (DESYNC + SYNC_FAILURE) run here while we still have ground
    // truth on speaking + intent.
    {
      const _bsNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const _bs = getBehaviorState({
        nowMs:           _bsNowMs,
        speechActive:    speaking,
        speechEnergy:    embFrame.speech.energy,
        emotionRaw:      behaviorPayload?.emotion ?? 'neutral',
        intentIntensity: embFrame.intent.intensity ?? 0,
        gestureActive:   gestureLayerW > 0.1,
      });
      safeCall('behaviorSync', () => applyBehaviorSyncModifiers(finalPose, _bs), undefined);
      // PART 1 (Hard Sync Guarantee): force-inject minimum motion when
      // speaking + critical bones frozen.  Additive — never overrides.
      safeCall('hardSyncGuarantee', () => enforceHardSyncGuarantee(finalPose, _bs), undefined);
      // PART 3+4: emotion + intent validators (observability only).
      safeCall('emotionValidate', () => validateEmotionEffect(finalPose, _bs), undefined);
      safeCall('intentValidate',  () => validateIntentEffect(_bs),             undefined);
      // PART 2: timing alignment check + auto-correction.
      checkSyncAlignment(_bsNowMs);
      // PART 6: critical failure log.  validateAvatarPipeline emits
      // [CRITICAL_PIPELINE_FAILURE] when a hard failure is present.
      validateAvatarPipeline();
      checkFreezeVsSpeech(_bs);
    }

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
      diffAndRegisterAuthority(BoneAuthority.VRMA, finalPose, TRACKED_POSE_KEYS, _authoritySnap);
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

    // ── applyFinalPoseToVrm MOVED to AFTER vrm.update() ──────────────────────
    // ROOT CAUSE FIX: vrm.update() calls lookAt.update() which re-writes the
    // head/neck normalized bones AFTER our applyFinalPoseToVrm call, erasing
    // our motion.  By applying AFTER vrm.update() + calling humanoid.update()
    // again, our normalized values are the LAST write before rendering.
    // (See post-vrm block below.)
    sniper('finalPose', () => {
      if (finalPose.size === 0) throw new Error('finalPose is empty');
      if (!vrm.humanoid)       throw new Error('vrm.humanoid is null');
    });

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
    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER PIPELINE BREAKPOINT DIAGNOSTICS (throttled ~1/s)
    // Tags: [BEFORE_VRM] [AFTER_VRM] [PIPELINE_BREAK]
    // ═══════════════════════════════════════════════════════════════════════════
    const _diagNow  = typeof performance !== 'undefined' ? performance.now() : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _diagLast = (globalThis as any).__diagSnapshotLastMs ?? 0;
    // BEFORE_VRM / AFTER_VRM / PIPELINE_BREAK / PHASE_4 are debug-only now.
    // The vrm.update() override they used to surface has been resolved (we apply
    // finalPose AFTER vrm.update()), so these logs are pure noise outside debugging.
    const _doDiagSnap = AVATAR_DEBUG && (_diagNow - _diagLast > 1000);

    // ── Bone-read helpers ────────────────────────────────────────────────────
    const _readRot = (node: THREE.Object3D | null) => {
      if (!node) return null;
      return {
        rx: +node.rotation.x.toFixed(4),
        ry: +node.rotation.y.toFixed(4),
        rz: +node.rotation.z.toFixed(4),
      };
    };

    if (_doDiagSnap) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__diagSnapshotLastMs = _diagNow;

      // ── TASK 5: humanoid ref check — does vrm.humanoid give same node as cache? ──
      const _vrmLua = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm' as never) ?? null;
      const _vrmHead = vrm.humanoid?.getNormalizedBoneNode('head' as never) ?? null;
      const _refMatchLua  = _vrmLua  === luaRef.current;
      const _refMatchHead = _vrmHead === headRef.current;
      if (!_refMatchLua || !_refMatchHead) {
        console.warn('[PIPELINE_BREAK:BONE_REF_MISMATCH]', {
          luaCacheNull:    !luaRef.current,
          luaVrmNull:      !_vrmLua,
          luaMatch:        _refMatchLua,
          headCacheNull:   !headRef.current,
          headVrmNull:     !_vrmHead,
          headMatch:       _refMatchHead,
          verdict: 'ROOT_CAUSE_B: cached refs diverge from vrm.humanoid nodes',
        });
      }

      // ── TASK 1: [BEFORE_VRM] snapshot ────────────────────────────────────
      const _before = {
        head: _readRot(headRef.current),
        lua:  _readRot(luaRef.current),
        rua:  _readRot(ruaRef.current),
      };
      console.log('[BEFORE_VRM]', {
        head: _before.head?.rx ?? 'NULL',
        lua:  _before.lua?.rz  ?? 'NULL',
        refsNull: { head: !headRef.current, lua: !luaRef.current },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__diagPreSnap = _before;
    }

    // ── BONE AUTHORITY: snapshot live bones BEFORE the apply chain ────────────
    // (vrm.update + applyFinalPoseToVrm).  Used by traceBeforeApply and by
    // detectVrmOverride to attribute drift to the right stage.
    const _liveBefore = readLiveBoneSnapshot(vrm.humanoid, TRACKED_HUMANOID_NAMES);
    traceBeforeApply({ finalPose, liveBones: _liveBefore });

    if (!VRM_HARD_ISOLATION) {
      vrm.update(safeDelta);
    }

    // ── BONE AUTHORITY: snapshot bones immediately AFTER vrm.update ───────────
    const _liveAfterVrmUpdate = readLiveBoneSnapshot(vrm.humanoid, TRACKED_HUMANOID_NAMES);
    traceAfterVrmUpdate(_liveAfterVrmUpdate);

    if (_doDiagSnap) {
      // ── TASK 2: [AFTER_VRM] snapshot ─────────────────────────────────────
      const _after = {
        head: _readRot(headRef.current),
        lua:  _readRot(luaRef.current),
        rua:  _readRot(ruaRef.current),
      };
      console.log('[AFTER_VRM]', {
        head: _after.head?.rx ?? 'NULL',
        lua:  _after.lua?.rz  ?? 'NULL',
      });

      // ── TASK 3 & 6: [PIPELINE_BREAK] verdict ─────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _pre = (globalThis as any).__diagPreSnap as typeof _after | undefined;
      const _headBefore = _pre?.head?.rx ?? null;
      const _headAfter  = _after.head?.rx ?? null;
      const _luaBefore  = _pre?.lua?.rz  ?? null;
      const _luaAfter   = _after.lua?.rz  ?? null;

      const _headChanged = _headBefore !== null && _headAfter !== null
        && Math.abs(_headAfter - _headBefore) > 0.005;
      const _luaChanged  = _luaBefore !== null && _luaAfter !== null
        && Math.abs(_luaAfter  - _luaBefore)  > 0.005;

      // Determine root cause
      let _rootCause = 'UNKNOWN';
      if (!headRef.current && !luaRef.current) {
        _rootCause = 'B: Wrong bone reference (all refs null)';
      } else if (_headChanged || _luaChanged) {
        _rootCause = 'A: VRM is overriding motion (vrm.update() mutated bones)';
      } else if (!_headChanged && !_luaChanged && _headBefore === 0 && _luaBefore === 0) {
        _rootCause = 'C: Motion never reached bones (finalPose → bone write broken)';
      } else {
        _rootCause = 'D: vrm.update() stable but bones show no motion — check applyFinalPoseToVrm';
      }

      console.log('[PIPELINE_BREAK]', {
        beforeVrmHead:    _headBefore,
        afterVrmHead:     _headAfter,
        beforeVrmLua:     _luaBefore,
        afterVrmLua:      _luaAfter,
        headChangedByVrm: _headChanged,
        luaChangedByVrm:  _luaChanged,
        refsNull:         { head: !headRef.current, lua: !luaRef.current },
        ROOT_CAUSE:       _rootCause,
      });

      if (_headChanged || _luaChanged) {
        console.error(
          '[PIPELINE_BREAK] CONFIRMED: vrm.update() is overriding bone rotations.',
          'FIX: move applyFinalPoseToVrm to run AFTER vrm.update(), or disable vrm.lookAt.',
        );
      }

      // ── [PHASE_4] clean verdict ─────────────────────────────────────────────
      console.log('[PHASE_4]', {
        vrmOverride:    _headChanged || _luaChanged,
        beforeHead_rx:  _headBefore,
        afterHead_rx:   _headAfter,
        headDelta:      _headBefore !== null && _headAfter !== null
          ? +(_headAfter - _headBefore).toFixed(5)
          : null,
        verdict: (_headChanged || _luaChanged)
          ? 'VRM_OVERRIDE_DETECTED — vrm.update()/lookAt resets head each frame'
          : 'NO_OVERRIDE — head rotation stable across vrm.update()',
        fix_applied: 'applyFinalPoseToVrm runs AFTER vrm.update() (see FINAL VRM MOTION FIX block)',
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FINAL VRM MOTION FIX — apply AFTER vrm.update() so lookAt cannot override
    // ═══════════════════════════════════════════════════════════════════════════

    // TASKS 1 & 2 (FIX): applyFinalPoseToVrm runs AFTER vrm.update().
    // boneRefs is intentionally empty so every bone resolves fresh from
    // vrm.humanoid.getNormalizedBoneNode() — no stale cached refs.

    // ── [PHASE_3] [FINAL_POSE_BEFORE] snapshot (throttled 250ms) ─────────────
    const _fp3Now  = typeof performance !== 'undefined' ? performance.now() : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _fp3Last = (globalThis as any).__fp3LogLastMs ?? 0;
    // FINAL_POSE_BEFORE/AFTER and PHASE_3 are diagnostic-only; gated behind
    // AVATAR_DEBUG so production runtime is silent.  Throttle stays at 250ms
    // when active so authors get a useful sample rate, not per-frame spam.
    const _doFp3 = AVATAR_DEBUG && (_fp3Now - _fp3Last > 250);
    const _fp3ReadQ = (key: string): { x: number; y: number; z: number; w: number } | null => {
      const q = finalPose.get(key);
      if (!q) return null;
      return { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
    };
    if (_doFp3) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__fp3LogLastMs = _fp3Now;
      const _before = { head: _fp3ReadQ('head'), neck: _fp3ReadQ('neck'), lua: _fp3ReadQ('lua'), rua: _fp3ReadQ('rua') };
      console.log('[FINAL_POSE_BEFORE]', _before);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__fp3Before = _before;
    }

    // ── [POSE_STAGE_1] snapshot: what motionState delivers to the pipeline ──────
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _dg = (globalThis as any);
      const _dgNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!_dg.__poseStageLastMs || _dgNow - _dg.__poseStageLastMs > 1000) {
        _dg.__poseStageLastMs = _dgNow;
        const _luaQ = finalPose.get('lua') ?? finalPose.get('leftUpperArm');
        const _ruaQ = finalPose.get('rua') ?? finalPose.get('rightUpperArm');
        const _headQ = finalPose.get('head');
        const _qFmt = (q: THREE.Quaternion | undefined) =>
          q ? { x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3), w: +q.w.toFixed(3) } : null;
        const _stage1 = {
          motionState: {
            headNod:     +(_motionState.headNod ?? 0).toFixed(3),
            openGesture: +(_motionState.openGesture ?? 0).toFixed(3),
          },
          finalPoseHasArms: !!(finalPose.get('lua') || finalPose.get('leftUpperArm')),
          finalPoseSize:    finalPose.size,
          luaQuat:  _qFmt(_luaQ ?? undefined),
          ruaQuat:  _qFmt(_ruaQ ?? undefined),
          headQuat: _qFmt(_headQ ?? undefined),
        };
        // eslint-disable-next-line no-console
        console.log('[POSE_STAGE_1]', _stage1);
        _dg.__poseStage1 = _stage1;
      }
    }

    safeCall('finalPoseToVrm', () => applyFinalPoseToVrm({
      finalPose,
      humanoid: vrm.humanoid ?? null,
      kinematicSnapKeys,
      smoothLambda: 4,             // Task 2: was 8 — faster convergence, crisper response
      maxRotationPerFrameRad: 0.5, // Task 3: was 0.35 — bigger per-frame step
      boneRefs: {},          // ← always resolves live from vrm.humanoid
      delta: safeDelta,
    }), undefined);
    if (typeof globalThis !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__execTracePoseApplied = true;
    }

    // EXEC-AUDIT: applyFinalPose stage marker
    _execLoop.s_finalPoseEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _execLoop.s_finalPoseExecuted = true;

    // ── [POSE_STAGE_FINAL] + [FINAL_DIAGNOSIS] (throttled 1 s) ──────────────
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _dg = (globalThis as any);
      const _dgNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (!_dg.__poseFinalLastMs || _dgNow - _dg.__poseFinalLastMs > 1000) {
        _dg.__poseFinalLastMs = _dgNow;

        const _luaLive  = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm'  as never);
        const _ruaLive  = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm' as never);
        const _headLive = vrm.humanoid?.getNormalizedBoneNode('head'          as never);
        const _llaLive  = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm'  as never);

        const _bFmt = (b: THREE.Object3D | null | undefined) =>
          b ? { x: +b.rotation.x.toFixed(3), y: +b.rotation.y.toFixed(3), z: +b.rotation.z.toFixed(3) } : null;

        const _luaRot  = _bFmt(_luaLive);
        const _ruaRot  = _bFmt(_ruaLive);
        const _headRot = _bFmt(_headLive);
        const _llaRot  = _bFmt(_llaLive);

        const _armNonZero = !!(_luaRot && (Math.abs(_luaRot.x) + Math.abs(_luaRot.y) + Math.abs(_luaRot.z)) > 0.05);
        const _motionActive = speaking && stableMotionEnergy > 0.01;
        const _inputOk = _motionActive && _timingWeight > 0.05;
        const _poseReached = _armNonZero;

        // Swing-twist NaN guard (STEP 6)
        const _swingNaN =
          _luaLive && (isNaN(_luaLive.quaternion.x) || isNaN(_luaLive.quaternion.w));

        let _rootCause = 'UNKNOWN';
        if (_swingNaN)                             _rootCause = 'NaN_IN_QUATERNION — swing-twist produced invalid result';
        else if (!_motionActive)                   _rootCause = 'MOTION_INACTIVE — not speaking OR energy=0';
        else if (!_inputOk)                        _rootCause = 'TIMING_SUPPRESSED — timingWeight near 0';
        else if (!finalPose.get('lua') && !finalPose.get('leftUpperArm'))
                                                   _rootCause = 'ARM_MISSING_FROM_POSE — finalPose has no arm key';
        else if (!_poseReached)                    _rootCause = 'POSE_NOT_REACHING_BONES — applyFinalPoseToVrm not writing arm bones';
        else                                       _rootCause = 'NONE — motion pipeline appears healthy';

        const _diagnosis = {
          motionActive:     _motionActive,
          speakingFlag:     speaking,
          energyLevel:      +stableMotionEnergy.toFixed(3),
          timingWeight:     +_timingWeight.toFixed(3),
          poseResetWorking: finalPose.size > 0,
          armBoneInFinalPose: !!(finalPose.get('lua') || finalPose.get('leftUpperArm')),
          bonesStable:      !_swingNaN,
          armRotNonZero:    _armNonZero,
          axisCorrect:      !!(typeof _dg.__armAxisMap === 'function'),
          liveBones: { lua: _luaRot, rua: _ruaRot, head: _headRot, lla: _llaRot },
          rootCause:        _rootCause,
        };

        // eslint-disable-next-line no-console
        console.log('[POSE_STAGE_FINAL]', {
          lua: _luaRot, rua: _ruaRot, head: _headRot, lla: _llaRot,
        });
        // eslint-disable-next-line no-console
        console.log('[FINAL_DIAGNOSIS]', _diagnosis);
        _dg.__finalDiagnosis = _diagnosis;

        // Expose callable diagnostic for DevTools
        if (typeof window !== 'undefined' && !(window as Window & { __runDiagnostic?: () => void }).__runDiagnostic) {
          (window as Window & { __runDiagnostic?: () => void }).__runDiagnostic = () => {
            // eslint-disable-next-line no-console
            console.table({
              motionInput:   _dg.__motionInput,
              poseStage1:    _dg.__poseStage1,
              finalDiagnosis: _dg.__finalDiagnosis,
              armDebug:      _dg.__armDebug,
            });
          };
        }
      }
    }

    // ── Procedural lower-body (idle weight shift + lean + knee breath) ────────
    // Position: AFTER vrm.update() AND AFTER applyFinalPoseToVrm so the VRM heartbeat
    // and the upper-body finalPose chain have already finished. Compose with the
    // additive pattern (`bone.rotation.x += dx`, `bone.position.x += dx`) so any
    // rotations / positions written by `vrm.update` are layered on top of (not
    // replaced by) our procedural deltas.
    //
    // Floor-lock note: `floorLockV121.ts` only zeroes `vrm.scene.position` /
    // quaternion — it does NOT lock `hips.position`, so the hipsOffset write is safe.
    {
      const _lowerBodyCtx: LowerBodyContext = {
        time:      typeof performance !== 'undefined' ? performance.now() * 0.001 : 0,
        speaking,
        intent:    _activeIntent,
        intensity: embFrame?.intent?.intensity ?? stableMotionEnergy,
      };
      const _lbState = computeProceduralLowerBody(_lowerBodyCtx);
      safeCall('applyLowerBodyPose', () => applyLowerBodyState(vrm, _lbState), undefined);
    }

    // ── BONE AUTHORITY: snapshot bones AFTER applyFinalPoseToVrm ──────────────
    // Compared to _liveBefore for VRM-override detection (any drift beyond
    // expected slerp progress = dual-writer or VRM internal mutation).
    const _liveAfterApply = readLiveBoneSnapshot(vrm.humanoid, TRACKED_HUMANOID_NAMES);
    traceAfterApply(_liveAfterApply);
    detectVrmOverride(_liveBefore, _liveAfterApply);

    // ── [FINAL_POSE_AFTER] + [PHASE_3] verdict ─────────────────────────────────
    if (_doFp3) {
      const _after = { head: _fp3ReadQ('head'), neck: _fp3ReadQ('neck'), lua: _fp3ReadQ('lua'), rua: _fp3ReadQ('rua') };
      console.log('[FINAL_POSE_AFTER]', _after);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _before = (globalThis as any).__fp3Before as typeof _after;
      const _qDiff = (a: typeof _after['head'], b: typeof _after['head']) => {
        if (!a || !b) return 0;
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
      };
      const _headDiff = _qDiff(_before?.head ?? null, _after.head);
      const _luaDiff  = _qDiff(_before?.lua  ?? null, _after.lua);
      const _poseChanging = (_headDiff + _luaDiff) > 0.001;
      console.log('[PHASE_3]', {
        poseChanging:  _poseChanging,
        headQuatDiff:  +_headDiff.toFixed(5),
        luaQuatDiff:   +_luaDiff.toFixed(5),
        finalPoseSize: finalPose.size,
        headBefore:    _before?.head,
        headAfter:     _after.head,
        note: !_after.head
          ? 'HEAD_KEY_MISSING — finalPose has no "head" key'
          : _poseChanging
            ? 'OK — pose is updating each frame'
            : 'STATIC — applyFinalPoseToVrm not changing head quat (slerp may already be at target)',
      });
      if (!_after.head) {
        console.warn('[PHASE_3] ⚠️ finalPose.get("head") is null — check blendPoseLayers and bindRef population');
      }
    }

    // TASK 2 (FIX): Re-propagate normalized → raw AFTER our writes.
    // vrm.humanoid.update() reads normalized bone quaternions and writes to
    // raw scene-graph bones (raw = restQuat * normalizedQuat).
    // This must run AFTER applyFinalPoseToVrm so the raw bones receive our values.
    if (vrm.humanoid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vrm.humanoid as any).update?.();
        _execLoop.s_humanoid1Executed = true;
      } catch { /* ignore — humanoid.update() not public in all versions */ }
    }
    // EXEC-AUDIT: first humanoid.update marker
    _execLoop.s_humanoid1End = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // ── Biomechanical safety net (last writer, normalized bones) ─────────────
    // Runs AFTER applyFinalPoseToVrm + humanoid.update() — the final guardian
    // for arm/shoulder bones. Per-axis Euler clamping stops any upstream axis
    // error or accumulation from producing a V-pose or hyper-extended elbow.
    //
    // idleCtx: when energy<0.01 && !speaking, a natural arm-hang pose is
    // blended in before the clamp — prevents the T-pose freeze symptom.
    if (vrm.humanoid) {
      // BiomechContext: pass active gesture so the layer widens per-axis limits
      // for wave / clap / think and never truncates their authored pose shape.
      const _bioCtx: BiomechContext = {
        gesture:  gestureStateRef.current === 'idle' ? undefined : gestureStateRef.current,
        speaking,
        energy:   stableMotionEnergy,
      };
      safeCall(
        'biomechanicalLayer',
        () => applyBiomechanicalLayer(vrm.humanoid!, _bioCtx),
        undefined,
      );
      // EXEC-AUDIT: biomechanical stage marker
      _execLoop.s_biomechEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      _execLoop.s_biomechExecuted = true;

      // ═══════════════════════════════════════════════════════════════════════
      // CRITICAL FIX — Re-propagate normalized → raw AFTER biomechanical layer.
      //
      // Bug history: humanoid.update() ran ONLY before biomechanicalLayer (above).
      // The clamp + idle pose written in biomechanicalLayer wrote to NORMALIZED
      // bones, but raw bones (which the renderer actually uses for skinning)
      // kept the unclamped pre-biomechanical values from the previous
      // humanoid.update(). Result: arms appeared in T-pose / went backward
      // even though the normalized values were correct.
      //
      // Calling humanoid.update() AGAIN here propagates the biomechanical
      // output to raw bones so what we computed = what gets rendered.
      // ═══════════════════════════════════════════════════════════════════════
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vrm.humanoid as any).update?.();
        _execLoop.s_humanoid2Executed = true;
        if (typeof globalThis !== 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__execTraceHumanoid2 = true;
        }
      } catch { /* ignore — humanoid.update() not public in all versions */ }

      // EXEC-AUDIT: second humanoid.update marker + override-detection snapshot
      _execLoop.s_humanoid2End = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _luaPost = (vrm.humanoid as any).getRawBoneNode?.('leftUpperArm') as
          | THREE.Object3D
          | undefined;
        _execLoop.ov_afterBio = _luaPost ? _luaPost.rotation.z : NaN;
      } catch { /* ignore */ }

      // ── window.__motionLayers + window.__MOTION_AUTHORITY_MAP (throttled 16 frames) ──
      // Read from DevTools: window.__motionLayers / window.__MOTION_AUTHORITY_MAP
      if (typeof window !== 'undefined' && (_execLoop.frameCount % 16 === 0)) {
        const _g   = gestureStateRef.current;
        const _en  = stableMotionEnergy;
        const _gWeight   = _g !== 'idle' ? 1.0 : 0.0;
        const _intWeight = speaking ? Math.min(0.82, Math.max(0.22, _en)) : 0.0;
        const _idleWeight = (!speaking && _en < 0.01) ? 1.0 : Math.max(0, 1.0 - _gWeight - _intWeight);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__motionLayers = {
          activeGesture: _g,
          speaking,
          energy: +_en.toFixed(3),
          layers: [
            { name: 'gesture',  priority: 100, weight: +_gWeight.toFixed(2),    active: _g !== 'idle' },
            { name: 'intent',   priority: 50,  weight: +_intWeight.toFixed(2),  active: speaking },
            { name: 'idle',     priority: 10,  weight: +_idleWeight.toFixed(2), active: !speaking && _en < 0.01 },
          ],
        };
        // ── Phase 7: Central Motion Authority Map ──────────────────────────────
        // Single source of truth for WHO owns each bone group right now.
        // Priority values match the layer contract:
        //   Gesture(100) > LookAt(80) > Emotion/Intent(60) > Idle(20) > Fallback(0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__MOTION_AUTHORITY_MAP = {
          authorityTable: [
            { layer: 'Gesture (timeline)',        priority: 100, bones: ['rua','lua','rla','lla','rh','lh','spine','chest'],        active: _g !== 'idle' },
            { layer: 'LookAt / Gaze',             priority: 80,  bones: ['head','neck'],                                           active: true },
            { layer: 'Intent / Speech Emotion',   priority: 60,  bones: ['head','neck','spine','chest','rua','lua'],                active: speaking },
            { layer: 'Procedural Idle / Breath',  priority: 20,  bones: ['spine','chest','neck','head','rua','lua','leftShoulder','rightShoulder'], active: !_g || _g === 'idle' },
            { layer: 'Biomechanical Clamp',       priority: 10,  bones: ['rua','lua','rla','lla','leftShoulder','rightShoulder'],   active: true, note: 'clamp-only, never overrides intent' },
            { layer: 'Relaxed Idle Fallback',     priority: 0,   bones: ['rua','lua','rla','lla','rightShoulder','leftShoulder'],   active: !speaking && _en < 0.01, note: 'absolute write when energy=0 and not speaking' },
          ],
          currentOwner: {
            upperArms:   _g !== 'idle' ? 'Gesture(100)' : speaking ? 'Intent(60)' : 'RelaxedIdle(0)',
            head:        'LookAt(80)',
            spine:       _g !== 'idle' ? 'Gesture(100)' : 'ProceduralIdle(20)',
          },
          hardRules: [
            'No layer writes bones after biomechanical clamp pass',
            'No += rotations on normalized bones',
            'bind/T-pose fallback only if LVP budget + decay both expired',
            'humanoid.update() called exactly twice: after applyFinalPoseToVrm, after biomechanicalLayer',
            'Scheduler cooldown: gesture.duration + 150-350ms (not hard-blocked)',
          ],
        };

        // ── window.__behaviorTimeline — Timeline Engine forensic surface ──
        // Single read gives you: active event, current phase, t inside phase,
        // global progress, envelope, polarity, inertia velocities, emotion,
        // queue depth, and the last completed-event audit.
        const _tlActive = getCurrentBehavior();
        const _tlEmotion = getBehaviorEmotion();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__behaviorTimeline = {
          active: _tlActive ? {
            type:       _tlActive.type,
            startTime:  _tlActive.startTime,
            duration:   _tlActive.duration,
            phases:     _tlActive.phases,
            intensity:  +_tlActive.intensity.toFixed(2),
            priority:   _tlActive.priority,
            source:     _tlActive.source,
          } : null,
          phase:         _behaviorFrame.phase,
          t:             +_behaviorFrame.t.toFixed(3),
          globalT:       +_behaviorFrame.globalT.toFixed(3),
          envelope:      +_behaviorFrame.envelope.toFixed(3),
          polarity:      +_behaviorFrame.polarity.toFixed(3),
          inertiaActive: _behaviorFrame.inertiaActive,
          inertia:       getInertiaSnapshot(),
          emotion:       { valence: +_tlEmotion.valence.toFixed(2), arousal: +_tlEmotion.arousal.toFixed(2) },
          queueDepth:    getBehaviorQueueDepth(),
          lastAudit:     getLastBehaviorAudit(),
        };

        const _schedRec = getMotionSchedulerCooldownDebug(
          typeof performance !== 'undefined' ? performance.now() : Date.now(),
        );
        const _gestureDom =
          isProceduralGestureFrame && rawG !== 'idle' && gestureLayerW >= 0.42;
        const _idleOv =
          isProceduralGestureFrame && rawG !== 'idle' && gestureLayerW < 0.36;
        const _clampSup =
          isProceduralGestureFrame && gBlend > 0.22 && intentArm < gBlend * 0.4;
        const _gestRead =
          gestureLayerW >= 0.38 &&
          _behaviorFrame.envelope >= 0.18 &&
          intentArm >= 0.26;
        const _inertOk =
          !!_behaviorFrame.inertiaActive ||
          (getLastBehaviorAudit()?.inertiaWorking ?? false);
        let _recRoot: string = 'blend and layers nominal';
        if (_idleOv) _recRoot = 'gesture blend weight still low vs idle on upper body';
        else if (_schedRec.blocking) _recRoot = 'ambient scheduler cooldown window active';
        else if (_clampSup) _recRoot = 'intent curve or biomechanical envelope reducing arm delta';
        else if (!_gestRead) {
          _recRoot = 'timeline envelope or gesture layer weight below readability threshold';
        }
        const _visComplete =
          _gestureDom &&
          !_idleOv &&
          !_schedRec.blocking &&
          _gestRead &&
          _inertOk &&
          !_clampSup;
        const _armsOwner =
          motionSource === 'GESTURE'
            ? 'TimelineGesture→gesturePose'
            : motionSource === 'VRMA'
              ? 'VRMA clip'
              : speaking
                ? 'Intent/speech layers'
                : 'IdlePose+humanization';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__MOTION_RECOVERY_DEBUG = {
          gestureDominant: _gestureDom,
          idleOverriding: _idleOv,
          schedulerBlocking: _schedRec.blocking,
          clampSuppressing: _clampSup,
          gestureAmplitudeReadable: _gestRead,
          inertiaWorking: _inertOk,
          visualRecoveryComplete: _visComplete,
          dominantRuntimeOwner: {
            upperBody:
              motionSource === 'GESTURE'
                ? 'gesturePose(spine,chest)+presence'
                : motionSource === 'VRMA'
                  ? 'vrmaForBlend'
                  : 'idlePose+humanization',
            arms: _armsOwner,
            head: 'LookAt+gazeIntent+intentMotion',
          },
          rootCause: _recRoot,
        };
      }

      // ── [BEHAVIOR_FINAL_AUDIT] — emit once per completed event ──
      // The timeline writes _lastAudit on event completion; we surface it to
      // the console exactly once (debounced by lastEvent reference).
      if (typeof window !== 'undefined') {
        const _audit = getLastBehaviorAudit();
        if (_audit && (window as Window & { __lastAuditRef?: object }).__lastAuditRef !== _audit) {
          (window as Window & { __lastAuditRef?: object }).__lastAuditRef = _audit;
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log('[BEHAVIOR_FINAL_AUDIT]', _audit);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FINAL HARD GROUND ENFORCEMENT — uses RAW bones (post second humanoid.update).
    //
    // Reads the actual rendered foot world Y from raw bones (the bones that
    // skin the mesh) and snaps the avatar so feet land EXACTLY on world floor.
    // Runs as the absolute last writer in the frame; nothing after this can
    // re-introduce floating.
    //
    // Throttled [FINAL_DIAGNOSIS] log gives a one-line snapshot per second of
    // the actual rendered state (raw bone arm rotations + foot Y).
    // ═══════════════════════════════════════════════════════════════════════════
    if (vrm.humanoid && vrm.scene?.parent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _hRaw = vrm.humanoid as { getRawBoneNode?: (n: any) => THREE.Object3D | undefined };
      const _liftNode = vrm.scene.parent;
      const _lFootRaw = _hRaw.getRawBoneNode?.('leftFoot');
      const _rFootRaw = _hRaw.getRawBoneNode?.('rightFoot');

      if (_lFootRaw && _rFootRaw) {
        _liftNode.updateMatrixWorld(true);
        const _lp = new THREE.Vector3();
        const _rp = new THREE.Vector3();
        _lFootRaw.getWorldPosition(_lp);
        _rFootRaw.getWorldPosition(_rp);
        const _avgRawFootY = (_lp.y + _rp.y) * 0.5;

        // Per-frame snap with deadband (no fight with normal sway).
        // Target floor is world Y = 0 (matches WORLD_FLOOR_Y).
        // For the bounded room, FloorLockRuntime handles its own targetFloorY
        // via runWorldFloorAntiDriftFrame; this hard snap only acts when
        // the deviation is significant (> 5 mm) so we don't double-correct.
        if (Number.isFinite(_avgRawFootY) && Math.abs(_avgRawFootY) > 0.005) {
          _liftNode.position.y -= _avgRawFootY;
        }

        // Throttled diagnosis (1 s).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _dg = (globalThis as any);
        const _now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!_dg.__finalGroundLastMs || _now - _dg.__finalGroundLastMs > 1000) {
          _dg.__finalGroundLastMs = _now;
          const _luaRaw = _hRaw.getRawBoneNode?.('leftUpperArm');
          const _ruaRaw = _hRaw.getRawBoneNode?.('rightUpperArm');
          const _llaRaw = _hRaw.getRawBoneNode?.('leftLowerArm');
          const _rlaRaw = _hRaw.getRawBoneNode?.('rightLowerArm');
          const _eFmt = (b: THREE.Object3D | undefined) =>
            b ? { x: +b.rotation.x.toFixed(3), y: +b.rotation.y.toFixed(3), z: +b.rotation.z.toFixed(3) } : null;
          const _liftValid = vrm.scene.parent === _liftNode;
          if (!_liftValid) {
            // eslint-disable-next-line no-console
            console.error('[LIFT_NODE_INVALID]', 'vrm.scene.parent is NOT the liftNode — grounding will fail');
          }
          // eslint-disable-next-line no-console
          console.log('[REAL_FOOT_WORLD]', +_avgRawFootY.toFixed(4));
          // eslint-disable-next-line no-console
          console.log('[GROUND_APPLIED]', +_liftNode.position.y.toFixed(4));

          // ── Speech-lifecycle integration (window.__speechLifecycle) ────────
          // Read-only — never modifies the guard state.  Surfaces race
          // conditions inline in [FINAL_DIAGNOSIS] so a single console line
          // tells you both the rendered state AND any speech-event misorder.
          const _speech = (typeof window !== 'undefined'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? ((window as any).__speechLifecycle as
                | {
                    isSpeaking: boolean;
                    lastStartMs: number;
                    lastEndMs: number;
                    blockedCount: { prematureEnd: number; overlappingStart: number; debounced: number };
                    forcedEndCount: number;
                  }
                | undefined)
            : undefined) ?? null;

          const _speechInfo = _speech
            ? {
                isSpeaking:     _speech.isSpeaking,
                sinceStartMs:   Number.isFinite(_speech.lastStartMs) ? Math.round(_now - _speech.lastStartMs) : null,
                sinceEndMs:     Number.isFinite(_speech.lastEndMs)   ? Math.round(_now - _speech.lastEndMs)   : null,
                blocked:        { ..._speech.blockedCount },
                forcedEndCount: _speech.forcedEndCount,
              }
            : null;

          // Race-condition flag — first match wins (highest severity → lowest).
          // Mirrors the user spec exactly: STUCK_SPEAKING > PREMATURE_END_BLOCKED > START_NOT_PROPAGATED.
          let _raceWarning: string | null = null;
          if (_speechInfo) {
            if (
              _speechInfo.isSpeaking &&
              _speechInfo.sinceStartMs !== null &&
              _speechInfo.sinceStartMs > 60000
            ) {
              _raceWarning = 'STUCK_SPEAKING';
            } else if ((_speechInfo.blocked?.prematureEnd ?? 0) > 0) {
              _raceWarning = 'PREMATURE_END_BLOCKED';
            } else if (
              !_speechInfo.isSpeaking &&
              _speechInfo.sinceStartMs !== null &&
              _speechInfo.sinceStartMs < 200
            ) {
              _raceWarning = 'START_NOT_PROPAGATED';
            } else if ((_speechInfo.blocked?.overlappingStart ?? 0) > 0) {
              _raceWarning = 'OVERLAPPING_START_BLOCKED';
            } else if ((_speechInfo.forcedEndCount ?? 0) > 0) {
              _raceWarning = 'FORCED_END_RECOVERY';
            }
          }

          // Geometry / motion issue — race-condition takes precedence so it's
          // the FIRST thing surfaced when both apply (race usually causes the
          // motion symptom downstream).
          const _geometryIssue =
            !_liftValid ? 'LIFT_NODE_INVALID — vrm.scene parent is wrong' :
            !Number.isFinite(_avgRawFootY) ? 'RAW_FEET_INVALID — bone world position NaN' :
            Math.abs(_avgRawFootY) > 0.05 ? 'FLOATING — feet not converged to floor' :
            (_luaRaw && _luaRaw.rotation.x > 0.4) ? 'BACKWARD_ARM — left upper arm exceeds forward bound' :
            (_luaRaw && Math.abs(_luaRaw.rotation.x) < 0.01 && Math.abs(_luaRaw.rotation.z) < 0.01 && !speaking) ? 'T_POSE_DETECTED — idle pose did not apply' :
            'OK';

          // eslint-disable-next-line no-console
          console.log('[FINAL_DIAGNOSIS]', {
            realFootY:    +_avgRawFootY.toFixed(4),
            liftNodeY:    +_liftNode.position.y.toFixed(4),
            grounded:     Math.abs(_avgRawFootY) < 0.01,
            liftNodeValid: _liftValid,
            rawArm: {
              lUpper: _eFmt(_luaRaw),
              rUpper: _eFmt(_ruaRaw),
              lLower: _eFmt(_llaRaw),
              rLower: _eFmt(_rlaRaw),
            },
            speech: _speechInfo,
            race:   _raceWarning,
            issue:  _raceWarning ? `${_raceWarning} (geometry: ${_geometryIssue})` : _geometryIssue,
          });
        }
      } else {
        // Foot bones not available — log once per session.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _dg = (globalThis as any);
        if (!_dg.__rawFootMissingLogged) {
          _dg.__rawFootMissingLogged = true;
          // eslint-disable-next-line no-console
          console.warn('[REAL_FOOT_WORLD] Raw foot bones not available — falling back to FloorLockRuntime only.');
        }
      }
    }

    // ── REMOVED: post-VRM "failsafe" direct bone writes (`+=` block) ─────────
    // Rationale (architectural critique, no patching):
    //   The previous block resolved head / neck / leftUpperArm / rightUpperArm
    //   via vrm.humanoid.getNormalizedBoneNode AFTER applyFinalPoseToVrm and
    //   added _ms.headNod * _postAmp ON TOP of whatever the slerp had just
    //   written, using `+=`.  This was wrong on three independent axes:
    //     1.  Triple amplification — _motionState was already amplified ×3 in
    //         _ampedMotionState, then ×2 inside applyIntentMotionState for the
    //         head; adding raw _ms × 3 on top produced jitter / drift.
    //     2.  Frame-to-frame accumulation — `+=` does not reset to baseline,
    //         so slerp pulled the bone back toward finalPose while this block
    //         kept pushing it forward, producing oscillation.
    //     3.  Dual-source authority — applyFinalPoseToVrm IS the single bone
    //         writer; bypassing the pose pipeline silently breaks PoseComposer
    //         weights, kinematic locks, and per-bone overrides.
    //   The motion that this block was "failsafing" is already applied through
    //   the canonical path:  applyIntentMotionState → finalPose → applyFinalPoseToVrm.
    //   If you need to inspect the raw bones for debugging, set
    //   `window.__directBoneOverride = true` in the console; this opt-in path
    //   uses absolute assignment (`=`), reads the *amped* motionState, and is
    //   strictly diagnostic.
    if (
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__directBoneOverride === true &&
      vrm.humanoid
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _ms = (globalThis as any).__cogniMotionState as
        | { headNod?: number; headTilt?: number; openGesture?: number }
        | undefined;
      if (_ms) {
        try {
          const _hNode = vrm.humanoid.getNormalizedBoneNode('head' as never);
          const _lNode = vrm.humanoid.getNormalizedBoneNode('leftUpperArm' as never);
          const _rNode = vrm.humanoid.getNormalizedBoneNode('rightUpperArm' as never);
          const _nNode = vrm.humanoid.getNormalizedBoneNode('neck' as never);
          const _hn = (_ms.headNod ?? 0) * 0.6;
          const _ht = (_ms.headTilt ?? 0) * 0.6;
          const _og = (_ms.openGesture ?? 0) * 0.6;
          // Each write below runs through applyBoneRotationSafe so it
          // registers PHYSICS authority and surfaces an [AUTHORITY_CONFLICT]
          // log when the canonical pipeline already wrote that bone.
          const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
          if (_hNode) {
            _eul.set(_hn, 0, _ht);
            applyBoneRotationSafe(_hNode, _eul, BoneAuthority.PHYSICS);
          }
          if (_nNode) {
            _eul.set(_hn * 0.3, 0, 0);
            applyBoneRotationSafe(_nNode, _eul, BoneAuthority.PHYSICS);
          }
          if (_lNode) {
            _eul.set(0, 0,  _og * 0.45);
            applyBoneRotationSafe(_lNode, _eul, BoneAuthority.PHYSICS);
          }
          if (_rNode) {
            _eul.set(0, 0, -_og * 0.45);
            applyBoneRotationSafe(_rNode, _eul, BoneAuthority.PHYSICS);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vrm.humanoid as any).update?.();
          if (AVATAR_DEBUG) {
            console.log('[DIRECT_BONE_OVERRIDE] enabled — bypassing pose pipeline', {
              hn: _hn.toFixed(3),
              ht: _ht.toFixed(3),
              og: _og.toFixed(3),
            });
          }
        } catch { /* humanoid api shape varies */ }
      }
    }

    // ── TASK 4 (FIX): Hard override test — resolves bones live from vrm.humanoid ──
    // Enable: window.__forcedMotionTest = true
    // Resolves bones live each frame — no cached ref dependency.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((typeof window !== 'undefined') && (window as any).__forcedMotionTest) {
      const _fmtSin = Math.sin(performance.now() * 0.002) * 0.3;
      // Always resolve from vrm.humanoid — never use cached refs here
      const _fHead = vrm.humanoid?.getNormalizedBoneNode('head'         as never) ?? null;
      const _fLua  = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm' as never) ?? null;
      const _fRua  = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm' as never) ?? null;
      const _fNeck = vrm.humanoid?.getNormalizedBoneNode('neck'         as never) ?? null;
      // Use applyBoneRotationSafe so PHYSICS authority is registered and
      // any concurrent writer surfaces as [AUTHORITY_CONFLICT].
      const _fmtEul = new THREE.Euler(0, 0, 0, 'YXZ');
      if (_fHead) {
        _fmtEul.set(_fmtSin, 0, 0);
        applyBoneRotationSafe(_fHead, _fmtEul, BoneAuthority.PHYSICS);
      }
      if (_fLua) {
        _fmtEul.set(0, 0,  0.8);
        applyBoneRotationSafe(_fLua, _fmtEul, BoneAuthority.PHYSICS);
      }
      if (_fRua) {
        _fmtEul.set(0, 0, -0.8);
        applyBoneRotationSafe(_fRua, _fmtEul, BoneAuthority.PHYSICS);
      }
      if (_fNeck) {
        _fmtEul.set(0, Math.sin(performance.now() * 0.001) * 0.15, 0);
        applyBoneRotationSafe(_fNeck, _fmtEul, BoneAuthority.PHYSICS);
      }
      // Re-propagate so raw bones reflect our writes
      try { (vrm.humanoid as any)?.update?.(); } catch { /* ignore */ }
      console.log('[FORCED_MOTION_TEST]', {
        boneSource: 'vrm.humanoid.getNormalizedBoneNode',
        head_rx: _fHead?.rotation.x.toFixed(3) ?? 'NULL_NODE',
        lua_rz:  _fLua?.rotation.z.toFixed(3)  ?? 'NULL_NODE',
        rua_rz:  _fRua?.rotation.z.toFixed(3)  ?? 'NULL_NODE',
        nodesExist: { head: !!_fHead, lua: !!_fLua, rua: !!_fRua },
        verdict: (!_fHead && !_fLua)
          ? 'NODES_NULL — vrm.humanoid cannot find bones by name'
          : 'NODES_VALID — if no movement, check spring bone or scene graph',
      });
    }

    enforceAvatarRootStability(vrm);

    // ── BONE AUTHORITY: end-of-frame summary + freeze + root-motion ───────────
    // (1) Freeze detector — warns when a bone hasn't moved in ≥90 frames.
    //     Pulls live nodes through humanoid; bones not present silently skip.
    if (vrm.humanoid) {
      const _freezeBones: Record<string, THREE.Object3D | null | undefined> = {};
      for (const name of TRACKED_HUMANOID_NAMES) {
        try {
          _freezeBones[name] = vrm.humanoid.getNormalizedBoneNode(name as never) ?? null;
        } catch { _freezeBones[name] = null; }
      }
      tickFreezeDetector(_freezeBones);
    }
    // (2) Root-motion — log AvatarRoot (outer locomotion group) vs vrm.scene
    //     (inner, expected to stay at origin via enforceAvatarRootStability).
    {
      // Outer AvatarRoot is the grandparent of vrm.scene:
      //   AvatarRoot → liftNode → vrm.scene
      const _avatarRoot = vrm.scene?.parent?.parent ?? null;
      const _vrmScene   = vrm.scene;
      if (_avatarRoot && _vrmScene) {
        logRootMotion(
          { x: +_avatarRoot.position.x.toFixed(3), z: +_avatarRoot.position.z.toFixed(3) },
          {
            x: +_vrmScene.position.x.toFixed(4),
            y: +_vrmScene.position.y.toFixed(4),
            z: +_vrmScene.position.z.toFixed(4),
          },
        );
        // ── PART 3: Locomotion watcher ──────────────────────────────────────
        // Detects "dead root" (no translation for ≥240 frames) and emits
        // [LOCOMOTION_DEAD].  When the user opts in via
        // `window.__INJECT_LOCOMOTION_FALLBACK = true`, applies a sub-mm
        // sin sway to the outer AvatarRoot so the avatar never freezes
        // in place visually.  Off by default — purely opt-in.
        const _loco = tickLocomotionWatcher();
        if (_loco.dead && _loco.injectAllowed && _loco.suggested) {
          _avatarRoot.position.x += _loco.suggested.dx;
          _avatarRoot.position.z += _loco.suggested.dz;
        }
      }
    }
    // (3) Final-frame trace — head / arms / hips + per-frame conflict count.
    {
      const _liveFinal = vrm.humanoid
        ? readLiveBoneSnapshot(vrm.humanoid, TRACKED_HUMANOID_NAMES)
        : {};
      let _hipsLocal: { x: number; y: number; z: number } | undefined;
      try {
        const _hipsNode = vrm.humanoid?.getNormalizedBoneNode('hips' as never);
        if (_hipsNode) {
          _hipsLocal = {
            x: +_hipsNode.position.x.toFixed(4),
            y: +_hipsNode.position.y.toFixed(4),
            z: +_hipsNode.position.z.toFixed(4),
          };
        }
      } catch { /* hips missing — already covered by [POSE_LOSS] */ }
      const _avatarRoot = vrm.scene?.parent?.parent ?? null;
      traceFinalFrame({
        liveBones:    _liveFinal,
        externalRoot: _avatarRoot
          ? { x: +_avatarRoot.position.x.toFixed(3), z: +_avatarRoot.position.z.toFixed(3) }
          : undefined,
        vrmRoot: vrm.scene ? {
          x: +vrm.scene.position.x.toFixed(4),
          y: +vrm.scene.position.y.toFixed(4),
          z: +vrm.scene.position.z.toFixed(4),
        } : undefined,
        hipsLocal: _hipsLocal,
      });
    }

    // TASK 7: [FINAL_STATE] — throttled proof-of-fix log (~1/s)
    if (AVATAR_DEBUG) {
      const _fsNow = typeof performance !== 'undefined' ? performance.now() : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _fsLast = (globalThis as any).__finalStateLogLastMs ?? 0;
      if (_fsNow - _fsLast > 1000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__finalStateLogLastMs = _fsNow;
        const _fsHead = vrm.humanoid?.getNormalizedBoneNode('head' as never) ?? null;
        const _fsLua  = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm' as never) ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _ms = (globalThis as any).__cogniMotionState;
        console.log('[FINAL_STATE]', {
          boneSource:         'vrm.humanoid.getNormalizedBoneNode',
          appliedAfterUpdate: true,
          overrideDetected:   false,
          headNode:           !!_fsHead,
          luaNode:            !!_fsLua,
          head_rx:            _fsHead?.rotation.x.toFixed(4) ?? 'null',
          lua_rz:             _fsLua?.rotation.z.toFixed(4)  ?? 'null',
          motionState:        _ms ?? 'unset',
          finalPoseSize:      finalPose.size,
          speaking,
          motionSource,
        });
      }
    }

    // ── [PHASE_5] [BONE_CHECK] — bone reference validity (throttled 1s) ─────
    // Debug-only: pure diagnostic.  Errors and warnings still print
    // unconditionally below when a real failure is detected.
    if (AVATAR_DEBUG && typeof performance !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _p5Last = (globalThis as any).__phase5LogLastMs ?? 0;
      const _p5Now  = performance.now();
      if (_p5Now - _p5Last > 1000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__phase5LogLastMs = _p5Now;

        // Resolve fresh every check — same call used by applyFinalPoseToVrm.
        const _p5Head = vrm.humanoid?.getNormalizedBoneNode('head'         as never) ?? null;
        const _p5Neck = vrm.humanoid?.getNormalizedBoneNode('neck'         as never) ?? null;
        const _p5Lua  = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm' as never) ?? null;
        const _p5Rua  = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm' as never) ?? null;

        // Identity check: same object ref across frames?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _prevHead = (globalThis as any).__phase5PrevHead;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _prevLua  = (globalThis as any).__phase5PrevLua;
        const _sameHead = _prevHead !== undefined ? (_prevHead === _p5Head) : null;
        const _sameLua  = _prevLua  !== undefined ? (_prevLua  === _p5Lua)  : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__phase5PrevHead = _p5Head;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__phase5PrevLua  = _p5Lua;

        const _validBone = !!_p5Head && !!_p5Lua;

        console.log('[BONE_CHECK]', {
          head: _p5Head ? {
            rx: +_p5Head.rotation.x.toFixed(4),
            ry: +_p5Head.rotation.y.toFixed(4),
            rz: +_p5Head.rotation.z.toFixed(4),
            name: _p5Head.name,
          } : null,
          neck: _p5Neck ? { rx: +_p5Neck.rotation.x.toFixed(4), name: _p5Neck.name } : null,
          lua:  _p5Lua  ? { rz: +_p5Lua.rotation.z.toFixed(4),  name: _p5Lua.name  } : null,
          rua:  _p5Rua  ? { rz: +_p5Rua.rotation.z.toFixed(4),  name: _p5Rua.name  } : null,
        });

        console.log('[PHASE_5]', {
          validBone:       _validBone,
          headNode:        !!_p5Head,
          luaNode:         !!_p5Lua,
          headName:        _p5Head?.name ?? 'NOT_FOUND',
          luaName:         _p5Lua?.name  ?? 'NOT_FOUND',
          sameRefAcrossFrames: { head: _sameHead, lua: _sameLua },
          headRotation:   _p5Head ? {
            x: +_p5Head.rotation.x.toFixed(4),
            y: +_p5Head.rotation.y.toFixed(4),
            z: +_p5Head.rotation.z.toFixed(4),
          } : null,
          verdict: !_p5Head
            ? 'NULL_BONE — vrm.humanoid cannot resolve "head" — check VRM model humanoid spec'
            : (_sameHead === false)
              ? 'UNSTABLE_REF — bone object identity changed between frames (VRM reload?)'
              : 'OK — bone node valid and stable',
        });

        if (!_validBone) {
          console.error(
            '[PHASE_5] ❌ Bone node is NULL.',
            'head:', !!_p5Head, '| lua:', !!_p5Lua,
            '— humanoid bones not resolving. Check [AVATAR_AUDIT:BONES] output.',
          );
        } else if (_sameHead === false) {
          console.warn(
            '[PHASE_5] ⚠️ Bone ref changed identity between frames.',
            'VRM may have been re-loaded mid-session.',
          );
        }
      }
    }

    prevMotionSourceRef.current = motionSource;

    // ── EXECUTION-LOOP AUDIT — frame end marker + throttled report ───────────
    _execLoop.s_frameEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _luaEnd = (vrm.humanoid as any)?.getRawBoneNode?.('leftUpperArm') as
        | THREE.Object3D
        | undefined;
      _execLoop.ov_atFrameEnd = _luaEnd ? _luaEnd.rotation.z : NaN;
    } catch { /* ignore */ }

    // FPS measurement: 1-second sliding window.
    if (_execLoop.s_frameEnd - _execLoop.fpsWindowStartMs >= 1000) {
      _execLoop.measuredFps = _execLoop.fpsWindowFrames;
      _execLoop.fpsWindowFrames = 0;
      _execLoop.fpsWindowStartMs = _execLoop.s_frameEnd;
    }

    // [EXECUTION_DIAGNOSIS] — one log per second, full report.
    if (_execLoop.s_frameEnd - _execLoop.lastDiagnosisMs > 1000) {
      _execLoop.lastDiagnosisMs = _execLoop.s_frameEnd;

      // Order check: timestamps must be non-decreasing (motion ≤ finalPose ≤ h1 ≤ bio ≤ h2 ≤ end).
      const _tStages = [
        _execLoop.s_motionEnd,
        _execLoop.s_finalPoseEnd,
        _execLoop.s_humanoid1End,
        _execLoop.s_biomechEnd,
        _execLoop.s_humanoid2End,
        _execLoop.s_frameEnd,
      ];
      let _orderCorrect = true;
      for (let i = 1; i < _tStages.length; i++) {
        if (_tStages[i] < _tStages[i - 1]) { _orderCorrect = false; break; }
      }

      // Override detection: did anything move leftUpperArm.rotation.z between
      // the second humanoid.update and the frame end?
      const _ovDelta = Math.abs(_execLoop.ov_atFrameEnd - _execLoop.ov_afterBio);
      const _overrideDetected =
        Number.isFinite(_ovDelta) && _ovDelta > 1e-4;

      // Motion-active heuristic: read snapshot from [MOTION_INPUT].
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _mi = (globalThis as any).__motionInput as
        | { speaking?: boolean; energy?: number }
        | undefined;
      const _motionActive = !!_mi?.speaking || (_mi?.energy ?? 0) > 0.01;

      const _allStagesOk =
        _execLoop.s_motionExecuted &&
        _execLoop.s_finalPoseExecuted &&
        _execLoop.s_humanoid1Executed &&
        _execLoop.s_biomechExecuted &&
        _execLoop.s_humanoid2Executed;

      let _rootCause: string;
      if (_execLoop.earlyReturnReason)        _rootCause = `EARLY_RETURN — ${_execLoop.earlyReturnReason}`;
      else if (!_allStagesOk)                 _rootCause = 'STAGE_SKIPPED — pipeline did not reach all stages';
      else if (!_orderCorrect)                _rootCause = 'ORDER_VIOLATION — stage timestamps not monotonic';
      else if (_overrideDetected)             _rootCause = `OVERRIDE_DETECTED — leftUpperArm.z drifted ${_ovDelta.toFixed(4)} after second humanoid.update`;
      else if (_execLoop.measuredFps < 30)    _rootCause = `LOW_FPS — measured ${_execLoop.measuredFps} fps`;
      else                                    _rootCause = 'OK';

      const _report = {
        loopRunning:        true, // we are inside useFrame, so it's running
        fpsStable:          _execLoop.measuredFps >= 30,
        measuredFps:        _execLoop.measuredFps,
        orderCorrect:       _orderCorrect,
        motionActive:       _motionActive,
        overridesDetected:  _overrideDetected,
        earlyReturnFound:   _execLoop.earlyReturnReason !== null,
        stages: {
          motion:        _execLoop.s_motionExecuted,
          applyFinalPose: _execLoop.s_finalPoseExecuted,
          humanoidUpdate1: _execLoop.s_humanoid1Executed,
          biomechanical: _execLoop.s_biomechExecuted,
          humanoidUpdate2: _execLoop.s_humanoid2Executed,
        },
        timings: {
          motionToFinalPose:    +(_execLoop.s_finalPoseEnd - _execLoop.s_motionEnd).toFixed(2),
          finalPoseToHumanoid1: +(_execLoop.s_humanoid1End - _execLoop.s_finalPoseEnd).toFixed(2),
          humanoid1ToBio:       +(_execLoop.s_biomechEnd - _execLoop.s_humanoid1End).toFixed(2),
          bioToHumanoid2:       +(_execLoop.s_humanoid2End - _execLoop.s_biomechEnd).toFixed(2),
          humanoid2ToEnd:       +(_execLoop.s_frameEnd - _execLoop.s_humanoid2End).toFixed(2),
          totalFrameMs:         +(_execLoop.s_frameEnd - _execLoop.s_motionEnd).toFixed(2),
        },
        ovBoneZ: {
          afterBio:   Number.isFinite(_execLoop.ov_afterBio)   ? +_execLoop.ov_afterBio.toFixed(4)   : null,
          atFrameEnd: Number.isFinite(_execLoop.ov_atFrameEnd) ? +_execLoop.ov_atFrameEnd.toFixed(4) : null,
          delta:      Number.isFinite(_ovDelta) ? +_ovDelta.toFixed(4) : null,
        },
        frameCount: _execLoop.frameCount,
        rootCause:  _rootCause,
      };

      // eslint-disable-next-line no-console
      console.log('[EXECUTION_DIAGNOSIS]', _report);

      // Expose for live inspection from DevTools.
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__executionDiagnosis = _report;
      }
    }

    // ── Runtime assertions — motion dead / energy mismatch (throttled ~1 Hz) ──
    if (_execLoop.frameCount % 60 === 0) {
      if (!speaking && motionEnergyUnified === 0) {
        console.warn('[MOTION_DEAD_STATE]', { speaking, energy: motionEnergyUnified });
      }
      if (speaking && motionEnergyUnified === 0) {
        console.error('[CRITICAL] SPEAKING_WITH_ZERO_ENERGY');
      }
    }
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__FINAL_RUNTIME_CHECK = {
        speaking,
        energy: motionEnergyUnified,
        logsReduced: true,
        gesturesPossible: speaking && motionEnergyUnified > 0.05,
      };
      (window as any).__RUNTIME_CHECK = {
        speaking,
        energy: motionEnergyUnified,
        gestureActive: Math.max(0, _behaviorFrame.envelope) > 0.05,
        hasMotion: motionEnergyUnified > 0.05,
      };
    }

    // ── BONE AUTHORITY: end-of-frame root-cause emit + close trace group ──────
    // emitRootCauseIfAny is rate-limited internally (≥90 frames between logs)
    // and only logs when the diagnostic summary contains an actual problem.
    // Always called so window.__avatarRootCause() returns up-to-date data.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      const _bone2 = vrm?.humanoid?.getRawBoneNode?.('rightUpperArm' as never);
      let rootCause =
        'NONE — observed full-frame path (no early return); see poseApplied / biomech / humanoid flags';
      if (!vrm || !vrm.humanoid) rootCause = 'VRM_OR_HUMANOID_FALSE_AT_FRAME_END';
      else if (!_bone2) rootCause = 'RAW_BONE_rightUpperArm_UNRESOLVED_AT_FRAME_END';
      else if (!g.__execTracePoseApplied) rootCause = 'applyFinalPoseToVrm_SITE_NOT_REACHED_OR_FLAG_NOT_SET';
      else if (!g.__execTraceBiomech) rootCause = 'applyBiomechanicalLayer_NOT_ENTERED_THIS_FRAME';
      else if (!g.__execTraceHumanoid2) rootCause = 'SECOND_humanoid.update_NOT_RECORDED_THIS_FRAME';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EXECUTION_TRACE = {
        useFrameRunning: true,
        vrmLoaded: !!vrm && !!vrm.humanoid,
        bonesAvailable: !!_bone2,
        earlyReturnTriggered: false,
        poseApplied: !!g.__execTracePoseApplied,
        biomechRunning: !!g.__execTraceBiomech,
        humanoidUpdated: !!g.__execTraceHumanoid2,
        rootCause,
      };
    }

    emitRootCauseIfAny();
    endFrameTraceGroup();
  }, 0);

  return null;
}