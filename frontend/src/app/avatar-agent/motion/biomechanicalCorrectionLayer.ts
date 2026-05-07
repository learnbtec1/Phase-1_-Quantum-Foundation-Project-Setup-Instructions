'use client';
/**
 * Biomechanical Correction Layer
 * Fixes: arm flapping (elbow flexion), neck rigidity (head/neck split),
 * shoulder shrug (breath-coupled), and hand relaxation.
 *
 * All keys use PoseComposer short aliases confirmed from PoseComposer.ts:
 *   lua=leftUpperArm, rua=rightUpperArm, lla=leftLowerArm, rla=rightLowerArm
 *   lh=leftHand, rh=rightHand, leftShoulder, rightShoulder, neck, head
 */

import * as THREE from 'three';
import type { BonePoseMap } from './PoseComposer';
import { isPoseKeyProcedurallySuppressed } from './proceduralSuppressionContext';
import { isDebugMotion } from '@/lib/logging/runtimeLog';
import { diagnosticsBiomechEnter } from '@/lib/diagnostics/diagnosticsBiomech';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _eulerRead = new THREE.Euler(0, 0, 0, 'YXZ');
const _qRead = new THREE.Quaternion();

// ═══════════════════════════════════════════════════════════════════════════════
//  SWING-TWIST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
//  A rotation can be decomposed into two parts:
//    Swing  — the component that moves the bone perpendicular to the twist axis
//             (lifting / lowering the arm, pointing forward/sideways).
//    Twist  — the component that spins the bone around its own length axis
//             (forearm supination / pronation — generally not what we want when
//             driving "openGesture" or intent motion).
//
//  Applying only the Swing component eliminates the twisting artefact that
//  causes arm collapse, V-pose, and unnatural bone distortion.
//
//  Twist axis convention (VRM 1.0 normalized humanoid):
//    Upper arm  → local +X  (shoulder → elbow direction)
//    Lower arm  → local +X  (elbow → wrist direction)
//    Default    → local +X
//
//  All scratch objects are module-scope to avoid per-frame GC.

// Scratch — used only inside swingTwistDecompose, never held across calls.
const _ST_R    = new THREE.Vector3();
const _ST_PROJ = new THREE.Vector3();
const _ST_TWIST_Q = new THREE.Quaternion();
const _ST_SWING_Q = new THREE.Quaternion();
const _ST_INV     = new THREE.Quaternion();

/**
 * Decompose quaternion `q` into Swing and Twist around `twistAxis`.
 *
 * Returns new quaternion objects (does not mutate `q`).
 * The relationship holds: q = swing * twist.
 *
 * Algorithm (Dobrowolski 2012):
 *   r    = vector part of q
 *   proj = project r onto twistAxis
 *   twist = normalize( Quaternion(proj, q.w) )
 *   swing = q * twist⁻¹
 */
export function swingTwistDecompose(
  q: THREE.Quaternion,
  twistAxis: THREE.Vector3,
): { swing: THREE.Quaternion; twist: THREE.Quaternion } {
  _ST_R.set(q.x, q.y, q.z);

  // Project vector part onto twist axis.
  _ST_PROJ.copy(twistAxis).multiplyScalar(_ST_R.dot(twistAxis));

  // Build and normalise twist quaternion.
  _ST_TWIST_Q.set(_ST_PROJ.x, _ST_PROJ.y, _ST_PROJ.z, q.w);
  const twistLen = Math.sqrt(
    _ST_TWIST_Q.x * _ST_TWIST_Q.x +
    _ST_TWIST_Q.y * _ST_TWIST_Q.y +
    _ST_TWIST_Q.z * _ST_TWIST_Q.z +
    _ST_TWIST_Q.w * _ST_TWIST_Q.w,
  );
  if (twistLen > 1e-10) {
    _ST_TWIST_Q.x /= twistLen;
    _ST_TWIST_Q.y /= twistLen;
    _ST_TWIST_Q.z /= twistLen;
    _ST_TWIST_Q.w /= twistLen;
  } else {
    // Quaternion is near identity — twist is identity.
    _ST_TWIST_Q.set(0, 0, 0, 1);
  }

  // Swing = q * twist⁻¹.
  _ST_INV.copy(_ST_TWIST_Q).invert();
  _ST_SWING_Q.copy(q).multiply(_ST_INV);

  return {
    swing: _ST_SWING_Q.clone(),
    twist: _ST_TWIST_Q.clone(),
  };
}

/**
 * Canonical twist (bone-length) axes per BONE_AXIS_MAP key.
 * Upper / lower arms use local +X (shoulder→elbow / elbow→wrist).
 */
const BONE_TWIST_AXES: Record<string, THREE.Vector3> = {
  lua:           new THREE.Vector3(1, 0, 0),
  rua:           new THREE.Vector3(1, 0, 0),
  lla:           new THREE.Vector3(1, 0, 0),
  rla:           new THREE.Vector3(1, 0, 0),
  lh:            new THREE.Vector3(1, 0, 0),
  rh:            new THREE.Vector3(1, 0, 0),
  leftShoulder:  new THREE.Vector3(1, 0, 0),
  rightShoulder: new THREE.Vector3(1, 0, 0),
};

/** Default fallback twist axis when the bone key has no explicit entry. */
const _DEFAULT_TWIST_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Multiply-onto-pose using swing-only rotation for arm/shoulder bones.
 * Identical API to the internal `mulBone` but strips twist before writing.
 *
 * The delta rotation is applied, then the combined quaternion is decomposed
 * and only the swing component is written back, preventing axial spin.
 */
function mulBoneSwingOnly(
  pose: BonePoseMap,
  key: string,
  rx: number,
  ry: number,
  rz: number,
): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = pose.get(key);
  if (!q) { warnMissing(key); return; }

  // Build delta, combine.
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);

  // Decompose and keep only swing.
  const twistAxis = BONE_TWIST_AXES[key] ?? _DEFAULT_TWIST_AXIS;
  const { swing } = swingTwistDecompose(_qOut, twistAxis);
  pose.set(key, swing);
}

/**
 * Apply a swing-only absolute rotation to a live VRM bone node.
 * Replaces `bone.quaternion.setFromEuler(e)` with twist-free equivalent.
 *
 * @param bone       Normalized VRM bone node.
 * @param euler      Target rotation as Euler (absolute, not delta).
 * @param boneKey    Key into BONE_TWIST_AXES ('lua' | 'rua' etc.)
 */
export function applySwingOnlyRotation(
  bone: THREE.Object3D,
  euler: THREE.Euler,
  boneKey = '',
): void {
  _qOut.setFromEuler(euler);
  const twistAxis = BONE_TWIST_AXES[boneKey] ?? _DEFAULT_TWIST_AXIS;
  const { swing } = swingTwistDecompose(_qOut, twistAxis);
  bone.quaternion.copy(swing);
}

// ─── Dev-only missing key warning (silenced in production) ────────────────────
const _warnedKeys = new Set<string>();
function warnMissing(key: string): void {
  if (_warnedKeys.has(key)) return;
  _warnedKeys.add(key);
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  console.warn(`[BONE_KEY_MISS] biomechanicalCorrectionLayer: "${key}" not in finalPose`);
}

function mulBone(pose: BonePoseMap, key: string, rx: number, ry: number, rz: number): void {
  if (isPoseKeyProcedurallySuppressed(key)) return;
  const q = pose.get(key);
  if (!q) { warnMissing(key); return; }
  _e.set(rx, ry, rz, 'YXZ');
  _qDelta.setFromEuler(_e);
  _qOut.copy(q).multiply(_qDelta);
  pose.set(key, _qOut.clone());
}

function readBonePitch(pose: BonePoseMap, key: string): number {
  const q = pose.get(key);
  if (!q) return 0;
  _qRead.copy(q);
  _eulerRead.setFromQuaternion(_qRead, 'YXZ');
  return _eulerRead.x;
}

// ─── 1. Elbow flexion: couples lla/rla pitch to upper arm elevation ───────────
export function applyElbowFlexion(pose: BonePoseMap): void {
  const luaPitch = readBonePitch(pose, 'lua');
  const ruaPitch = readBonePitch(pose, 'rua');
  const K = 0.55;
  const MIN_FLEX = 0.08;
  const MAX_FLEX = 0.90;
  const lFlex = THREE.MathUtils.clamp(Math.abs(luaPitch) * K + MIN_FLEX, MIN_FLEX, MAX_FLEX);
  const rFlex = THREE.MathUtils.clamp(Math.abs(ruaPitch) * K + MIN_FLEX, MIN_FLEX, MAX_FLEX);
  mulBone(pose, 'lla',  0,  lFlex, 0);
  mulBone(pose, 'rla',  0, -rFlex, 0);
}

// ─── 2. Shoulder shrug: breath + speaking coupled lift ────────────────────────
export function applyShoulderShrug(
  pose: BonePoseMap,
  tSec: number,
  breathAmp01: number,
  speaking: boolean,
): void {
  const base     = Math.sin(tSec * 1.1) * 0.004;
  const breath   = breathAmp01 * 0.006;
  const speakAdd = speaking ? 0.008 : 0;
  const shrug    = base + breath + speakAdd;
  mulBone(pose, 'leftShoulder',  0,  shrug, 0);
  mulBone(pose, 'rightShoulder', 0, -shrug, 0);
}

// ─── 3. Neck lead: redistribute 30% of head-layer output onto neck ────────────
export function applyNeckLead(pose: BonePoseMap, headDeltaRad: THREE.Vector3): void {
  const share = 0.30;
  mulBone(pose, 'neck',  headDeltaRad.x * share,  headDeltaRad.y * share,  headDeltaRad.z * share);
  mulBone(pose, 'head', -headDeltaRad.x * share * 0.18, -headDeltaRad.y * share * 0.18, 0);
}

// ─── Convenience: run all three corrections in one call ───────────────────────
export function applyBiomechanicalCorrections(
  pose: BonePoseMap,
  tSec: number,
  breathAmp01: number,
  speaking: boolean,
): void {
  applyShoulderShrug(pose, tSec, breathAmp01, speaking);
  applyElbowFlexion(pose);
}

// ─── Neural motion layer (subtle, memory-backed, cross-joint coupled) ────────
//
// Adds a continuous low-amplitude modulation with inertia + drift + attention
// pulses + cross-joint coupling. Stays gated behind timing weight / speaking to
// avoid wasted work and amplitude-stacking when the avatar is truly idle.

const _neural = {
  head: 0,
  arm:  0,
  spine: 0,
  lastAttentionMs:    0,
  attentionUntilMs:   0,
  nextAttentionCheck: 0,
  lastDebugMs:        0,
  frameCount:         0,
};

function neuralNoise(t: number): number {
  return (
    Math.sin(t * 0.7) * 0.5 +
    Math.sin(t * 1.3) * 0.3 +
    Math.sin(t * 2.1) * 0.2
  );
}

const NEURAL_CLAMP = 0.05;
function _clampDelta(v: number): number {
  return Math.max(-NEURAL_CLAMP, Math.min(NEURAL_CLAMP, v));
}

export function applyNeuralLayer(
  pose: BonePoseMap,
  timeSec: number,
  speaking: boolean,
  timingWeight: number,
): void {
  // Gate: only active when gesture or speaking (cheap early-out otherwise)
  if (timingWeight < 0.1 && !speaking) return;

  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n     = neuralNoise(timeSec);
  const nSlow = neuralNoise(timeSec * 0.5);
  const drift = Math.sin(timeSec * 0.2) * 0.02;

  // ── Attention pulses — 2–4 s interval, 300 ms decay ──────────────────
  if (nowMs >= _neural.nextAttentionCheck) {
    _neural.nextAttentionCheck = nowMs + 500;
    if (nowMs - _neural.lastAttentionMs > 2000 + Math.random() * 2000) {
      _neural.lastAttentionMs  = nowMs;
      _neural.attentionUntilMs = nowMs + 300;
    }
  }
  const attentionFactor =
    nowMs < _neural.attentionUntilMs
      ? Math.max(0, 1 - (nowMs - _neural.lastAttentionMs) / 300)
      : 0;

  // ── Target deltas (micro-modulation) ─────────────────────────────────
  const targetHead  = n * 0.010 + attentionFactor * 0.05;
  const targetHt    = n * 0.008;
  const targetArm   = n * 0.015;
  const targetSpine = n * 0.010;

  // ── Inertial lerp toward target (memory state) ───────────────────────
  _neural.head  = _neural.head  + (targetHead  - _neural.head)  * 0.08;
  _neural.arm   = _neural.arm   + (targetArm   - _neural.arm)   * 0.08;
  _neural.spine = _neural.spine + (targetSpine - _neural.spine) * 0.08;

  // Stability clamp — never exceed ±0.05 rad per axis
  const hn = _clampDelta(_neural.head);
  const ht = _clampDelta(targetHt);
  const og = _clampDelta(_neural.arm);
  const sp = _clampDelta(_neural.spine);

  // ── Anti-symmetry: right arm slightly smaller + noisy drift ──────────
  const rightAsym = 0.92 + nSlow * 0.05;

  // ── Apply: head (nod/tilt + slow Y drift) ────────────────────────────
  mulBone(pose, 'head', hn, drift, ht);
  mulBone(pose, 'neck', hn * 0.3, drift * 0.4, ht * 0.3);

  // Spine + chest (cross-joint coupling)
  mulBone(pose, 'spine', sp, drift * 0.5, 0);
  mulBone(pose, 'chest', hn * 0.2, 0, 0);   // chest couples to head nod
  mulBone(pose, 'hips',  0, sp * 0.2, 0);   // hips couple to spine

  // Shoulders (coupled to arm)
  mulBone(pose, 'leftShoulder',  0, 0,  og * 0.15);
  mulBone(pose, 'rightShoulder', 0, 0, -og * 0.15 * rightAsym);

  // Arms
  mulBone(pose, 'lua', 0, 0,  og);
  mulBone(pose, 'rua', 0, 0, -og * rightAsym);

  // Final clamps (anatomical safety)
  clampBoneAxis(pose, 'head',  CLAMP_HEAD);
  clampBoneAxis(pose, 'neck',  CLAMP_HEAD);
  clampBoneAxis(pose, 'spine', 0.25);
  clampBoneAxis(pose, 'chest', 0.25);
  clampBoneAxis(pose, 'hips',  0.15);
  clampBoneAxis(pose, 'lua',   CLAMP_ARM);
  clampBoneAxis(pose, 'rua',   CLAMP_ARM);
  clampUpperArmAntiVPose(pose, 'lua');
  clampUpperArmAntiVPose(pose, 'rua');

  _neural.frameCount += 1;
  // Throttled debug — max ~1/s AND max ~1 per 60 frames at high FPS (no console flood).
  if (
    isDebugMotion() &&
    _neural.frameCount % 60 === 0 &&
    nowMs - _neural.lastDebugMs > 1000
  ) {
    _neural.lastDebugMs = nowMs;
    console.log('[NEURAL_LAYER]', {
      noise:  Number(n.toFixed(4)),
      head:   Number(hn.toFixed(4)),
      arm:    Number(og.toFixed(4)),
      spine:  Number(sp.toFixed(4)),
      drift:  Number(drift.toFixed(4)),
      attention: Number(attentionFactor.toFixed(3)),
      asym:   Number(rightAsym.toFixed(3)),
    });
  }
}

// ─── Subconscious motion layer — continuous, very-low-amplitude body life ───
//
// Runs every frame (gated down under strong intent). Produces breathing, micro
// balance, attention drift, pre-gesture anticipation, post-gesture relaxation,
// micro hand life, and eye saccades. All deltas clamped to ±0.03 rad.

const _sub = {
  nextAttentionMs:    0,
  attentionDriftYaw:  0,
  attentionTargetYaw: 0,
  attentionUntilMs:   0,
  prevTimingWeight:   0,
  postRelaxActive:    false,
  postRelaxUntilMs:   0,
  nextSaccadeMs:      0,
  saccadeOffset:      0,
  saccadeTarget:      0,
  fingerMicroPhase:   0,
  lastDebugMs:        0,
  frameCount:         0,
};

const SUB_CLAMP = 0.03;
function _subClamp(v: number): number {
  return Math.max(-SUB_CLAMP, Math.min(SUB_CLAMP, v));
}

export function applySubconsciousLayer(
  pose: BonePoseMap,
  timeSec: number,
  timingWeight: number,
  speaking: boolean,
): void {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const w = Math.max(0, Math.min(1, timingWeight));

  // Intent-gating: scale subconscious down when a strong gesture is active.
  const gate = 1 - w * 0.8;

  // ── 1. Breathing (always-on) ─────────────────────────────────────────
  const breath = Math.sin(timeSec * 1.2) * 0.02 * gate;
  mulBone(pose, 'chest',         _subClamp(breath),               0, 0);
  mulBone(pose, 'spine',         _subClamp(breath * 0.6),          0, 0);
  mulBone(pose, 'leftShoulder',  0, _subClamp(Math.abs(breath) * 0.4), 0);
  mulBone(pose, 'rightShoulder', 0, _subClamp(Math.abs(breath) * 0.4), 0);

  // ── 2. Micro balance (never perfectly stable) ────────────────────────
  const sway = Math.sin(timeSec * 0.6) * 0.01 * gate;
  mulBone(pose, 'hips',  0, _subClamp(sway),       0);
  mulBone(pose, 'spine', 0, _subClamp(sway * 0.5), 0);

  // ── 3. Attention drift (every 1–3 s new yaw target, slow return) ─────
  if (nowMs >= _sub.nextAttentionMs) {
    _sub.nextAttentionMs    = nowMs + 1000 + Math.random() * 2000;
    _sub.attentionTargetYaw = (Math.random() - 0.5) * 0.04; // ±0.02 rad
    _sub.attentionUntilMs   = nowMs + 600;
  }
  // Lerp toward target, then back to 0 after hold
  if (nowMs < _sub.attentionUntilMs) {
    _sub.attentionDriftYaw += (_sub.attentionTargetYaw - _sub.attentionDriftYaw) * 0.08;
  } else {
    _sub.attentionDriftYaw += (0 - _sub.attentionDriftYaw) * 0.04;
  }
  mulBone(pose, 'head', 0, _subClamp(_sub.attentionDriftYaw * gate), 0);

  // ── 4. Pre-gesture impulse (w rising between 0.05 and 0.20) ──────────
  const rising = w > _sub.prevTimingWeight;
  if (rising && w > 0.05 && w < 0.20) {
    mulBone(pose, 'leftShoulder',  0, 0,  _subClamp( 0.03));
    mulBone(pose, 'rightShoulder', 0, 0, _subClamp(-0.03));
    mulBone(pose, 'head',          _subClamp(-0.02), 0, 0);
  }

  // ── 5. Post-gesture relax (timingWeight just dropped below 0.10) ─────
  const falling = w < _sub.prevTimingWeight;
  if (falling && w < 0.10 && _sub.prevTimingWeight >= 0.10) {
    _sub.postRelaxActive  = true;
    _sub.postRelaxUntilMs = nowMs + 400;
  }
  if (_sub.postRelaxActive) {
    // Apply a gentle decay multiplier on arms + spine (additive negative delta
    // nudges their Euler back toward 0 each frame).
    const dampStep = -0.002;
    mulBone(pose, 'lua',   0, 0, dampStep);
    mulBone(pose, 'rua',   0, 0, -dampStep);
    mulBone(pose, 'spine', dampStep, 0, 0);
    if (nowMs > _sub.postRelaxUntilMs) _sub.postRelaxActive = false;
  }

  // ── 6. Micro hand life — only when NOT gesturing (og path silent) ────
  if (w < 0.05 && !speaking) {
    _sub.fingerMicroPhase += 0.015;
    const fingerLife = neuralNoise(timeSec * 0.8) * 0.02;
    const FINGER_PROXIMALS = [
      'lIndexProximal',  'lMiddleProximal', 'lRingProximal', 'lLittleProximal',
      'rIndexProximal',  'rMiddleProximal', 'rRingProximal', 'rLittleProximal',
    ];
    for (const k of FINGER_PROXIMALS) {
      mulBone(pose, k, _subClamp(fingerLife), 0, 0);
    }
  }

  // ── 7. Eye micro-saccades (every 0.5–1.5 s, ±0.01 rad head.y nudge) ──
  if (nowMs >= _sub.nextSaccadeMs) {
    _sub.nextSaccadeMs = nowMs + 500 + Math.random() * 1000;
    _sub.saccadeTarget = (Math.random() - 0.5) * 0.02;
  }
  _sub.saccadeOffset += (_sub.saccadeTarget - _sub.saccadeOffset) * 0.12;
  // Apply a whisper of saccade to the neck (so it differs from head attention drift)
  mulBone(pose, 'neck', 0, _subClamp(_sub.saccadeOffset * gate * 0.5), 0);

  // Clamp bones we wrote (anatomical safety)
  clampBoneAxis(pose, 'head',  CLAMP_HEAD);
  clampBoneAxis(pose, 'neck',  CLAMP_HEAD);
  clampBoneAxis(pose, 'chest', 0.25);
  clampBoneAxis(pose, 'spine', 0.25);
  clampBoneAxis(pose, 'hips',  0.15);
  clampBoneAxis(pose, 'leftShoulder',  0.30);
  clampBoneAxis(pose, 'rightShoulder', 0.30);

  _sub.prevTimingWeight = w;

  _sub.frameCount += 1;
  // Throttled debug — max ~1/s AND max ~1 per 60 frames (guards against console spam).
  if (
    isDebugMotion() &&
    _sub.frameCount % 60 === 0 &&
    nowMs - _sub.lastDebugMs > 1000
  ) {
    _sub.lastDebugMs = nowMs;
    console.log('[SUBCONSCIOUS]', {
      breath:    Number(breath.toFixed(4)),
      sway:      Number(sway.toFixed(4)),
      attentionYaw: Number(_sub.attentionDriftYaw.toFixed(4)),
      saccade:   Number(_sub.saccadeOffset.toFixed(4)),
      postRelax: _sub.postRelaxActive,
      gate:      Number(gate.toFixed(3)),
    });
  }
}

// ─── Intent motionState → bone writes (connects globalThis.__cogniMotionState) ─
export type IntentMotionState = {
  headNod?: number;
  headTilt?: number;
  headTurn?: number;
  openGesture?: number;
};

/**
 * Writes the intent-derived motionState onto finalPose bones,
 * scaled by the gesture timing weight (0..1).
 *
 * HEAD: head.rotation.x += headNod · w   ; head.rotation.z += headTilt · w
 * ARMS: lua.rotation.z += 0.25·openGesture·w ; rua.rotation.z -= 0.25·openGesture·w
 * ELBOWS: lla.rotation.z -= 0.15·openGesture·w ; rla.rotation.z += 0.15·openGesture·w
 */
// ─── Anatomical clamps (rad) ──────────────────────────────────────────────────
const CLAMP_HEAD = 0.35;   // ≈ 20° — prevent neck snapping
const CLAMP_ARM  = 0.70;   // ≈ 40° — safe shoulder/elbow range

// ─── VRM Axis / Sign / Offset Calibration Map ────────────────────────────────
//
// Per-bone:
//   axis: which local Euler component (x/y/z) produces the intended motion
//   sign: +1 or −1 to route positive logic values to the correct direction
//
// Defaults follow VRM-1.0 normalized humanoid conventions. Override via
// `setBoneAxisMap()` at runtime if the actual model uses a different convention
// (detected via the [AXIS_MAP] runtime log in VRMSkeletonManager).

export type AxisKey = 'x' | 'y' | 'z';
export type BoneAxis = { axis: AxisKey; sign: 1 | -1 };

export const BONE_AXIS_MAP: Record<string, { open: BoneAxis; twist?: BoneAxis }> = {
  // Upper arms — Z axis is canonical abduction for VRM normalized bones.
  // Left  arm: +Z rotation lifts outward (away from body → avatar right).
  // Right arm: −Z rotation lifts outward (away from body → avatar left).
  lua:           { open: { axis: 'z', sign:  1 } },
  rua:           { open: { axis: 'z', sign: -1 } },
  // Lower arms — elbow flex. Many VRM models use Y as the hinge axis on the
  // normalized bone; others use Z. Z is assumed here (matches existing code).
  lla:           { open: { axis: 'z', sign: -1 } },
  rla:           { open: { axis: 'z', sign:  1 } },
  // Hands — wrist X = flex, Z = twist.
  lh:            { open: { axis: 'x', sign:  1 }, twist: { axis: 'z', sign:  1 } },
  rh:            { open: { axis: 'x', sign: -1 }, twist: { axis: 'z', sign: -1 } },
  // Shoulders — Z = clavicle roll up/down, Y = shrug.
  leftShoulder:  { open: { axis: 'z', sign:  1 }, twist: { axis: 'y', sign:  1 } },
  rightShoulder: { open: { axis: 'z', sign: -1 }, twist: { axis: 'y', sign:  1 } },
};

/** Override at runtime (e.g. from the AXIS_MAP log) — merges shallow. */
export function setBoneAxisMap(override: Partial<typeof BONE_AXIS_MAP>): void {
  for (const [k, v] of Object.entries(override)) {
    if (v) BONE_AXIS_MAP[k] = { ...BONE_AXIS_MAP[k], ...v };
  }
  if (isDebugMotion()) {
    console.log('[AXIS_MAP_OVERRIDE]', BONE_AXIS_MAP);
  }
}

// ─── Arm Axis Detector ────────────────────────────────────────────────────────
//
// Probes each local Euler axis (X, Y, Z) by temporarily applying a test rotation
// and measuring where the bone's children end up in world space vs the baseline.
// The axis whose positive rotation raises the averaged child centroid most in
// world Y is the "lift axis".
//
// Safety rules:
//   • Original quaternion is always restored (try/finally).
//   • Only reads world positions — no bones modified permanently.
//   • Never runs per-frame — call on VRM load only.
//
// Returns a full `ArmAxisResult` per bone, and optionally patches `BONE_AXIS_MAP`
// and writes through to `localStorage` for persistence across reloads.

const _DA_TEST_ANGLE   = 0.35;  // rad — enough signal, small enough to be invisible
/** Base key — model-specific suffix appended by helpers. Do NOT use directly. */
const _AXIS_MAP_BASE_KEY = 'cogni_arm_axis_map_v1';

const _DA_Q_SAVE  = new THREE.Quaternion();
const _DA_Q_TEST  = new THREE.Quaternion();
const _DA_E_PROBE = new THREE.Euler(0, 0, 0, 'XYZ');
const _DA_W_TEST  = new THREE.Vector3();

export type ArmAxisResult = {
  boneName:    string;
  liftAxis:    AxisKey;
  liftSign:    1 | -1;
  /** Raw world-Y deltas per axis (before twist penalty). */
  rawScores:   Record<AxisKey, number>;
  /** Twist amounts per axis (0 = stable, 1 = full collapse). */
  twistScores: Record<AxisKey, number>;
  /** Final composite scores: deltaY − (twist × 0.5); −Infinity when twist > 0.6. */
  finalScores: Record<AxisKey, number>;
  confidence:  number;                 // winning finalScore magnitude; < 0.05 = suspect rig
  childCount:  number;                 // number of children averaged (1 = synthetic)
  rejected:    AxisKey[];              // axes discarded due to twist > 0.6
};

export type BothArmsResult = {
  lua:       ArmAxisResult | null;
  rua:       ArmAxisResult | null;
  fromCache: boolean;
};

// ── Axis map storage helpers ──────────────────────────────────────────────────

type StoredAxisMap = {
  lua?: { axis: AxisKey; sign: 1 | -1 };
  rua?: { axis: AxisKey; sign: 1 | -1 };
};

/** STEP 6 — Resolve model-specific storage key (matches getFwdCorrectionKey convention). */
function _axisStorageKey(modelKey?: string): string {
  if (!modelKey) return _AXIS_MAP_BASE_KEY + '_default';
  return _AXIS_MAP_BASE_KEY + '_' + modelKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

/**
 * Try to load a previously saved arm-axis map from `localStorage` and apply it
 * to `BONE_AXIS_MAP`. Returns the parsed object on success, `null` on miss/error.
 * Safe in SSR (guards on `window`).
 *
 * @param modelKey  vrm.meta?.title or uuid — scopes the key (STEP 6)
 */
export function loadAxisMapFromStorage(modelKey?: string): StoredAxisMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(_axisStorageKey(modelKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAxisMap;

    let applied = 0;
    if (parsed.lua && parsed.lua.axis && typeof parsed.lua.sign === 'number') {
      BONE_AXIS_MAP['lua'] = { ...BONE_AXIS_MAP['lua'], open: parsed.lua };
      applied++;
    }
    if (parsed.rua && parsed.rua.axis && typeof parsed.rua.sign === 'number') {
      BONE_AXIS_MAP['rua'] = { ...BONE_AXIS_MAP['rua'], open: parsed.rua };
      applied++;
    }

    if (applied > 0) {
      if (isDebugMotion()) {
        console.log('[ARM_AXIS_LOADED_FROM_CACHE]', { ...parsed, modelKey: modelKey ?? 'default' });
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function _saveAxisMapToStorage(
  lua: ArmAxisResult | null,
  rua: ArmAxisResult | null,
  modelKey?: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredAxisMap = {};
    if (lua) payload.lua = { axis: lua.liftAxis, sign: lua.liftSign };
    if (rua) payload.rua = { axis: rua.liftAxis, sign: rua.liftSign };
    localStorage.setItem(_axisStorageKey(modelKey), JSON.stringify(payload));
    if (isDebugMotion()) {
      console.log('[ARM_AXIS_SAVED_TO_CACHE]', { ...payload, modelKey: modelKey ?? 'default' });
    }
  } catch { /* storage unavailable */ }
}

// Scratch vectors for the twist-penalty calculation (module-scope, zero GC).
const _DA_BONE_WORLD = new THREE.Vector3();
const _DA_DIR_BEFORE = new THREE.Vector3();
const _DA_DIR_AFTER  = new THREE.Vector3();

/** Twist-penalty threshold: axes that collapse geometry are fully rejected. */
const _DA_TWIST_REJECT = 0.6;
/** Weight applied to twist amount when computing final composite score. */
const _DA_TWIST_WEIGHT = 0.5;

/**
 * Axis Detection v2 — anatomically correct selection.
 *
 * For each local Euler axis (X, Y, Z) the function:
 *   1. Records the bone's world position and the child→bone direction vector.
 *   2. Applies a test rotation on that axis.
 *   3. Measures:
 *        deltaY     = vertical lift of the child centroid
 *        twist      = 1 − dot(dirBefore, dirAfter) — how much the arm
 *                     direction spun rather than simply rising
 *   4. Scores the axis: score = deltaY − (twist × 0.5)
 *   5. Rejects the axis entirely if twist > 0.6 (geometry collapse).
 *
 * This prevents selecting a twist-dominant axis even when it happens to
 * produce a large Y-delta on a misaligned rig.
 *
 * Uses up to 2 child bones averaged for probe accuracy.
 * Falls back to a synthetic +0.3 m local-X point when the bone has no children.
 *
 * Never runs per-frame — call on VRM load only.
 */
export function detectArmAxis(
  bone: THREE.Object3D,
  boneName = '',
): ArmAxisResult {
  const probeChildren = bone.children.slice(0, 2);
  const childCount = probeChildren.length || 1; // 1 = synthetic point

  bone.updateWorldMatrix(true, true);

  /** Average world position across probe children (or synthetic +0.3 m local-X). */
  const getProbeWorld = (): THREE.Vector3 => {
    bone.updateWorldMatrix(true, true);
    if (probeChildren.length > 0) {
      const acc = new THREE.Vector3();
      for (const c of probeChildren) acc.add(c.getWorldPosition(new THREE.Vector3()));
      return acc.divideScalar(probeChildren.length);
    }
    return new THREE.Vector3(0.3, 0, 0).applyMatrix4(bone.matrixWorld);
  };

  // Baseline: bone world position + child world position at rest.
  bone.getWorldPosition(_DA_BONE_WORLD);
  const baseChildWorld = getProbeWorld();

  // Direction from bone to child at rest — used to measure twist.
  _DA_DIR_BEFORE.copy(baseChildWorld).sub(_DA_BONE_WORLD);
  const baseLen = _DA_DIR_BEFORE.length();
  if (baseLen > 1e-6) _DA_DIR_BEFORE.divideScalar(baseLen);

  _DA_Q_SAVE.copy(bone.quaternion);

  const rawScores:   Record<AxisKey, number> = { x: 0, y: 0, z: 0 };
  const twistScores: Record<AxisKey, number> = { x: 0, y: 0, z: 0 };
  const finalScores: Record<AxisKey, number> = { x: 0, y: 0, z: 0 };
  const rejected: AxisKey[] = [];

  try {
    for (const axis of ['x', 'y', 'z'] as AxisKey[]) {
      // Apply single-axis test rotation.
      _DA_E_PROBE.set(0, 0, 0, 'XYZ');
      _DA_E_PROBE[axis] = _DA_TEST_ANGLE;
      _DA_Q_TEST.setFromEuler(_DA_E_PROBE);
      bone.quaternion.copy(_DA_Q_TEST);
      bone.updateWorldMatrix(true, true);

      const afterChildWorld = getProbeWorld();
      _DA_W_TEST.copy(afterChildWorld);

      // Raw metric: how much did the child rise in world Y?
      const deltaY = _DA_W_TEST.y - baseChildWorld.y;
      rawScores[axis] = deltaY;

      // Twist metric: how much did the bone→child direction change?
      _DA_DIR_AFTER.copy(afterChildWorld).sub(_DA_BONE_WORLD);
      const afterLen = _DA_DIR_AFTER.length();
      if (afterLen > 1e-6) _DA_DIR_AFTER.divideScalar(afterLen);
      const twist = 1 - _DA_DIR_BEFORE.dot(_DA_DIR_AFTER);
      twistScores[axis] = twist;

      // Reject axes that cause geometric collapse.
      if (twist > _DA_TWIST_REJECT) {
        finalScores[axis] = -Infinity;
        rejected.push(axis);
      } else {
        finalScores[axis] = deltaY - twist * _DA_TWIST_WEIGHT;
      }

      // Restore for next probe.
      bone.quaternion.copy(_DA_Q_SAVE);
      bone.updateWorldMatrix(true, true);
    }
  } finally {
    // Unconditional restore (catches early-throw edge cases).
    bone.quaternion.copy(_DA_Q_SAVE);
    bone.updateWorldMatrix(true, true);
  }

  // Select the axis with the highest composite score (sign from rawScore).
  let liftAxis: AxisKey = 'z';
  let liftSign: 1 | -1 = 1;
  let maxFinal = -Infinity;

  for (const axis of ['x', 'y', 'z'] as AxisKey[]) {
    if (finalScores[axis] > maxFinal) {
      maxFinal = finalScores[axis];
      liftAxis = axis;
      liftSign = rawScores[axis] >= 0 ? 1 : -1;
    }
  }

  // If every axis was rejected (all twist > 0.6), fall back to max raw deltaY
  // and emit a warning — the rig has a severe orientation mismatch.
  if (maxFinal === -Infinity) {
    for (const axis of ['x', 'y', 'z'] as AxisKey[]) {
      if (Math.abs(rawScores[axis]) > Math.abs(rawScores[liftAxis])) {
        liftAxis = axis;
      }
    }
    liftSign = rawScores[liftAxis] >= 0 ? 1 : -1;
    maxFinal = Math.abs(rawScores[liftAxis]);
    console.warn('[ARM_AXIS_DETECT] ⚠️ ALL axes rejected (twist > 0.6). Rig has severe orientation mismatch. Using best raw deltaY as fallback.', {
      bone: boneName || bone.name, rawScores, twistScores,
    });
  }

  const confidence = maxFinal === -Infinity ? 0 : maxFinal;

  if (confidence < 0.05 && rejected.length < 3) {
    console.warn('[ARM_AXIS_DETECT] ⚠️ low confidence — scores < 0.05. Matrices may not be updated yet.', {
      bone: boneName || bone.name, finalScores,
    });
  }

  const result: ArmAxisResult = {
    boneName,
    liftAxis,
    liftSign,
    rawScores,
    twistScores,
    finalScores,
    confidence,
    childCount,
    rejected,
  };

  if (isDebugMotion()) {
    console.log('[ARM_AXIS_DETECT]', {
      bone:        boneName || bone.name,
      liftAxis,
      liftSign,
      rawScores:   { x: +rawScores.x.toFixed(4),   y: +rawScores.y.toFixed(4),   z: +rawScores.z.toFixed(4) },
      twistScores: { x: +twistScores.x.toFixed(4), y: +twistScores.y.toFixed(4), z: +twistScores.z.toFixed(4) },
      finalScores: {
        x: finalScores.x === -Infinity ? '-∞' : +finalScores.x.toFixed(4),
        y: finalScores.y === -Infinity ? '-∞' : +finalScores.y.toFixed(4),
        z: finalScores.z === -Infinity ? '-∞' : +finalScores.z.toFixed(4),
      },
      confidence:  +confidence.toFixed(4),
      rejected,
      childCount,
    });
  }

  return result;
}

/**
 * Run `detectArmAxis` on both upper arms.
 *
 * Lifecycle:
 *   patchMap = false  → probe only, log [ARM_AXIS_REPORT], no map change
 *   patchMap = true   → probe + apply to BONE_AXIS_MAP + persist to localStorage
 *
 * Returns `fromCache: true` when the result was already loaded from storage
 * (this function is then a no-op probe, results are informational only).
 */
export function detectBothArms(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humanoid: { getNormalizedBoneNode: (n: any) => THREE.Object3D | null },
  patchMap = false,
  modelKey?: string,
): BothArmsResult {
  const luaBone = humanoid.getNormalizedBoneNode('leftUpperArm');
  const ruaBone = humanoid.getNormalizedBoneNode('rightUpperArm');

  const luaResult = luaBone ? detectArmAxis(luaBone, 'lua') : null;
  const ruaResult = ruaBone ? detectArmAxis(ruaBone, 'rua') : null;

  if (patchMap) {
    // Apply to BONE_AXIS_MAP
    if (luaResult) BONE_AXIS_MAP['lua'] = { ...BONE_AXIS_MAP['lua'], open: { axis: luaResult.liftAxis, sign: luaResult.liftSign } };
    if (ruaResult) BONE_AXIS_MAP['rua'] = { ...BONE_AXIS_MAP['rua'], open: { axis: ruaResult.liftAxis, sign: ruaResult.liftSign } };
    // Persist (model-keyed — STEP 6)
    _saveAxisMapToStorage(luaResult, ruaResult, modelKey);
    if (isDebugMotion()) {
      console.log('[ARM_AXIS_PATCHED_AND_SAVED]', {
        lua: luaResult ? `${luaResult.liftAxis}·${luaResult.liftSign > 0 ? '+1' : '-1'}` : 'NOT_FOUND',
        rua: ruaResult ? `${ruaResult.liftAxis}·${ruaResult.liftSign > 0 ? '+1' : '-1'}` : 'NOT_FOUND',
      });
    }
  } else if (isDebugMotion()) {
    console.log('[ARM_AXIS_REPORT]', {
      lua: luaResult
        ? { liftAxis: luaResult.liftAxis, liftSign: luaResult.liftSign, confidence: +luaResult.confidence.toFixed(4), rejected: luaResult.rejected }
        : 'BONE_NOT_FOUND',
      rua: ruaResult
        ? { liftAxis: ruaResult.liftAxis, liftSign: ruaResult.liftSign, confidence: +ruaResult.confidence.toFixed(4), rejected: ruaResult.rejected }
        : 'BONE_NOT_FOUND',
      patchedBoneAxisMap: false,
    });
  }

  return { lua: luaResult, rua: ruaResult, fromCache: false };
}

/** Expose the current BONE_AXIS_MAP state (all entries) for console inspection. */
export function getAxisMapSnapshot(): typeof BONE_AXIS_MAP {
  return BONE_AXIS_MAP;
}

/** Bones for which we always apply swing-only (never allow twist accumulation). */
const _SWING_ONLY_KEYS = new Set(['lua', 'rua', 'lla', 'rla', 'lh', 'rh', 'leftShoulder', 'rightShoulder']);

/**
 * Single-axis, sign-aware quaternion multiply.
 * For arm/shoulder/hand bones, applies swing-only to prevent twist accumulation.
 */
function mulBoneByMap(
  pose: BonePoseMap,
  key: string,
  slot: 'open' | 'twist',
  value: number,
): void {
  const entry = BONE_AXIS_MAP[key];
  if (!entry) return;
  const bone = entry[slot];
  if (!bone) return;
  const v = value * bone.sign;

  // Arm/shoulder/hand bones: strip twist on write.
  if (_SWING_ONLY_KEYS.has(key)) {
    if (bone.axis === 'x') mulBoneSwingOnly(pose, key, v, 0, 0);
    else if (bone.axis === 'y') mulBoneSwingOnly(pose, key, 0, v, 0);
    else mulBoneSwingOnly(pose, key, 0, 0, v);
  } else {
    if (bone.axis === 'x') mulBone(pose, key, v, 0, 0);
    else if (bone.axis === 'y') mulBone(pose, key, 0, v, 0);
    else mulBone(pose, key, 0, 0, v);
  }
}

// ─── Orchestration state (gesture cycle — reroll on intent change) ────────────
type RegionMask = {
  arms: boolean; elbows: boolean; hands: boolean; fingers: boolean;
  spine: boolean; hips: boolean; shoulders: boolean;
};
const _orch = {
  lastIntent: '' as string,
  cycleStartMs: 0,
  mask: {
    arms: true, elbows: true, hands: true, fingers: true,
    spine: true, hips: true, shoulders: true,
  } as RegionMask,
  microSeedA: 0,
  microSeedB: 0,
  interruptFrame: false,
  headAngleHistoryMs: 0,
  lastHeadYaw: 0,
  lastHeadPitch: 0,
};

function _rollRegionMask(intent: string): RegionMask {
  // Probabilities by intent type
  const isExplain = intent === 'explaining' || intent === 'emphasizing';
  const isThink = intent === 'thinking';
  const isConfirm = intent === 'confirming' || intent === 'agreeing';
  return {
    arms:      Math.random() < (isExplain ? 0.90 : isThink ? 0.20 : isConfirm ? 0.15 : 0.55),
    elbows:    Math.random() < (isExplain ? 0.85 : isThink ? 0.25 : isConfirm ? 0.15 : 0.50),
    hands:     Math.random() < (isExplain ? 0.70 : isThink ? 0.55 : isConfirm ? 0.20 : 0.45),
    fingers:   Math.random() < (isExplain ? 0.65 : isThink ? 0.75 : isConfirm ? 0.30 : 0.55),
    spine:     Math.random() < (isExplain ? 0.55 : isThink ? 0.40 : isConfirm ? 0.30 : 0.35),
    hips:      Math.random() < (isExplain ? 0.35 : isThink ? 0.25 : isConfirm ? 0.15 : 0.25),
    shoulders: Math.random() < (isExplain ? 0.94 : isThink ? 0.35 : isConfirm ? 0.40 : 0.55),
  };
}

/** Dominant channel multipliers: main region 1.0, secondary × 0.3. */
function _dominanceMul(intent: string): Record<keyof RegionMask, number> {
  if (intent === 'explaining' || intent === 'emphasizing') {
    return { arms: 1.0, elbows: 1.0, shoulders: 1.0, hands: 0.35, fingers: 0.32, spine: 0.38, hips: 0.32 };
  }
  if (intent === 'thinking') {
    return { arms: 0.3, elbows: 0.3, shoulders: 0.3, hands: 0.8, fingers: 1.0, spine: 0.3, hips: 0.3 };
  }
  if (intent === 'confirming' || intent === 'agreeing') {
    return { arms: 0.3, elbows: 0.3, shoulders: 0.3, hands: 0.3, fingers: 0.3, spine: 0.3, hips: 0.3 };
  }
  return { arms: 0.7, elbows: 0.7, shoulders: 0.7, hands: 0.7, fingers: 0.7, spine: 0.7, hips: 0.7 };
}

/** Region activation gate — staggered delay in ms from cycle start. */
const REGION_DELAY_MS: Record<keyof RegionMask, number> = {
  shoulders: 0,
  arms:      40,
  elbows:    80,
  hands:     120,
  fingers:   160,
  spine:     20,
  hips:      60,
};

function _regionActive(region: keyof RegionMask, elapsedMs: number): number {
  const delay = REGION_DELAY_MS[region];
  if (elapsedMs < delay) return 0;
  // 60 ms smooth fade-in once gate opens
  return Math.min(1, (elapsedMs - delay) / 60);
}

function clampBoneAxis(pose: BonePoseMap, key: string, limit: number): void {
  const q = pose.get(key);
  if (!q) return;
  const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
  eTmp.setFromQuaternion(q, 'YXZ');
  eTmp.x = Math.max(-limit, Math.min(limit, eTmp.x));
  eTmp.y = Math.max(-limit, Math.min(limit, eTmp.y));
  eTmp.z = Math.max(-limit, Math.min(limit, eTmp.z));
  const qOut = new THREE.Quaternion().setFromEuler(eTmp);
  pose.set(key, qOut);
}

// ─── Anti-V-pose upper-arm clamp ──────────────────────────────────────────────
// Per-axis bounds for `lua` / `rua`:
//   X (forward / back raise): ±1.30 rad ≈ 75°  → never above shoulder
//   Y (twist):                ±0.50 rad ≈ 29°
//   Z (abduction):            ±CLAMP_ARM       → existing side-raise bound
// Tighter than `clampBoneAxis(key, CLAMP_ARM)` on Y/Z but explicit + named.
const CLAMP_ARM_X_FORWARD = 1.30;
const CLAMP_ARM_Y_TWIST   = 0.50;
const CLAMP_ARM_Z_ABDUCT  = CLAMP_ARM;
export function clampUpperArmAntiVPose(pose: BonePoseMap, key: string): void {
  const q = pose.get(key);
  if (!q) return;
  const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
  eTmp.setFromQuaternion(q, 'YXZ');
  eTmp.x = Math.max(-CLAMP_ARM_X_FORWARD, Math.min(CLAMP_ARM_X_FORWARD, eTmp.x));
  eTmp.y = Math.max(-CLAMP_ARM_Y_TWIST,   Math.min(CLAMP_ARM_Y_TWIST,   eTmp.y));
  eTmp.z = Math.max(-CLAMP_ARM_Z_ABDUCT,  Math.min(CLAMP_ARM_Z_ABDUCT,  eTmp.z));
  // Plain setFromEuler — do NOT use swing decomposition here.
  // Swing-only would strip the X component (forward-raise axis in VRM normalized
  // bones), erasing legitimate gestures every frame and causing the V-pose freeze.
  const qOut = new THREE.Quaternion().setFromEuler(eTmp);
  pose.set(key, qOut);
}

export function applyIntentMotionState(
  pose: BonePoseMap,
  ms: IntentMotionState,
  weight: number,
  intent?: string,
): { applied: boolean; headNod: number; headTilt: number; armOpen: number } {
  const w = Math.max(0, Math.min(1, weight));
  if (w < 1e-3) return { applied: false, headNod: 0, headTilt: 0, armOpen: 0 };

  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const intentKey = intent ?? '';

  // ── Orchestration cycle: reroll region mask when intent changes ────────
  if (intentKey !== _orch.lastIntent) {
    _orch.lastIntent = intentKey;
    _orch.cycleStartMs = nowMs;
    _orch.mask = _rollRegionMask(intentKey);
    _orch.microSeedA = Math.random();
    _orch.microSeedB = Math.random();
  }
  const elapsedMs = nowMs - _orch.cycleStartMs;

  // ── Interruption model: ~1.5% chance to skip a frame (hesitation) ──────
  _orch.interruptFrame = Math.random() < 0.015;
  if (_orch.interruptFrame) return { applied: false, headNod: 0, headTilt: 0, armOpen: 0 };

  let hn = (ms.headNod  ?? 0) * w;
  let ht = (ms.headTilt ?? 0) * w;
  let og = (ms.openGesture ?? 0) * w;

  // Force minimum visibility so weak-signal intents still produce readable motion.
  const MIN_VISIBLE = 0.02;
  if (hn !== 0 && Math.abs(hn) < MIN_VISIBLE) hn = Math.sign(hn) * MIN_VISIBLE;
  if (ht !== 0 && Math.abs(ht) < MIN_VISIBLE) ht = Math.sign(ht) * MIN_VISIBLE;
  if (og !== 0 && Math.abs(og) < MIN_VISIBLE) og = Math.sign(og) * MIN_VISIBLE;

  // Anticipation + overshoot oscillation — only near peak (w > 0.6).
  if (w > 0.6) {
    const tSec = nowMs * 0.001;
    const overshoot = Math.sin(tSec * 6) * 0.15;
    hn *= 1.0 + overshoot;
    ht *= 1.0 + overshoot;
    og *= 1.0 + overshoot;
  }

  // ── Micro variation per frame (natural jitter, no amplitude increase) ──
  const microHn = 0.9 + Math.random() * 0.2;    // 0.9..1.1
  const microHt = 0.9 + Math.random() * 0.2;
  const microOg = 0.85 + Math.random() * 0.3;   // 0.85..1.15
  hn *= microHn;
  ht *= microHt;
  og *= microOg;

  // Dominance + gating coefficients per region
  const dom = _dominanceMul(intentKey);
  const gArms      = (_orch.mask.arms      ? 1 : 0) * _regionActive('arms',      elapsedMs) * dom.arms;
  const gElbows    = (_orch.mask.elbows    ? 1 : 0) * _regionActive('elbows',    elapsedMs) * dom.elbows;
  const gHands     = (_orch.mask.hands     ? 1 : 0) * _regionActive('hands',     elapsedMs) * dom.hands;
  const gFingers   = (_orch.mask.fingers   ? 1 : 0) * _regionActive('fingers',   elapsedMs) * dom.fingers;
  const gSpine     = (_orch.mask.spine     ? 1 : 0) * _regionActive('spine',     elapsedMs) * dom.spine;
  const gHips      = (_orch.mask.hips      ? 1 : 0) * _regionActive('hips',      elapsedMs) * dom.hips;
  const gShoulders = (_orch.mask.shoulders ? 1 : 0) * _regionActive('shoulders', elapsedMs) * dom.shoulders;

  // Arm asymmetry — right arm slightly dominant (human-like)
  const luaMul = 1.00, ruaMul = 0.85;
  const llaMul = 1.00, rlaMul = 0.90;

  if (hn !== 0 || ht !== 0) {
    // Neck leads (applied first), head follows at higher amp — cinematic spinal cascade.
    mulBone(pose, 'neck', hn * 0.70, 0, ht * 0.70);
    mulBone(pose, 'head', hn * 2.00, 0, ht * 2.20);
    clampBoneAxis(pose, 'neck', CLAMP_HEAD);
    clampBoneAxis(pose, 'head', CLAMP_HEAD);
  }

  if (og !== 0) {
    // ─── ARMS — staggered + dominance gate (axis-map driven) ──────────────
    // Logic value = abduction magnitude (always positive). Sign applied via map.
    const luaOpen = 1.00 * og * luaMul * gArms;
    const ruaOpen = 1.00 * og * ruaMul * gArms;
    if (gArms > 0) {
      mulBoneByMap(pose, 'lua', 'open', luaOpen);
      mulBoneByMap(pose, 'rua', 'open', ruaOpen);
      clampBoneAxis(pose, 'lua', CLAMP_ARM);
      clampBoneAxis(pose, 'rua', CLAMP_ARM);
      // Explicit anti-V-pose clamp — prevents forward raise above shoulder.
      clampUpperArmAntiVPose(pose, 'lua');
      clampUpperArmAntiVPose(pose, 'rua');
    }

    // ─── DYNAMIC ELBOW — axis-map driven ─────────────────────────────────
    if (gElbows > 0) {
      const lShInf = Math.min(1, Math.abs(luaOpen) / CLAMP_ARM);
      const rShInf = Math.min(1, Math.abs(ruaOpen) / CLAMP_ARM);
      const lElbow = (og * 0.7 + lShInf * 0.3) * llaMul * gElbows;
      const rElbow = (og * 0.7 + rShInf * 0.3) * rlaMul * gElbows;
      mulBoneByMap(pose, 'lla', 'open', lElbow);
      mulBoneByMap(pose, 'rla', 'open', rElbow);
      clampBoneAxis(pose, 'lla', CLAMP_ARM);
      clampBoneAxis(pose, 'rla', CLAMP_ARM);
    }

    // ─── SHOULDERS — axis-map driven (open = clavicle roll, twist = shrug) ─
    if (gShoulders > 0) {
      const shoulderOpenMul =
        intentKey === 'explaining' || intentKey === 'emphasizing' ? 0.58 : 0.34;
      mulBoneByMap(pose, 'leftShoulder',  'open',  shoulderOpenMul * og * gShoulders);
      mulBoneByMap(pose, 'rightShoulder', 'open',  shoulderOpenMul * og * gShoulders);
      mulBoneByMap(pose, 'leftShoulder',  'twist', 0.1 * og * gShoulders);
      mulBoneByMap(pose, 'rightShoulder', 'twist', 0.1 * og * gShoulders);
      clampBoneAxis(pose, 'leftShoulder',  0.30);
      clampBoneAxis(pose, 'rightShoulder', 0.30);
    }

    // ─── SPINE + CHEST + HIPS — gated + breath coupling ─────────────────
    if (gSpine > 0) {
      const breathSpine = Math.sin(nowMs * 0.0012) * 0.03; // ~0.2 Hz natural breath
      mulBone(pose, 'spine', 0.20 * og * gSpine + breathSpine, 0, 0);
      mulBone(pose, 'chest', 0.33 * og * gSpine + breathSpine * 0.55, 0, 0);
      clampBoneAxis(pose, 'spine', 0.25);
      clampBoneAxis(pose, 'chest', 0.25);
    }
    if (gHips > 0) {
      mulBone(pose, 'hips', 0, 0.05 * og * gHips, 0);
      clampBoneAxis(pose, 'hips', 0.15);
    }

    // ─── HANDS — axis-map driven (open = wrist flex, twist = Z rotation) ─
    if (gHands > 0) {
      mulBoneByMap(pose, 'lh', 'open',  0.20 * og * gHands);
      mulBoneByMap(pose, 'rh', 'open',  0.20 * og * gHands);
      mulBoneByMap(pose, 'lh', 'twist', 0.10 * og * gHands);
      mulBoneByMap(pose, 'rh', 'twist', 0.10 * og * gHands);
      clampBoneAxis(pose, 'lh', 0.35);
      clampBoneAxis(pose, 'rh', 0.35);
    }

    // ─── FINGER CURL — gated ────────────────────────────────────────────
    if (gFingers > 0) {
      const fMul = gFingers;
      const FINGER_PROXIMALS = [
        'lIndexProximal',  'lMiddleProximal', 'lRingProximal', 'lLittleProximal', 'lThumbProximal',
        'rIndexProximal',  'rMiddleProximal', 'rRingProximal', 'rLittleProximal', 'rThumbProximal',
      ];
      const FINGER_INTERMEDIATES = [
        'leftIndexIntermediate', 'leftMiddleIntermediate', 'leftRingIntermediate', 'leftLittleIntermediate',
        'rightIndexIntermediate','rightMiddleIntermediate','rightRingIntermediate','rightLittleIntermediate',
      ];
      const FINGER_DISTALS = [
        'leftIndexDistal',  'leftMiddleDistal',  'leftRingDistal',  'leftLittleDistal',  'leftThumbDistal',
        'rightIndexDistal', 'rightMiddleDistal', 'rightRingDistal', 'rightLittleDistal', 'rightThumbDistal',
      ];
      for (const k of FINGER_PROXIMALS)     mulBone(pose, k, -0.30 * og * fMul, 0, 0);
      for (const k of FINGER_INTERMEDIATES) mulBone(pose, k, -0.40 * og * fMul, 0, 0);
      for (const k of FINGER_DISTALS)       mulBone(pose, k, -0.20 * og * fMul, 0, 0);
    }
  }

  // Camera-facing emphasis — explaining draws attention on Y + slight yaw for readability.
  if (intent === 'explaining' || intent === 'emphasizing') {
    mulBone(pose, 'head', 0.038 * w, 0.067 * w, 0.026 * w);
    clampBoneAxis(pose, 'head', CLAMP_HEAD);
  }

  return { applied: true, headNod: hn, headTilt: ht, armOpen: og };
}

// ─── Hard anatomical safety net — runs on LIVE VRM normalized bones ───────────
//
// Called AFTER applyFinalPoseToVrm + humanoid.update() so it is the last writer
// in the pipeline and cannot be undone by any upstream layer.  Uses absolute
// setFromEuler (never +=) so there is zero accumulation risk.
//
// Limits (rad) per the spec comment:
//   upperArm  X (fwd/back raise)   : ±1.30  ≈ ±75°
//             Y (twist)            : ±0.50  ≈ ±29°
//             Z (abduction)        : ±0.70  ≈ ±40°
//   lowerArm  X (elbow flexion)    :  -0.05 → 1.60  (no hyper-extension, ~92° max flex)
//             Y (medial/lateral)   : ±0.30
//             Z (wrist-plane)      : ±0.30
//
// Safety rules (per system-wide contract):
//   • Read quaternion → Euler YXZ → clamp → setFromEuler (absolute, never +=)
//   • No world-space transforms — normalized bone = local space already correct
//   • Writes `window.__armDebug` for quick console inspection

const _BL_E  = new THREE.Euler(0, 0, 0, 'YXZ');
const _BL_Q  = new THREE.Quaternion();

// ─── Soft-clamp (non-destructive) ────────────────────────────────────────────
// Values that exceed the anatomical range are NOT hard-cut. They are gently
// pulled back toward the boundary using a 20 % spring coefficient so gesture
// poses that only slightly overshoot don't look clamped at all, while extreme
// hyper-extension is still constrained.  Preserves gesture intent while
// guarding against bone inversion.
function softClamp(v: number, min: number, max: number): number {
  if (v < min) return min + (v - min) * 0.20;
  if (v > max) return max + (v - max) * 0.20;
  return v;
}

// ─── Gesture-aware limit tables ───────────────────────────────────────────────
// The BASE limits govern idle / generic-speech poses.
// Per-gesture overrides WIDEN specific axes so that a pose authored for that
// gesture (e.g., wave forearm fold) is never truncated.
//
// Wave anatomy (VRM normalized YXZ convention):
//   rightUpperArm.x ≈ -1.35   (forward raise)   → base xMin = -1.30 clips by 4 %
//   rightLowerArm.z ≈ -2.20   (forearm fold)     → base zMin = -0.30 clips by 86 %  ← the bug
//   leftUpperArm.x  ≈ +1.07   (cross-body reach) → base xMax = +0.40 clips by 63 %
//
// Clap anatomy: similar symmetric fold — same lower-arm Z relief required.
//
// All widened limits are still within human anatomical range.
type BoneLimits = { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number };

const _BASE_UPPER_ARM: BoneLimits = { xMin: -1.30, xMax:  0.40, yMin: -0.50, yMax:  0.50, zMin: -1.55, zMax:  1.55 };
const _BASE_LOWER_ARM: BoneLimits = { xMin: -0.05, xMax:  1.60, yMin: -0.30, yMax:  0.30, zMin: -0.30, zMax:  0.30 };

// Gestures that require forearm fold (rlaZ / llaZ deep negative).
const _FOLD_GESTURES   = new Set(['wave', 'clap', 'think']);
// Gestures that require cross-body upper-arm reach (luaX positive).
const _CROSS_GESTURES  = new Set(['wave', 'clap']);
/** Timeline + library ids: open-palm / reach semantics need wider X and Z than generic idle. */
const _SEMANTIC_OPEN_GESTURES = new Set([
  'explain',
  'emphasis',
  'emphasizing',
  'listening',
  'thinking',
  'welcome',
  'point',
]);

function _upperArmLimits(gesture: string | undefined): BoneLimits {
  if (gesture && _CROSS_GESTURES.has(gesture)) {
    // Allow luaX = +1.20 (cross-body for wave / clap); xMin = -1.35 for rua forward raise.
    return { xMin: -1.35, xMax: 1.20, yMin: -0.50, yMax: 0.50, zMin: -1.55, zMax: 1.55 };
  }
  if (gesture && _SEMANTIC_OPEN_GESTURES.has(gesture)) {
    return { xMin: -1.36, xMax: 1.06, yMin: -0.62, yMax: 0.62, zMin: -1.78, zMax: 1.78 };
  }
  return _BASE_UPPER_ARM;
}

function _lowerArmLimits(gesture: string | undefined): BoneLimits {
  if (gesture && _FOLD_GESTURES.has(gesture)) {
    // Allow rlaZ / llaZ down to -2.30 for forearm fold (wave / clap / think).
    // elbow flex (rlaX) kept the same; wrist-plane (Y) unchanged.
    return { xMin: -0.05, xMax: 1.60, yMin: -0.30, yMax: 0.30, zMin: -2.30, zMax: 2.30 };
  }
  if (gesture && _SEMANTIC_OPEN_GESTURES.has(gesture)) {
    return { xMin: -0.05, xMax: 1.72, yMin: -0.46, yMax: 0.46, zMin: -0.78, zMax: 0.78 };
  }
  return _BASE_LOWER_ARM;
}

// ─── Biomechanical context (passed from VRMSkeletonManager) ──────────────────
export type BiomechContext = {
  /** Active gesture id (e.g. 'wave', 'explain', 'idle'). Drives limit selection. */
  gesture?: string;
  /** Current energy level (0..1). Used for idle-pose guard. */
  energy?: number;
  /** Whether the avatar is speaking. Used for idle-pose guard. */
  speaking?: boolean;
  /**
   * When true (speaking + conversational authority lock), widen forward reach on upper arms
   * slightly so camera-facing gestures are not soft-clamped toward backward/read‑as‑pinned poses.
   */
  conversationalReachBias?: boolean;
};

// STEP 4 — Idle pose constants (applied when energy < 0.01 && !speaking).
//
// Anatomical hanging position (matches ARM_IDLE in armGestureReference.ts):
//   • Right upper arm: ruaZ ≈ +1.40 rad (~80°)  → arm hanging straight down
//   • Left  upper arm: luaZ ≈ -1.40 rad (~80°)  → mirror, hanging down
//   • Lower arm:        rlaX ≈ +0.10 rad         → very slight elbow flex (relaxed)
//
// VRM normalized convention: Z=0 is the bind T-pose (arms horizontal). Rotating
// Z toward the bone-length axis collapses the arm down to the side.
//
// Absolute write (no lerp): the previous lerp version never converged because
// `applyFinalPoseToVrm` rewrites the bone every frame from the bind/PoseComposer
// output (which contains the bind T-pose for arms when no gesture is active).
// Each frame the lerp restarted from T-pose → only ~18% movement was visible.
// With absolute write, arms snap to the natural pose every frame and stay there.
const _IDLE_UPPER_ARM_X    = -0.06;  // tiny forward (relaxed shoulders)
const _IDLE_UPPER_ARM_Z    =  1.48;  // hanging-down — right arm; left mirrored (clearer than bind T)
const _IDLE_LOWER_ARM_X    =  0.14;  // ~8° elbow flex (matches ARM_IDLE direction)
// Shoulder roll-down: a tiny negative Z on shoulders closes the V-pose gap
// and gives a "weight-bearing" look instead of the military-at-attention bind.
const _IDLE_SHOULDER_Z     =  0.10;  // rightShoulder drops slightly; left mirrors

/**
 * Soft-clamp a single live VRM normalized bone to anatomical limits.
 *
 * Uses plain Euler decompose → softClamp → setFromEuler (absolute assignment).
 * softClamp is non-destructive: values slightly outside the envelope are gently
 * pulled back (20 % spring) rather than hard-cut, so gesture poses that slightly
 * overshoot the base limits are preserved in intent.
 *
 * Does NOT use swing decomposition — swing-only stripping would remove
 * the X component (forward-raise axis in VRM), erasing gestures every frame
 * and causing the V-pose freeze. Swing-only belongs only in delta-write paths
 * (mulBoneByMap), never in safety clamp paths.
 */
function _blClampBone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humanoid: { getNormalizedBoneNode: (n: any) => THREE.Object3D | null },
  boneName: string,
  limits: BoneLimits,
): void {
  const bone = humanoid.getNormalizedBoneNode(boneName);
  if (!bone) return;
  _BL_E.setFromQuaternion(bone.quaternion, 'YXZ');
  _BL_E.x = softClamp(_BL_E.x, limits.xMin, limits.xMax);
  _BL_E.y = softClamp(_BL_E.y, limits.yMin, limits.yMax);
  _BL_E.z = softClamp(_BL_E.z, limits.zMin, limits.zMax);
  _BL_Q.setFromEuler(_BL_E);
  bone.quaternion.copy(_BL_Q);
}

/**
 * Relaxed human idle pose when avatar is truly silent.
 *
 * Writes the full arm + shoulder chain into a natural hanging posture.
 * This is the "return to relaxed idle" state — Phase 6 of the motion
 * authority contract.  Never returns to bind / T-pose.
 *
 * ABSOLUTE WRITE — no lerp, no read of current bone state.
 *
 * Why absolute (not lerp): `applyFinalPoseToVrm` rewrites arm bone quats
 * every frame from PoseComposer output (which carries bind T-pose when no
 * gesture layer writes those bones).  A lerp from current state restarts at
 * T-pose each frame → never converges.  Absolute write guarantees stable
 * final state.
 *
 * Relaxed human idle contract:
 *   • Upper arms hang slightly forward (X ≈ -0.05) and down (Z ≈ ±1.40).
 *   • Lower arms have tiny natural elbow flex (X ≈ 0.10).
 *   • Shoulders roll down gently (Z ≈ ±0.08) — removes T-pose squareness.
 *
 * The clamp limits widened above (±1.55 on Z) ensure these values pass the
 * subsequent _blClampBone pass unchanged.
 */
const _IDLE_E = new THREE.Euler(0, 0, 0, 'YXZ');
const _IDLE_Q = new THREE.Quaternion();
function _applyIdleArmPose(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humanoid: { getNormalizedBoneNode: (n: any) => THREE.Object3D | null },
): void {
  const writeIdle = (boneName: string, tx: number, ty: number, tz: number): void => {
    const bone = humanoid.getNormalizedBoneNode(boneName);
    if (!bone) return;
    _IDLE_E.set(tx, ty, tz, 'YXZ');
    _IDLE_Q.setFromEuler(_IDLE_E);
    bone.quaternion.copy(_IDLE_Q);
  };

  // Shoulders: slight downward roll removes the bind-pose squareness.
  writeIdle('rightShoulder', 0,  0, -_IDLE_SHOULDER_Z);
  writeIdle('leftShoulder',  0,  0,  _IDLE_SHOULDER_Z);
  // Upper arms: hanging down by the side (Z mirrored).
  writeIdle('rightUpperArm', _IDLE_UPPER_ARM_X, 0,  _IDLE_UPPER_ARM_Z);
  writeIdle('leftUpperArm',  _IDLE_UPPER_ARM_X, 0, -_IDLE_UPPER_ARM_Z);
  // Lower arms: tiny natural elbow flex.
  writeIdle('rightLowerArm', _IDLE_LOWER_ARM_X, 0, 0);
  writeIdle('leftLowerArm',  _IDLE_LOWER_ARM_X, 0, 0);
}

/**
 * Gesture-aware, soft-clamped biomechanical safety net.
 *
 * Pipeline position: AFTER `applyFinalPoseToVrm` + first `humanoid.update()`.
 * Applies soft (spring-back) Euler limits to arm/shoulder normalized bones.
 * Head, neck, spine are intentionally NOT touched (owned by PoseComposer).
 *
 * Layer contract (CLAMP-ONLY — no override of gesture intent):
 *   • When `ctx.gesture` is 'wave' | 'clap' | 'think', the lower-arm Z and
 *     upper-arm X limits are widened to the gesture's anatomical envelope so
 *     the authored pose shape survives the clamp pass unmodified.
 *   • Soft-clamp preserves 80 % of overshoot so micro-jitter never snaps.
 *   • Idle pose guard: when energy < 0.01 && !speaking, absolute arm-hang is
 *     written BEFORE clamp — guarantees no T-pose on silence.
 *
 * @param humanoid  VRM humanoid (normalized bone interface)
 * @param ctx       Biomechanical context — gesture id, speaking, energy.
 *                  Backwards-compatible: old callers passing
 *                  `{ speaking, energy }` (no `gesture`) continue to work.
 */
export function applyBiomechanicalLayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humanoid: { getNormalizedBoneNode: (n: any) => THREE.Object3D | null },
  ctx?: BiomechContext | { speaking: boolean; energy: number },
): void {
  diagnosticsBiomechEnter();
  if (typeof globalThis !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__execTraceBiomech = true;
  }
  // Normalise legacy callers: `{ speaking, energy }` has no `gesture` field.
  const _gesture = (ctx as BiomechContext | undefined)?.gesture;
  const _speaking = (ctx as { speaking?: boolean } | undefined)?.speaking ?? false;
  const _energy   = (ctx as { energy?: number }   | undefined)?.energy   ?? 1;
  const _reachBias = (ctx as BiomechContext | undefined)?.conversationalReachBias === true;

  // Idle arm pose: prevents T-pose freeze when avatar is truly silent.
  // Runs BEFORE clamp so the arm-hang values pass through the limits unchanged.
  if (!_speaking && _energy < 0.01) {
    _applyIdleArmPose(humanoid);
  }

  // Select per-axis limits based on active gesture.
  let ul = _upperArmLimits(_gesture);
  const ll = _lowerArmLimits(_gesture);
  if (_reachBias && _speaking) {
    ul = {
      ...ul,
      xMin: Math.min(ul.xMin, -1.42),
      xMax: Math.max(ul.xMax, 1.05),
      yMin: Math.min(ul.yMin, -0.62),
      yMax: Math.max(ul.yMax, 0.62),
    };
  }

  _blClampBone(humanoid, 'leftUpperArm',  ul);
  _blClampBone(humanoid, 'rightUpperArm', ul);
  _blClampBone(humanoid, 'leftLowerArm',  ll);
  _blClampBone(humanoid, 'rightLowerArm', ll);

  // Shoulder limits are gesture-independent (small range, never part of gesture shape).
  const sl: BoneLimits = { xMin: -0.30, xMax: 0.30, yMin: -0.30, yMax: 0.30, zMin: -0.35, zMax: 0.35 };
  _blClampBone(humanoid, 'leftShoulder',  sl);
  _blClampBone(humanoid, 'rightShoulder', sl);

  // Debug surface — live Euler snapshot for console inspection.
  if (typeof window !== 'undefined') {
    const lU = humanoid.getNormalizedBoneNode('leftUpperArm');
    const rU = humanoid.getNormalizedBoneNode('rightUpperArm');
    const lL = humanoid.getNormalizedBoneNode('leftLowerArm');
    const rL = humanoid.getNormalizedBoneNode('rightLowerArm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__armDebug = {
      gesture: _gesture ?? 'none',
      lUpper: lU ? { x: +lU.rotation.x.toFixed(3), y: +lU.rotation.y.toFixed(3), z: +lU.rotation.z.toFixed(3) } : null,
      rUpper: rU ? { x: +rU.rotation.x.toFixed(3), y: +rU.rotation.y.toFixed(3), z: +rU.rotation.z.toFixed(3) } : null,
      lLower: lL ? { x: +lL.rotation.x.toFixed(3), y: +lL.rotation.y.toFixed(3), z: +lL.rotation.z.toFixed(3) } : null,
      rLower: rL ? { x: +rL.rotation.x.toFixed(3), y: +rL.rotation.y.toFixed(3), z: +rL.rotation.z.toFixed(3) } : null,
      limitsActive: {
        upperX: `[${ul.xMin.toFixed(2)}, ${ul.xMax.toFixed(2)}]`,
        lowerZ: `[${ll.zMin.toFixed(2)}, ${ll.zMax.toFixed(2)}]`,
      },
    };
  }
}
