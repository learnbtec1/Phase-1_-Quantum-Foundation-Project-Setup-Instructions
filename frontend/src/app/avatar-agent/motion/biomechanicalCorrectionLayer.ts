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

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qDelta = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _eulerRead = new THREE.Euler(0, 0, 0, 'YXZ');
const _qRead = new THREE.Quaternion();

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
  console.log('[FILE_EXECUTED] biomechanicalCorrectionLayer');
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

  // Throttled debug (~1/s)
  if (nowMs - _neural.lastDebugMs > 1000) {
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

  // Throttled debug (~1/s)
  if (nowMs - _sub.lastDebugMs > 1000) {
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
  console.log('[AXIS_MAP_OVERRIDE]', BONE_AXIS_MAP);
}

/** Single-axis, sign-aware quaternion multiply. */
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
  if (bone.axis === 'x') mulBone(pose, key, v, 0, 0);
  else if (bone.axis === 'y') mulBone(pose, key, 0, v, 0);
  else mulBone(pose, key, 0, 0, v);
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
    shoulders: Math.random() < (isExplain ? 0.85 : isThink ? 0.35 : isConfirm ? 0.40 : 0.55),
  };
}

/** Dominant channel multipliers: main region 1.0, secondary × 0.3. */
function _dominanceMul(intent: string): Record<keyof RegionMask, number> {
  if (intent === 'explaining' || intent === 'emphasizing') {
    return { arms: 1.0, elbows: 1.0, shoulders: 0.9, hands: 0.3, fingers: 0.3, spine: 0.3, hips: 0.3 };
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
      mulBoneByMap(pose, 'leftShoulder',  'open',  0.25 * og * gShoulders);
      mulBoneByMap(pose, 'rightShoulder', 'open',  0.25 * og * gShoulders);
      mulBoneByMap(pose, 'leftShoulder',  'twist', 0.05 * og * gShoulders);
      mulBoneByMap(pose, 'rightShoulder', 'twist', 0.05 * og * gShoulders);
      clampBoneAxis(pose, 'leftShoulder',  0.30);
      clampBoneAxis(pose, 'rightShoulder', 0.30);
    }

    // ─── SPINE + CHEST + HIPS — gated + breath coupling ─────────────────
    if (gSpine > 0) {
      const breathSpine = Math.sin(nowMs * 0.0012) * 0.03; // ~0.2 Hz natural breath
      mulBone(pose, 'spine', 0.15 * og * gSpine + breathSpine, 0, 0);
      mulBone(pose, 'chest', 0.25 * og * gSpine + breathSpine * 0.5, 0, 0);
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

  // Camera-facing emphasis — explaining draws attention on Y.
  if (intent === 'explaining' || intent === 'emphasizing') {
    mulBone(pose, 'head', 0, 0.05 * w, 0);
    clampBoneAxis(pose, 'head', CLAMP_HEAD);
  }

  return { applied: true, headNod: hn, headTilt: ht, armOpen: og };
}
