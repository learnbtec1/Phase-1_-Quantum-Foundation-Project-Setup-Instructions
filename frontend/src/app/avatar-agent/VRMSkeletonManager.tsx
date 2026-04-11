'use client';

import React, { type MutableRefObject, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { VRMA_TO_CANONICAL } from '@/constants/gestures';
import { ARM_IDLE, ARM_OFFSETS, composeArmTargets } from './armGestureReference';

const TAB_SAFE_MAX_DELTA = 0.1;

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
// ★ ACTUAL BONE AXES — cogni_final.vrm (runtime observation):
//
//   Empirical fix: negative RUA/LUA X pulled arms *backward* in the viewer;
//   gesture forward reach uses **positive** upper-arm X on this rig.
//
//   RIGHT arm (normalized): Z+ = up, Z- = down; X sign per model (here +X = reach fwd).
//   LEFT arm: Z mirrored for up/down; same X sign for symmetric forward reach.
//
//   Idle rest (this rig): RUA_Z **+** = down | LUA_Z **−** = down (mirrored).
//   Use GestureCalibrator (dev panel, bottom-right) → Copy Constants.
//
//   Forward-extension: +RUA/LUA X = reach forward (empirical on cogni_final.vrm).
//     idle:    RUA_Z +1.4, LUA_Z −1.4 ; X=0
//     explain: X=+1.2, Z≈+0.2 ; Y=0 ; elbows unchanged unless tuned
//     point:   RUA Z≈+0.1 ; left at side LUA_Z −1.2
//     think:   RUA Z≈−0.6 (raise toward face) ; RLA_Z bends elbow
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  IDLE pose — مرجع ثابت من armGestureReference.ts (كل إيماءة = idle + إزاحة)
// ═══════════════════════════════════════════════════════════════════════════════
// Arm axes in YXZ Euler (SK_E.set(ex, ey, ez, 'YXZ')):
//   ey (Y) → horizontal swing: swing arm FORWARD/BACKWARD in world plane
//   ez (Z) → vertical swing:   arm DOWN (+Z right / -Z left) from T-pose
//   ex (X) → roll/twist:       roll around the arm's length axis
// The idle slerp previously hardcoded ey=0 — arm stayed in T-pose.
// Now reads IDLE_RUA_Y / IDLE_LUA_Y so ruaY in ARM_IDLE controls forward swing.
const IDLE_RUA_X                 = ARM_IDLE.ruaX;
const IDLE_RUA_Y                 = ARM_IDLE.ruaY;   // ← NEW: forward/backward swing
const IDLE_RUA_Z                 = ARM_IDLE.ruaZ;
const IDLE_LUA_X                 = ARM_IDLE.luaX;
const IDLE_LUA_Y                 = ARM_IDLE.luaY;   // ← NEW: forward/backward swing (left)
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
const FREEZE_IDLE_ANIMATIONS     = false;

/**
 * BLOCK_ALL_GESTURES = true → ignores ALL incoming avatar:gesture events.
 * Avatar stays locked at ARM_IDLE permanently (no wave, think, point, etc.).
 * Set false to restore normal gesture behaviour after calibrating ARM_OFFSETS.
 */
const BLOCK_ALL_GESTURES         = true;

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
const EXPLAIN_HIP_TILT_Z         =  0.025;
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
const POINT_HIP_TILT_Z           = -0.018;

// ─── VRMA → cogni_final.vrm (إيماءات إجرائية) ────────────────────────────────
// ① عكس إشارة X (أحياناً Z) للذراع/الساعد/المعصم إذا اتجهت للخلف بدل الأمام.
// ② GestureCalibrator: ضبط بصري ثم Copy Constants (الأدق).
// ③ إن بقيت مشوهة: جرّب ترتيب أويلر آخر في SK_E.set داخل slerpArmEuler (افتراضي YXZ).

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
const INTENT_SLERP_PREP  = 0.45; // slow — limb eases into motion
const INTENT_SLERP_ATTACK = 2.2; // fast — confident reach to peak
const INTENT_SLERP_HOLD  = 0.65; // medium — settle at peak
const INTENT_SLERP_DECAY = 0.38; // very slow — organic release
// Hold micro-oscillation: simulates sustained muscle activation at peak
const INTENT_HOLD_OSC_AMP  = 0.048; // ±4.8% of target amplitude
const INTENT_HOLD_OSC_FREQ = 6.5;   // Hz — subtle but visible

/** بعد تغيّر الإيماءة: يبطّئ معدلات slerp ثم يعود للكامل (يقلّل القفزات). */
const GESTURE_CROSSFADE_MS = 420;

/** تبديل وضعية idle كل 8–12 ثانية تقريباً */
const IDLE_VARIANT_INTERVAL_MIN = 8000;
const IDLE_VARIANT_INTERVAL_MAX = 12000;

// ─── Anticipation / follow-through (حركة أكثر طبيعية) ─────────────────────
/** أول ~9% من مدة الإيماءة: سحب خفيف نحو وضع «قبل الانطلاق» */
const GESTURE_ANT_FRAC = 0.09;
/** آخر ~14%: نبضة متابعة (زيادة خفيفة ثم ذوبان مع fadeOut) */
const GESTURE_FOLLOW_FRAC = 0.14;
// Explain wind-up: nudge RUA_X slightly toward neutral. With negative EXPLAIN_RUA_X,
// use a positive offset so the arm eases from less negative into the pose.
const ANT_RUA_X_EXPLAIN = 0.28;
const ANT_RUA_X_POINT   = -0.38;
const ANT_RUA_X_THINK   = -0.45;
/** كتف أيمن: رفع عكسي خفيف أثناء التوقّع ثم يختفي */
const ANT_SHOULDER_R_EXPLAIN = -0.022;
const ANT_SHOULDER_R_THINK = -0.028;
/** ورك: ميل معاكس خفيف جداً أثناء التوقّع */
const ANT_HIP_Z_POINT = 0.012;
const ANT_HIP_Z_EXPLAIN = -0.008;
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
// Eye saccade: random micro eye-gaze jumps every 2–5 s
const BIO_SACCADE_IVAL_MIN = 2300;  // ms min between saccades
const BIO_SACCADE_IVAL_MAX = 4700;  // ms max
const BIO_SACCADE_AMP      = 0.014; // saccade magnitude (radians)
const BIO_SACCADE_SPEED    = 20;    // lerp speed toward saccade target (settle)
const BIO_SACCADE_DECAY    = 2.8;   // lerp speed back toward zero between saccades

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

// ─── Generative blend ───────────────────────────────────
const GENERATIVE_FADE_MS   = 350;

type GenerativeBoneRot = { x: number; y: number; z: number };

/** مفاتيح واردة من MIBURI/RIDGE وغيرها → مفتاح داخلي واحد */
function normalizeGenerativeBoneKey(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').toLowerCase();
  const map: Record<string, string> = {
    rightupperarm: 'rua',
    rightarm: 'rua',
    rua: 'rua',
    leftupperarm: 'lua',
    leftarm: 'lua',
    lua: 'lua',
    rightlowerarm: 'rla',
    rightforearm: 'rla',
    rla: 'rla',
    leftlowerarm: 'lla',
    leftforearm: 'lla',
    lla: 'lla',
    righthand: 'rh',
    rightwrist: 'rh',
    rh: 'rh',
    lefthand: 'lh',
    leftwrist: 'lh',
    lh: 'lh',
    neck: 'neck',
    head: 'head',
    spine: 'spine',
    chest: 'chest',
    upperchest: 'chest',
    // ★ NEW — shoulder and hip aliases
    rightshoulder: 'rshoulder',
    rshoulder: 'rshoulder',
    leftshoulder: 'lshoulder',
    lshoulder: 'lshoulder',
    hips: 'hips',
    hip: 'hips',
  };
  return map[s] ?? null;
}

const noiseHead   = createNoise3D();
const noiseBreath = createNoise3D();
const noiseArm    = createNoise3D(); // organic arm / gesture wave noise
const noiseJitter = createNoise3D(); // micro-jitter for wrists & head

function readAnalyserVolume(
  analyser: AnalyserNode,
  bufRef: React.MutableRefObject<Uint8Array | null>,
): number {
  const n = analyser.frequencyBinCount;
  let buf = bufRef.current;
  if (!buf || buf.length !== n) {
    buf = new Uint8Array(n);
    bufRef.current = buf;
  }
  analyser.getByteFrequencyData(buf as Parameters<AnalyserNode['getByteFrequencyData']>[0]);
  let s = 0;
  const bands = Math.min(12, n);
  for (let i = 0; i < bands; i++) s += buf[i] ?? 0;
  return Math.min(1, s / (bands * 255));
}

type GestureId = 'idle' | 'explain' | 'point' | 'think' | 'wave' | 'clap' | 'agree';

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
};

function isGestureId(s: string): s is GestureId {
  return s === 'idle' || s === 'explain' || s === 'point' || s === 'think' || s === 'wave' || s === 'clap' || s === 'agree';
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

function normalizeDurationMs(d: Record<string, unknown> | undefined | null): number {
  if (!d) return 3000;
  const dur = d.duration;
  if (typeof dur !== 'number' || !Number.isFinite(dur)) return 3000;
  if (dur > 0 && dur < 60) return Math.max(1, Math.round(dur * 1000));
  return Math.max(1, dur);
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
   * ويترك VRMAPlayer يتحكم بالعظام عبر AnimationMixer. التنفس/التعبيرات/النظر تعمل كالمعتاد.
   */
  vrmaActiveRef?: MutableRefObject<boolean>;
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
 *   3. VRMSkeletonManager (priority 0, this file) — reads
 *      neckGazeYawRef/PitchRef and combines them with
 *      procedural sway via noise. Writes ALL rotations to
 *      NORMALIZED bones (getNormalizedBoneNode). Calls
 *      vrm.update(delta) once at end; humanoid.update() inside
 *      it propagates normalized→raw with correct per-model
 *      coordinate transforms. autoUpdateHumanBones = true (default).
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
}: VRMSkeletonManagerProps): null {

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
  const gestureCrossfadeStartMsRef = useRef(performance.now());

  const idleVariantRef = useRef<IdleVariant>('neutral');
  const idleVariantNextSwitchRef = useRef(0);

  const generativeBonesRef  = useRef<Map<string, GenerativeBoneRot>>(new Map());
  const generativeEndMsRef  = useRef(0);
  const generativeBlendRef  = useRef(0);
  const volumeBufRef        = useRef<Uint8Array | null>(null);
  const lastGestureFrameLogMsRef = useRef(0);
  const lastIdleZLogMsRef = useRef(0);

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

  // ── Eye saccade: micro random gaze jumps every 2–5 s ─────────────────────
  const saccadeXRef      = useRef(0);  // current smoothed pitch offset
  const saccadeYRef      = useRef(0);  // current smoothed yaw offset
  const saccadeNextMsRef = useRef(0);  // timestamp of next trigger
  const saccadeTgtXRef   = useRef(0);  // saccade target pitch
  const saccadeTgtYRef   = useRef(0);  // saccade target yaw

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
      const GESTURES = ['think', 'wave', 'clap', 'agree', 'idle', 'explain', 'point'];

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
        console.log(`[Cogni] ▶ playGesture("${g}", ${(dur/1000).toFixed(1)}s, intensity=${intensity.toFixed(2)}, mood=${mood})`);
      }
    };
    return () => {
      if (w.__cogniPlayGesture) delete w.__cogniPlayGesture;
    };

    /** Dev helper — plays a procedural gesture via the same event path as the engine. */
    w.__cogniPlayProceduralGesture = (gesture: string, durationSec = 2.5) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Dev] 🎭 Playing procedural gesture: ${gesture} (${durationSec}s)`);
      }
      window.dispatchEvent(
        new CustomEvent('avatar:gesture', {
          detail: { gesture, type: gesture, duration: durationSec },
        }),
      );
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('[VRMSkeletonManager] ✅ window.__vrm / window.__cogniVRM bound');
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

    console.log('[VRMSkeletonManager] ✅ Humanoid found. Caching NORMALIZED bones...');

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
    console.table(boneStatus);

    const nullBones = CRITICAL_BONES.filter(
      (bname) => !humanoid.getNormalizedBoneNode(bname as never),
    );
    if (nullBones.length > 0) {
      console.error('[VRMSkeletonManager] ⚠️ Missing normalized bones:', nullBones);
    } else {
      console.log('[VRMSkeletonManager] 🎉 All critical normalized bones found!');
    }

    console.log('[VRMSkeletonManager] ✅ VRM ready, registering gesture handlers');

    // ── Global debug handles ──────────────────────────────────────────────────
    // __vrm / __cogniVRM are managed by the dedicated effect above.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__cogniRefs = { rua: ruaRef, rla: rlaRef, lua: luaRef, lla: llaRef, rh: rhRef, lh: lhRef };
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
      console.log('[VRMSkeletonManager] ✅ autoUpdateHumanBones =', humanoid.autoUpdateHumanBones, '(normalized → raw propagation active)');
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
        if (ruaRef.current) {
          console.log('[VRMSkeletonManager] ✅ Deferred bone acquisition succeeded — rightUpperArm now valid.');
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
      const durRaw = detail.durationMs;
      const durationMs =
        typeof durRaw === 'number' && Number.isFinite(durRaw) && durRaw > 0 ? durRaw : 1400;

      generativeBlendRef.current = blend;
      generativeEndMsRef.current = performance.now() + durationMs;

      const gm = generativeBonesRef.current;
      gm.clear();
      for (const [key, val] of Object.entries(bones as Record<string, unknown>)) {
        const nk = normalizeGenerativeBoneKey(key);
        if (!nk || !val || typeof val !== 'object') continue;
        const o = val as Record<string, unknown>;
        const x = typeof o.x === 'number' ? o.x : 0;
        const y = typeof o.y === 'number' ? o.y : 0;
        const z = typeof o.z === 'number' ? o.z : 0;
        gm.set(nk, { x, y, z });
      }
    };

    window.addEventListener('avatar:generative:gesture', onGenerative);
    return () => {
      window.removeEventListener('avatar:generative:gesture', onGenerative);
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
    ) => {
      if (typeof window === 'undefined' || gesture === 'idle') return;

      // Clamp intensity to valid range
      const intens = THREE.MathUtils.clamp(intensity, 0.3, 1.0);
      const gazeHoldMs = Math.min(durationMs * 0.8, 2200);

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
          // Head: tilt to one side (like pondering), slight downward pitch
          emitHeadPose(
            (Math.random() > 0.5 ? 0.08 : -0.08) * moodMul, // random left/right tilt
            -0.06,  // slight chin-down (looking inward)
          );
          // Gaze: shifts down and slightly away (mind's eye / internal focus)
          emitGaze(-0.12, -0.18);
          // Blink: slow during thinking (cognitive load signal)
          emitBlink('slow');
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

        default:
          break;
      }
    };

    const applyGestureDetail = (detail: Record<string, unknown>) => {
      const next = normalizeGestureDetail(detail);
      const priRaw = detail?.priority;
      const pri = typeof priRaw === 'number' && Number.isFinite(priRaw) ? priRaw : 'n/a';

      // FIX 2: randomize amplitude per gesture instance (0.75–1.25×)
      gestureAmplitudeMulRef.current = next === 'idle' ? 1.0 : 0.75 + Math.random() * 0.50;

      // PHASE 3: parse gesture context and fire behavior events
      const intensity = typeof detail.intensity === 'number'
        ? THREE.MathUtils.clamp(detail.intensity, 0.3, 1.0)
        : 0.65 + Math.random() * 0.25; // default: randomised 0.65–0.90 for variety
      const mood = typeof detail.mood === 'string' ? detail.mood : 'neutral';
      const durationMs = normalizeDurationMs(detail);

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
        console.log(
          `[VRMSkeletonManager] 🎭 ${next} | intensity=${intensity.toFixed(2)} mood=${mood} amp=${gestureAmplitudeMulRef.current.toFixed(2)} (priority: ${pri})`,
        );
      }
      gestureStateRef.current = next;
      gestureStartRef.current = performance.now();
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

    const onVrmaRequest = (e: Event) => {
      if (!vrm.humanoid) return;
      const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const path =
        (typeof detail.vrmaPath === 'string' && detail.vrmaPath) ||
        (typeof detail.url === 'string' && detail.url) ||
        '';
      let stem: string | null = null;
      const fn = detail.filename;
      if (typeof fn === 'string' && /\.vrma$/i.test(fn)) {
        stem = fn.replace(/\.vrma$/i, '');
      } else if (path) {
        const m = /\/([^/]+)\.vrma(\?.*)?$/i.exec(path);
        if (m) stem = m[1];
      }
      if (!stem) return;
      const mapped = gestureIdFromVrmaStem(stem);
      if (!mapped) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[VRMSkeletonManager] avatar:vrma:request — no procedural map for stem:', stem);
        }
        return;
      }
      const showPath = path || `/models/animations/${stem}.vrma`;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[VRMSkeletonManager] 📁 Loading VRMA: ${showPath}`);
        console.log(`[VRMSkeletonManager] ✅ Playing (procedural): ${showPath}`);
      }
      gestureStateRef.current = mapped;
      gestureStartRef.current = performance.now();
      const loop = detail.loop === true;
      gestureDurationRef.current = loop ? 600_000 : normalizeDurationMs(detail);
    };

    // ── Micro gesture: tiny bone nudge from gestureScheduler/spontaneous ────────
    const MICRO_PRESETS: Record<string, Partial<typeof microNudgeRef['current']>> = {
      eyebrow:        { neckX: -0.04, headX: -0.05 },
      question_tilt:  { neckY: 0.08,  headX: 0.04 },
      chin_up:        { neckX: -0.06, headX: -0.04 },
      lean_in:        { ruaX: 0.05,   luaX: 0.04   },
      nod:            { neckX: 0.10,  headX: 0.06   },
      shrug:          { ruaZ: -0.18,  luaZ: 0.18    },
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
      if (!(kind in MICRO_PRESETS) && process.env.NODE_ENV === 'development') {
        console.warn(`[VRMSkeletonManager] micro:gesture unknown kind="${kind}" — using nod fallback`);
      }
      const preset = MICRO_PRESETS[kind] ?? MICRO_PRESETS['nod'];
      const mn = microNudgeRef.current;
      mn.ruaX  = preset?.ruaX  ?? 0;
      mn.ruaZ  = preset?.ruaZ  ?? 0;
      mn.luaX  = preset?.luaX  ?? 0;
      mn.luaZ  = preset?.luaZ  ?? 0;
      mn.neckX = preset?.neckX ?? 0;
      mn.neckY = preset?.neckY ?? 0;
      mn.headX = preset?.headX ?? 0;
      mn.blend  = 1;
      mn.untilMs = performance.now() + dur;
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
      headposeUntilMsRef.current = performance.now() + dur;
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
      mn.untilMs = performance.now() + durMs;
    };

    // ── avatar:listening — update body posture when listening to student ───────
    const onListening = (e: Event) => {
      if (!vrm.humanoid) return;
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      const active = d.active !== false; // default true
      if (active) {
        // Engaged listening: slight forward lean + head tilt via headpose
        headposeYawRef.current   = (Math.random() > 0.5 ? 1 : -1) * 0.05;
        headposePitchRef.current = -0.04; // slightly forward
        headposeBlendRef.current   = 0.7;
        headposeUntilMsRef.current = performance.now() + 4000;
      } else {
        // Stop listening posture — reset headpose
        headposeBlendRef.current   = 0;
        headposeUntilMsRef.current = 0;
      }
    };

    window.addEventListener('avatar:gesture', onGesture);
    window.addEventListener('avatar:vrma:request', onVrmaRequest);
    window.addEventListener('avatar:micro:gesture', onMicroGesture as EventListener);
    window.addEventListener('avatar:speech:emphasis', onMicroGesture as EventListener);
    window.addEventListener('avatar:headpose', onHeadPose as EventListener);
    window.addEventListener('avatar:nod', onNod as EventListener);
    window.addEventListener('avatar:listening', onListening as EventListener);
    return () => {
      window.removeEventListener('avatar:gesture', onGesture);
      window.removeEventListener('avatar:vrma:request', onVrmaRequest);
      window.removeEventListener('avatar:micro:gesture', onMicroGesture as EventListener);
      window.removeEventListener('avatar:speech:emphasis', onMicroGesture as EventListener);
      window.removeEventListener('avatar:headpose', onHeadPose as EventListener);
      window.removeEventListener('avatar:nod', onNod as EventListener);
      window.removeEventListener('avatar:listening', onListening as EventListener);
    };
  }, [vrm]);

  useFrame((state, delta) => {
    const safeDelta = Math.min(Math.max(delta, 0), TAB_SAFE_MAX_DELTA);
    const t = state.clock.elapsedTime;
    const m = bindRef.current;

    // ─── Guard: bones not yet cached (useEffect hasn't run yet, or VRM
    //     lacks humanoid). Still call vrm.update so expressions/morphs work,
    //     but skip all procedural bone manipulation to avoid null-ref spam.
    if (!ruaRef.current) {
      vrm.update(safeDelta);
      return;
    }

    const speaking = isTalkingRef.current;
    const listening = isListeningRef?.current ?? false;
    const thinking  = isThinkingRef?.current  ?? false;
    const motorMul = motorSpeedMulRef?.current ?? 1;
    const nowMs = performance.now();

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

    // ─── Thinking auto-gesture: fire 'think' only when gesture is idle ─────────
    // Policy: skeleton won't override an orchestrated gesture; only fills idle slot.
    const gestureIsIdle = gestureStateRef.current === 'idle';
    if (thinking && gestureIsIdle && !thinkGestureActiveRef.current) {
      thinkGestureActiveRef.current = true;
      gestureStateRef.current = 'think';
      gestureStartRef.current = nowMs;
      gestureAmplitudeMulRef.current = 0.75 + Math.random() * 0.50; // FIX 2
      // Vary duration 2.5–4s so it doesn't feel robotic; will loop if thinking continues
      gestureDurationRef.current = 2500 + Math.random() * 1500;
    } else if (!thinking && thinkGestureActiveRef.current) {
      thinkGestureActiveRef.current = false;
      if (gestureStateRef.current === 'think') {
        gestureStateRef.current = 'idle';
      }
    }

    // ─── Nod system: while speaking (3–7s) and while listening (5–9s, lighter) ─
    if (speaking || listening) {
      if (nextNodAtMsRef.current === 0) {
        nextNodAtMsRef.current = nowMs + (speaking ? 3000 : 5000) + Math.random() * 4000;
      }
      if (nowMs >= nextNodAtMsRef.current && nodPhaseRef.current <= 0) {
        nodPhaseRef.current = 0.001;
        const nodInterval = speaking ? (3000 + Math.random() * 4000) : (5000 + Math.random() * 4000);
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

    // ─── Co-speech volume amplifier ─────────────────────────────────────────
    let gestureAmp = 1;
    if (speaking && analyserRef?.current) {
      const vol = readAnalyserVolume(analyserRef.current, volumeBufRef);
      gestureAmp = 1 + vol * 0.7;
    }
    gestureAmp *= motorMul;

    // ─── Gesture state machine ──────────────────────────────────────────────
    // عندما يكون VRMAPlayer نشطاً يتجمّد الـ state machine عند idle لتجنّب التعارض
    const vrmaActive = vrmaActiveRef?.current ?? false;
    const elapsed = nowMs - gestureStartRef.current;
    const dur = Math.max(1, gestureDurationRef.current);
    let progress = Math.min(1, elapsed / dur);
    // إذا كان VRMA نشطاً: تجاوز أي إيماءة إجرائية نشطة (ما عدا idle)
    let g = vrmaActive ? 'idle' as GestureId : gestureStateRef.current;
    if (!vrmaActive && g !== 'idle' && progress >= 1) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Gesture] Transition to idle after duration');
      }
      gestureStateRef.current = 'idle';
      g = 'idle';
      progress = 0;
    }
    const fadeIn  = vrmaActive ? 0 : THREE.MathUtils.smoothstep(progress, 0, GESTURE_FADE_IN_END);
    const fadeOut = vrmaActive ? 0 : 1 - THREE.MathUtils.smoothstep(progress, GESTURE_FADE_OUT_START, 1);
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
    const _ampBlend = g !== 'idle' ? gBlend : 0;
    const gAmp = 1.0 + (_ampRaw - 1.0) * _ampBlend; // interpolates between 1.0 and _ampRaw

    // ── PHASE 2: GESTURE INTENT CURVE ─────────────────────────────────────────
    // Computes intentBlend + slerpMul + holdOsc from a 4-phase model.
    // intentBlend REPLACES gBlend on arm bones only (head/spine keep gBlend).
    // slerpMul is multiplied into the armK base computed by FIX-1.
    const _isIdle = g === 'idle' || vrmaActive;
    const { intentBlend: _ib, slerpMul: intentSlerpMul, holdOsc } =
      computeIntentCurve(progress, t, _isIdle);
    // Scale intentBlend by per-instance amplitude (FIX 2 interaction)
    const intentBlend = _ib * gAmp;
    // Follow-through overshoot still applies on top of intentBlend during attack/hold
    const intentArm = intentBlend * armBlendMul;

    if (typeof window !== 'undefined') {
      (window as Window & { __avatarSkeletonGesture?: GestureId }).__avatarSkeletonGesture = g;
    }
    /** agree/think/explain: تقليل ضوضاء الرأس والنظرة البروسيجرالية لتقليل الاهتزاز */
    const procHeadNoise = g === 'agree' || g === 'think' ? 0 : g === 'explain' ? 0.3 : 1;
    const procHeadGaze  = g === 'agree' ? 0.1 : (g === 'think' || g === 'explain') ? 0.28 : 1;
    const procHeadNod   = g === 'agree' || g === 'think' ? 0 : g === 'explain' ? 0.5 : 1;

    const nowCross = performance.now();
    if (g !== lastEffGestureRef.current) {
      gestureCrossfadeStartMsRef.current = nowCross;
      if (process.env.NODE_ENV === 'development') {
        if (g !== 'idle') {
          console.log('[VRMSkeletonManager] ▶ Gesture START:', g,
            '| autoUpdateHumanBones:', vrm.humanoid?.autoUpdateHumanBones);
        } else {
          console.log('[VRMSkeletonManager] ⏹ Gesture END — returning to idle');
        }
      }
      lastEffGestureRef.current = g;
    }
    const crossfadeT = Math.min(1, (nowCross - gestureCrossfadeStartMsRef.current) / GESTURE_CROSSFADE_MS);
    const crossK = THREE.MathUtils.smoothstep(crossfadeT, 0, 1);
    /** يضرب سرعة اقتفاء العظام أثناء أول ~420ms بعد تغيّر الإيماءة (min 1.0 for responsive motion) */
    const gestureSlerpScale = Math.max(1.5, 0.08 + 0.92 * crossK);

    if (g !== 'idle') {
      idleVariantNextSwitchRef.current = 0;
    }

    // ─── Breathing — rate and amplitude scale with motorMul (PAD arousal) ───
    // High arousal → faster, shallower breath. Low arousal → slow, deeper.
    const breathRate  = BREATHE_SPEED_A * (0.7 + motorMul * 0.5);   // 0.56–1.19 Hz
    const breathRateB = BREATHE_SPEED_B * (0.7 + motorMul * 0.5);
    const breathAmpMul = 0.55 * (0.8 + motorMul * 0.35);            // 0.44–0.74 scale
    const b1 = Math.sin(t * breathRate);
    const b2 = Math.sin(t * breathRateB + 0.35) * 0.32;
    const b3 = noiseBreath(t * 0.38, 2.2, 0) * 0.14;
    const breath = (b1 + b2 + b3) * breathAmpMul;
    const breatheChest =
      (Math.sin((t - CHEST_PHASE_LAG_SEC) * breathRate) +
       Math.sin((t - CHEST_PHASE_LAG_SEC) * breathRateB + 0.35) * 0.32 +
       noiseBreath((t - CHEST_PHASE_LAG_SEC) * 0.38, 2.2, 0) * 0.14) * breathAmpMul;

    // FREEZE_IDLE_ANIMATIONS: skip breathing & head sway for static pose calibration
    const breathShoulderLift = 0;
    const breathArmDrift = 0;
    if (!FREEZE_IDLE_ANIMATIONS) {
      const spineBind = m.get('spine');
      if (spineRef.current && spineBind) {
        const ax = breath * BREATHE_SPINE_AMP;
        SK_Q.setFromAxisAngle(SK_AXIS_X, ax);
        SK_Q2.copy(spineBind).multiply(SK_Q);
        spineRef.current.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * 6));
      }
      const chestBind = m.get('chest');
      if (chestRef.current && chestBind) {
        const ax = breatheChest * BREATHE_CHEST_AMP;
        SK_Q.setFromAxisAngle(SK_AXIS_X, ax);
        SK_Q2.copy(chestBind).multiply(SK_Q);
        chestRef.current.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * 5));
      }
    }

    // ─── Head / Neck noise sway ─────────────────────────────────────────────
    const nx = FREEZE_IDLE_ANIMATIONS ? 0 : noiseHead(t * HEAD_NOISE_SPEED, 0.3, 0) * HEAD_SWAY_AMP * procHeadNoise;
    const ny = FREEZE_IDLE_ANIMATIONS ? 0 : noiseHead(0.4, t * HEAD_NOISE_SPEED, 0) * HEAD_SWAY_AMP * procHeadNoise;
    const nz = FREEZE_IDLE_ANIMATIONS ? 0 : noiseHead(t * 0.41, 9.1, 0) * HEAD_SWAY_AMP * 0.35 * procHeadNoise;

    // ★ BIO: Eye saccade — micro random gaze jumps every 2–5 s ───────────────
    if (saccadeNextMsRef.current === 0) {
      saccadeNextMsRef.current = nowMs + BIO_SACCADE_IVAL_MIN + Math.random() * (BIO_SACCADE_IVAL_MAX - BIO_SACCADE_IVAL_MIN);
    }
    if (nowMs >= saccadeNextMsRef.current) {
      saccadeTgtXRef.current = (Math.random() - 0.5) * 2 * BIO_SACCADE_AMP;
      saccadeTgtYRef.current = (Math.random() - 0.5) * 2 * BIO_SACCADE_AMP * 0.7;
      saccadeNextMsRef.current = nowMs + BIO_SACCADE_IVAL_MIN + Math.random() * (BIO_SACCADE_IVAL_MAX - BIO_SACCADE_IVAL_MIN);
    }
    // Snap to target quickly, drift back to zero slowly
    saccadeXRef.current = THREE.MathUtils.lerp(saccadeXRef.current, saccadeTgtXRef.current, Math.min(1, safeDelta * BIO_SACCADE_SPEED));
    saccadeYRef.current = THREE.MathUtils.lerp(saccadeYRef.current, saccadeTgtYRef.current, Math.min(1, safeDelta * BIO_SACCADE_SPEED));
    // Slowly decay saccade target back toward center (natural gaze drift)
    saccadeTgtXRef.current = THREE.MathUtils.lerp(saccadeTgtXRef.current, 0, Math.min(1, safeDelta * BIO_SACCADE_DECAY));
    saccadeTgtYRef.current = THREE.MathUtils.lerp(saccadeTgtYRef.current, 0, Math.min(1, safeDelta * BIO_SACCADE_DECAY));

    const gYaw   = (neckGazeYawRef.current   + saccadeYRef.current) * procHeadGaze;
    const gPitch = (neckGazePitchRef.current + saccadeXRef.current) * procHeadGaze;

    // Micro nudge contribution (eyebrow raise, question tilt, nod…)
    const mnBlend = mn.blend;

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

    // ─── Listening lean: slight forward head tilt + left tilt (engaged look) ─
    const listenHeadPitch = listening ? THREE.MathUtils.lerp(0, -0.055, Math.min(1, t * 0.5)) : 0;
    const listenHeadTilt  = listening ?  0.06 : 0; // subtle right-ear forward

    // ─── Nod contribution (on top of all other rotations) ────────────────────
    const nodPitch = nodPitchRef.current;

    // headpose overlay (from avatar:headpose — gentle interest lean)
    const hpYaw   = headposeYawRef.current   * headposeBlendRef.current;
    const hpPitch = headposePitchRef.current * headposeBlendRef.current;

    const neckBind = m.get('neck');
    if (neckRef.current && neckBind) {
      const [cnx, cny, cnz] = clampNeckEuler(
        nx * NECK_SWAY_MUL + gPitch * 0.48 + thinkNkX + waveNkX + clapNkX + agreeNkX
          + listenHeadPitch * 0.55 * procHeadNod + nodPitch * 0.6 * procHeadNod
          + mn.neckX * mnBlend + hpPitch * 0.55,
        ny * NECK_SWAY_MUL + gYaw * 0.48 + thinkNkY + waveNkY + clapNkY + agreeNkY
          + mn.neckY * mnBlend + hpYaw * 0.55,
        nz * NECK_SWAY_MUL + thinkNkZ + waveNkZ + clapNkZ + agreeNkZ + listenHeadTilt * 0.55 * procHeadNod,
      );
      SK_E.set(cnx, cny, cnz, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(neckBind).multiply(SK_Q);
      neckRef.current.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * 8));
    }

    const headBind = m.get('head');
    if (headRef.current && headBind) {
      const [chx, chy, chz] = clampHeadEuler(
        nx * 1.05 + gPitch * 0.62 + thinkHdX + waveHdX + clapHdX + agreeHdX
          + listenHeadPitch * 0.45 * procHeadNod + nodPitch * procHeadNod
          + mn.headX * mnBlend + hpPitch * 0.45,
        ny * 1.05 + gYaw * 0.62 + thinkHdY + waveHdY + clapHdY + agreeHdY
          + hpYaw * 0.45,
        nz + thinkHdZ + waveHdZ + clapHdZ + agreeHdZ + listenHeadTilt * 0.45 * procHeadNod,
      );
      SK_E.set(chx, chy, chz, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(headBind).multiply(SK_Q);
      headRef.current.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * 7));
    }

    // ─── Arm slerp helpers ──────────────────────────────────────────────────
    //
    // FIX 1 + PHASE 2 INTERACTION: Variable slerp rate with intent-phase modulation.
    //
    // FIX 1 computed a base speed from the attack/decay split.
    // Now intentSlerpMul (from Intent Curve) further modulates it per phase:
    //   PREP:   base × 0.45  — slow, deliberate start
    //   ATTACK: base × 2.2   — fast, confident reach
    //   HOLD:   base × 0.65  — settle, hold with micro-motion
    //   DECAY:  base × 0.38  — very slow, organic release
    //
    // When idle, intentSlerpMul = 1 (neutral, no change).
    const _attackPhase = g !== 'idle' && progress < INTENT_ATTACK_END;
    const _baseSpeed   = _attackPhase ? 12.0 : 4.2;
    const armK    = Math.min(1, safeDelta * _baseSpeed * intentSlerpMul);
    const armKLow = Math.min(1, safeDelta * (_attackPhase ? 9.5 : 3.5) * intentSlerpMul);

    /**
     * slerpArmEuler — applies target Euler to a bone quaternion.
     * @param kMul  caller-side multiplier (1 = upper arm rate, <1 = slower for LA/wrist)
     * @param isLow true = use armKLow (forearm/wrist lag behind upper arm)
     */
    const slerpArmEuler = (
      obj: THREE.Object3D | null,
      ex: number,
      ey: number,
      ez: number,
      kMul: number,
      isLow = false,
    ) => {
      if (!obj) return;
      SK_E.set(ex, ey, ez, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      const baseK = isLow ? armKLow : armK;
      obj.quaternion.slerp(SK_Q, Math.min(1, baseK * kMul * gestureSlerpScale));
    };

    // ──── CHANGE #1: Shoulder / hip slerp helper (uses bind pose) ───────────
    const slerpBoneFromBind = (
      obj: THREE.Object3D | null,
      bindKey: string,
      ex: number,
      ey: number,
      ez: number,
      speed: number,
    ) => {
      if (!obj) return;
      const bq = m.get(bindKey);
      if (!bq) return;
      SK_E.set(ex, ey, ez, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(bq).multiply(SK_Q);
      obj.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * speed * gestureSlerpScale));
    };

    // ──── CHANGE #5: Finger slerp helper ────────────────────────────────────
    const slerpFingerCurl = (
      obj: THREE.Object3D | null,
      bindKey: string,
      curlAmount: number, // positive = curl inward (flex), negative = extend
      speed: number,
    ) => {
      if (!obj) return;
      let bq = m.get(bindKey);
      if (!bq) {
        // لم يُلتقط bind في useEffect (عظم متأخر أو خريطة ناقصة) — احفظ وضع الراحة الحالي
        bq = obj.quaternion.clone();
        m.set(bindKey, bq);
      }
      SK_E.set(curlAmount, 0, 0, 'YXZ');
      SK_Q.setFromEuler(SK_E);
      SK_Q2.copy(bq).multiply(SK_Q);
      obj.quaternion.slerp(SK_Q2, Math.min(1, safeDelta * speed * gestureSlerpScale));
    };

    const applySymmetricFingerCurl = (curl01: number, blend: number) => {
      const v = THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curl01, 0, 1)) * blend;
      slerpFingerCurl(rIndexProximalRef.current, 'rIndexProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(rRingProximalRef.current, 'rRingProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(rThumbProximalRef.current, 'rThumbProximal', v * 0.55, FINGER_SLERP_SPEED);
      slerpFingerCurl(lIndexProximalRef.current, 'lIndexProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(lRingProximalRef.current, 'lRingProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', v, FINGER_SLERP_SPEED);
      slerpFingerCurl(lThumbProximalRef.current, 'lThumbProximal', v * 0.55, FINGER_SLERP_SPEED);
    };

    const applySplitFingerCurl = (curlR01: number, curlL01: number, blend: number) => {
      const vR =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curlR01, 0, 1)) * blend;
      const vL =
        THREE.MathUtils.lerp(FINGER_OPEN_EXPLAIN, 0.65, THREE.MathUtils.clamp(curlL01, 0, 1)) * blend;
      slerpFingerCurl(rIndexProximalRef.current, 'rIndexProximal', vR, FINGER_SLERP_SPEED);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', vR, FINGER_SLERP_SPEED);
      slerpFingerCurl(rRingProximalRef.current, 'rRingProximal', vR, FINGER_SLERP_SPEED);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', vR, FINGER_SLERP_SPEED);
      slerpFingerCurl(rThumbProximalRef.current, 'rThumbProximal', vR * 0.55, FINGER_SLERP_SPEED);
      slerpFingerCurl(lIndexProximalRef.current, 'lIndexProximal', vL, FINGER_SLERP_SPEED);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', vL, FINGER_SLERP_SPEED);
      slerpFingerCurl(lRingProximalRef.current, 'lRingProximal', vL, FINGER_SLERP_SPEED);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', vL, FINGER_SLERP_SPEED);
      slerpFingerCurl(lThumbProximalRef.current, 'lThumbProximal', vL * 0.55, FINGER_SLERP_SPEED);
    };

    // ─── Talk nudge (idle only) ─────────────────────────────────────────────
    // ★ BIO: organic sine+noise mix — less robotic, non-repeating
    const talkNudge =
      speaking && g === 'idle'
        ? (Math.sin(t * TALK_NUDGE_FREQ) * BIO_ORG_SINE +
           noiseArm(t * BIO_ORG_NOISE_SPD, 2.7, 0) * BIO_ORG_NOISE) *
          TALK_NUDGE_AMP * gestureAmp
        : 0;
    const talkWrist =
      speaking && g === 'idle'
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
      slerpArmEuler(luaRef.current, (eLuaX - wave * 0.32 + antRua) * _eHold, eLuaY, (eLuaZ - wave - explainGravityZ) * _eHold, 1);
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
      const tRuaZ = cal ? cal.ruaZ : THINK_RUA_Z;
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
      slerpArmEuler(
        ruaRef.current,
        (wRuaX + micro * 1.2) * _wHold,
        cal ? cal.ruaY : WAVING_RUA_Y,
        wRuaZ * _wHold,
        1.1 * intentArm + 0.08,
      );
      slerpArmEuler(
        rlaRef.current,
        (WAVING_RLA_X + micro * 0.3) * _wHold,
        0,
        wRlaZ * _wHold,
        1 * intentArm + 0.08,
        true,
      );
      slerpArmEuler(
        rhRef.current,
        ((cal ? cal.rhX : WAVING_RH_X) + wristJitterX * 0.5) * _wHold,
        (cal?.rhY ?? WAVING_RH_Y) + micro * 0.15,
        ((cal ? cal.rhZ : WAVING_RH_Z) + wristJitterZ * 0.5) * _wHold,
        0.9 * intentArm + 0.08,
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

    } else {
      // ─── Idle: arms lowered + دوران وضعيات خفيف كل 8–12 ث ────────────────
      const nowIdle = performance.now();
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
        // ── Listening posture: arms slightly forward + raised from rest ────────
        // Same rig as gestures: small +X = forward from shoulders.
        slerpArmEuler(ruaRef.current, 0.12, 0.0, 0.9 + talkNudge, 1.2);
        slerpArmEuler(luaRef.current, 0.10, 0.0, -0.9 + talkNudge * 0.88, 1.2);
        slerpArmEuler(rlaRef.current,  0.0, 0, 0.05, 1.0);
        slerpArmEuler(llaRef.current,  0.0, 0, -0.05, 1.0);
        slerpArmEuler(rhRef.current,  0, 0, talkWrist, 0.75);
        slerpArmEuler(lhRef.current,  0, 0, -talkWrist * 0.9, 0.75);
        slerpBoneFromBind(rightShoulderRef.current, 'rightShoulder', 0.022 + breathShoulderLift, 0, 0, 5);
        slerpBoneFromBind(leftShoulderRef.current,  'leftShoulder',  0.022 + breathShoulderLift, 0, 0, 5);
        // Forward hip lean during listening
        slerpBoneFromBind(hipsRef.current, 'hips', 0, 0, 0.012, 3);
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
          IDLE_RUA_Y,   // ← was 0 — now reads ruaY for forward swing
          (ic ? ic.ruaZ : IDLE_RUA_Z) + talkNudge + idleOffsetZ + (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1,
        );
        slerpArmEuler(
          luaRef.current,
          (ic ? ic.luaX : IDLE_LUA_X) + idleOffsetX,
          IDLE_LUA_Y,   // ← was 0 — now reads luaY for forward/outward swing
          (ic ? ic.luaZ : IDLE_LUA_Z) + talkNudge * 0.88 - idleOffsetZ - (FREEZE_IDLE_ANIMATIONS ? 0 : breathArmDrift),
          1,
        );
        slerpArmEuler(rlaRef.current, ic ? ic.rlaX : IDLE_LOWER_ARM_X, 0, (ic ? ic.rlaZ : 0) + 0.02 + talkNudge * 0.35, 0.85);
        slerpArmEuler(llaRef.current, IDLE_LOWER_ARM_X, 0, -0.02 - talkNudge * 0.35, 0.85);
        // ★ BIO: wrist jitter in idle (subtle life signal)
        slerpArmEuler(rhRef.current,  wristJitterX * 0.5, 0, talkWrist + wristJitterZ * 0.5, 0.75);
        slerpArmEuler(lhRef.current,  -wristJitterX * 0.5, 0, -talkWrist * 0.9 - wristJitterZ * 0.5, 0.75);

        if (process.env.NODE_ENV === 'development' && ruaRef.current && luaRef.current) {
          const logNow = performance.now();
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
            console.log(
              `[Idle] target RUA.z=${ruaTarget.toFixed(3)} applied≈${rZ.toFixed(3)} ${ruaDown ? '✅ down tgt' : '⚠ RUA_Z tweak?'}`,
              `| LUA.z tgt=${luaTarget.toFixed(3)} applied≈${lZ.toFixed(3)} ${luaDown ? '✅ down tgt' : '⚠ LUA_Z tweak?'}`,
            );
          }
        }

        // ★ BIO: Shoulders rise with breath in idle — natural inhale coupling
        slerpBoneFromBind(rightShoulderRef.current, 'rightShoulder', breathShoulderLift, 0, 0, 4);
        slerpBoneFromBind(leftShoulderRef.current,  'leftShoulder',  breathShoulderLift, 0, 0, 4);
        slerpBoneFromBind(hipsRef.current, 'hips', 0, 0, hipTiltZIdle, 3);
      }

      // ──── CHANGE #5: Relax fingers to bind pose in idle ───────────────────
      slerpFingerCurl(rIndexProximalRef.current,  'rIndexProximal',  0, 3);
      slerpFingerCurl(rMiddleProximalRef.current, 'rMiddleProximal', 0, 3);
      slerpFingerCurl(rRingProximalRef.current,   'rRingProximal',   0, 3);
      slerpFingerCurl(rLittleProximalRef.current, 'rLittleProximal', 0, 3);
      slerpFingerCurl(rThumbProximalRef.current,  'rThumbProximal',  0, 3);
      slerpFingerCurl(lIndexProximalRef.current,  'lIndexProximal',  0, 3);
      slerpFingerCurl(lMiddleProximalRef.current, 'lMiddleProximal', 0, 3);
      slerpFingerCurl(lRingProximalRef.current,   'lRingProximal',   0, 3);
      slerpFingerCurl(lLittleProximalRef.current, 'lLittleProximal', 0, 3);
      slerpFingerCurl(lThumbProximalRef.current,  'lThumbProximal',  0, 3);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  HAND-BODY COLLISION GUARD
    //  يُنفَّذ بعد تطبيق جميع عظام الإيماءة وقبل vrm.update().
    //  يقرأ المواضع العالمية من الإطار السابق (1 frame lag = ~16 ms، غير ملحوظ).
    //  يُطبّق دوراناً تصحيحياً مباشراً على RUA/LUA دون تجاوز الـ slerp.
    // ═════════════════════════════════════════════════════════════════════════
    if (gBlend > COLLISION_MIN_GBLEND && chestRef.current && ruaRef.current && luaRef.current) {
      // نقطة مرجعية: مركز الجذع (الصدر)
      chestRef.current.getWorldPosition(_chestWorld);
      const effRadius = BODY_COLLISION_RADIUS + HAND_BODY_SAFETY_MARGIN;

      // ── اليد اليمنى (RUA) ──────────────────────────────────────────────
      if (rhRef.current) {
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
          ruaRef.current.quaternion.slerp(
            _collBaseQ,
            Math.min(1, safeDelta * COLLISION_SLERP_SPEED),
          );
          if (process.env.NODE_ENV === 'development' && rPen > 0.02) {
            console.log(`[Collision] RHand penetration=${rPen.toFixed(3)}m push=${rPush.toFixed(3)}rad`);
          }
        }
      }

      // ── اليد اليسرى (LUA) ──────────────────────────────────────────────
      if (lhRef.current) {
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
          luaRef.current.quaternion.slerp(
            _collBaseQ,
            Math.min(1, safeDelta * COLLISION_SLERP_SPEED),
          );
          if (process.env.NODE_ENV === 'development' && lPen > 0.02) {
            console.log(`[Collision] LHand penetration=${lPen.toFixed(3)}m push=${lPush.toFixed(3)}rad`);
          }
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  GENERATIVE GESTURE OVERLAY (MIBURI / RIDGE / etc.)
    // ═════════════════════════════════════════════════════════════════════════
    const genRemaining = generativeEndMsRef.current - nowMs;
    const genMix =
      genRemaining > 0
        ? generativeBlendRef.current * Math.min(1, genRemaining / 350)
        : 0;

    // الإيماءات الإجرائية (explain/think/wave/...) تتحكم بالأذرع دائماً — لا تسمح للـ generative بالتجاوز.
    const genArmAllowed = g === 'idle';

    if (genMix > 0.02) {
      const gb = generativeBonesRef.current;
      const slerpGen = (key: string, obj: THREE.Object3D | null) => {
        const rot = gb.get(key);
        if (!rot || !obj) return;
        GEN_E.set(rot.x, rot.y, rot.z, 'YXZ');
        GEN_Q.setFromEuler(GEN_E);
        obj.quaternion.slerp(GEN_Q, Math.min(1, safeDelta * 12 * genMix));
      };
      if (genArmAllowed) {
        slerpGen('rua',  ruaRef.current);
        slerpGen('lua',  luaRef.current);
        slerpGen('rla',  rlaRef.current);
        slerpGen('lla',  llaRef.current);
        slerpGen('rh',   rhRef.current);
        slerpGen('lh',   lhRef.current);
      }
      slerpGen('neck', neckRef.current);
      slerpGen('head', headRef.current);
      slerpGen('spine', spineRef.current);
      slerpGen('chest', chestRef.current);
      // ──── CHANGE #1: Generative gestures can also drive shoulders and hips ─
      slerpGen('hips',          hipsRef.current);
      slerpGen('leftShoulder',  leftShoulderRef.current);
      slerpGen('rightShoulder', rightShoulderRef.current);
    }

    // ─── vrm.update() ────────────────────────────────────────────────────────
    // عند vrmaActive: VRMAPlayer (priority 5) سيستدعي vrm.update() بعدنا بعظام VRMA الصحيحة.
    // نستدعيه هنا دائماً لضمان تحديث expressions (blink, lip-sync) التي يكتبها
    // AnimationController(-2) وLipSyncManager(-1) في نفس الإطار.
    vrm.update(safeDelta);
  }, 0);

  return null;
}