import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { motionDebug } from '@/lib/avatar/motionDebug';
import { isDebugMotion } from '@/lib/logging/runtimeLog';
import { logFinalPoseApplyProbe } from '@/app/avatar-agent/motion/motionPipelineDebug';

/** Canonical keys for composed avatar bones (normalized humanoid). */
export type BonePoseKey =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'lua'
  | 'rua'
  | 'lla'
  | 'rla'
  | 'lh'
  | 'rh'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg'
  | 'leftFoot'
  | 'rightFoot'
  | 'leftToes'
  | 'rightToes'
  | 'rIndexProximal'
  | 'rMiddleProximal'
  | 'rRingProximal'
  | 'rLittleProximal'
  | 'rThumbProximal'
  | 'lIndexProximal'
  | 'lMiddleProximal'
  | 'lRingProximal'
  | 'lLittleProximal'
  | 'lThumbProximal'
  | 'leftThumbMetacarpal'
  | 'leftThumbProximal'
  | 'leftThumbDistal'
  | 'leftIndexProximal'
  | 'leftIndexIntermediate'
  | 'leftIndexDistal'
  | 'leftMiddleProximal'
  | 'leftMiddleIntermediate'
  | 'leftMiddleDistal'
  | 'leftRingProximal'
  | 'leftRingIntermediate'
  | 'leftRingDistal'
  | 'leftLittleProximal'
  | 'leftLittleIntermediate'
  | 'leftLittleDistal'
  | 'rightThumbMetacarpal'
  | 'rightThumbProximal'
  | 'rightThumbDistal'
  | 'rightIndexProximal'
  | 'rightIndexIntermediate'
  | 'rightIndexDistal'
  | 'rightMiddleProximal'
  | 'rightMiddleIntermediate'
  | 'rightMiddleDistal'
  | 'rightRingProximal'
  | 'rightRingIntermediate'
  | 'rightRingDistal'
  | 'rightLittleProximal'
  | 'rightLittleIntermediate'
  | 'rightLittleDistal';

export type BonePoseMap = Map<string, THREE.Quaternion>;

/** Sampled VRMA output: absolute normalized-bone quaternions (short keys). */
export type VrmaSampledPose = {
  bones: BonePoseMap;
  /** Monotonic — consumers can skip unchanged samples. */
  seq: number;
};

export type PoseBlendWeights = {
  /** 0–1 idle layer influence (per-frame eased targets). */
  idle: number;
  generative: number;
  gesture: number;
  /** Corrective (collision) — applied after generative, before VRMA. */
  collision: number;
  vrma: number;
};

/** Per-bone overrides for `blendPoseLayers` (e.g. kinematic lock: crush idle/vrma/collision on that joint). */
export type PerBonePoseBlendWeights = Partial<PoseBlendWeights>;

const _Q = new THREE.Quaternion();
const _Q2 = new THREE.Quaternion();

// ─── Last-Valid-Pose (LVP) memory — module scope, zero per-frame allocations ─
//
// Design contract:
//   • _lastFinalPose stores the last successfully-composed quaternion per bone.
//   • _staleCounter tracks consecutive frames in which NO layer wrote a bone.
//   • When a bone has no writer, its LVP is carried forward (max _STALE_BUDGET
//     frames ≈ 200 ms at 60 FPS). After the budget expires, bind (T-pose) is
//     used — preserving the original fallback for genuinely un-driven bones.
//   • Quaternion objects in _lastFinalPose are REUSED (in-place copy) to avoid
//     GC. They are created lazily on first write.
//   • NaN propagation is blocked: if any component of the blended quaternion is
//     NaN or the quaternion's length is near zero, the bone falls back to bind
//     and the LVP entry is NOT updated for that frame.
//
// Why this eliminates T-pose snapping:
//   The old pipeline started every bone from `bind` (T-pose) each frame. Any
//   frame in which the writer (gesture / idle / generative) was silent — during
//   a gesture handover gap, cool-down, VRMA flicker, or first VRM-load frame —
//   emitted `bind` into `finalPose`. `applyFinalPoseToVrm` then slerped the live
//   bone toward T-pose at up to 0.1 rad/frame, producing visible snapping.
//   With LVP the bone stays where it was; motion is continuous.

const _lastFinalPose = new Map<string, THREE.Quaternion>();
const _staleCounter  = new Map<string, number>();

/** Maximum consecutive no-write frames before entering decay (~200 ms at 60 FPS). */
const _STALE_BUDGET = 12;

/**
 * Frames over which LVP gradually slerps to bind after the budget expires.
 * Range: [0, _DECAY_FRAMES] maps linearly to a slerp t of [0, 1].
 * At 60 FPS this is ~400 ms — enough to be smooth yet prevent frozen poses.
 */
const _DECAY_FRAMES = 24;

/** Scratch Quaternion reused during decay slerp — never allocated per-frame. */
const _Q_DECAY = new THREE.Quaternion();

/** True when all quaternion components are finite and non-zero-length. */
function _isValidQuat(q: THREE.Quaternion): boolean {
  if (!Number.isFinite(q.x) || !Number.isFinite(q.y) ||
      !Number.isFinite(q.z) || !Number.isFinite(q.w)) return false;
  const len2 = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  return len2 > 1e-8;
}

/** Track how many bones are currently in the decay window (for diagnostics). */
let _decayActiveBones = 0;

/** Expose a lightweight diagnostic surface for runtime inspection. */
function _updatePoseContinuityDebug(): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__poseContinuity = {
    lastPoseSize:     _lastFinalPose.size,
    staleCounterSize: _staleCounter.size,
    decayActive:      _decayActiveBones > 0,
    decayActiveBones: _decayActiveBones,
  };
}

/**
 * Blend stack order (each step slerps by weight): IDLE → GENERATIVE → GESTURE → COLLISION → VRMA.
 * Generative authority: `boneWeightOverrides` can zero idle/gesture/collision/vrma on a joint so the
 * commanded pose wins (see `kinematicStandards.ts` + VRMSkeletonManager generative lock).
 *
 * Last-Valid-Pose guarantee: bones not written by any layer this frame carry
 * their previous output forward for up to _STALE_BUDGET frames instead of
 * snapping to bind (T-pose). See module-scope comment above.
 */
export function blendPoseLayers(params: {
  bind: Map<string, THREE.Quaternion>;
  idle: BonePoseMap;
  generative: BonePoseMap;
  gesture: BonePoseMap;
  collision: BonePoseMap;
  vrma: BonePoseMap;
  weights: PoseBlendWeights;
  /** Optional per-bone weights (e.g. suppress idle/VRMA on `rua` while generative holds). */
  boneWeightOverrides?: Map<string, PerBonePoseBlendWeights>;
}): BonePoseMap {
  const { bind, idle, generative, gesture, collision, vrma, weights, boneWeightOverrides } = params;
  const keys = new Set<string>();
  [idle, generative, gesture, collision, vrma].forEach((m) => {
    for (const k of m.keys()) keys.add(k);
  });
  for (const k of bind.keys()) keys.add(k);

  const out: BonePoseMap = new Map();
  const { idle: wI0, generative: wG0, gesture: wGe0, collision: wC0, vrma: wV0 } = weights;

  // Reset per-call decay counter so the debug surface reflects this frame only.
  _decayActiveBones = 0;

  for (const key of keys) {
    const b = bind.get(key);
    if (!b) continue;

    const ov = boneWeightOverrides?.get(key);
    const wI  = ov?.idle       !== undefined ? ov.idle       : wI0;
    const wG  = ov?.generative !== undefined ? ov.generative : wG0;
    const wGe = ov?.gesture    !== undefined ? ov.gesture    : wGe0;
    const wC  = ov?.collision  !== undefined ? ov.collision  : wC0;
    const wV  = ov?.vrma       !== undefined ? ov.vrma       : wV0;

    // Determine whether any layer will write to this bone.
    const hasWriter =
      (idle.has(key)       && wI  > 1e-6) ||
      (generative.has(key) && wG  > 1e-6) ||
      (gesture.has(key)    && wGe > 1e-6) ||
      (collision.has(key)  && wC  > 1e-6) ||
      (vrma.has(key)       && wV  > 1e-6);

    if (!hasWriter) {
      // No writer this frame.  Apply three-tier LVP / decay / bind logic.
      const stale = (_staleCounter.get(key) ?? 0) + 1;
      _staleCounter.set(key, stale);

      const prev = _lastFinalPose.get(key);

      if (prev && _isValidQuat(prev) && stale <= _STALE_BUDGET) {
        // ── TIER 1: carry last valid pose unchanged ──────────────────────────
        // Bone stays exactly where it was — no visible change this frame.
        out.set(key, prev);

      } else if (prev && _isValidQuat(prev) && stale <= _STALE_BUDGET + _DECAY_FRAMES) {
        // ── TIER 2: graceful decay — slerp LVP toward bind ──────────────────
        // t rises from 0 (at budget boundary) to 1 (at end of decay window).
        // Uses _Q_DECAY scratch to avoid allocations; normalizes before output.
        const rawT = (stale - _STALE_BUDGET) / _DECAY_FRAMES;
        const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT;   // clamp [0,1]
        _Q_DECAY.copy(prev).slerp(b, t).normalize();
        out.set(key, _Q_DECAY);
        _decayActiveBones++;

      } else {
        // ── TIER 3: budget + decay window both expired, or no LVP yet ────────
        // Fall back to bind — original behaviour, reached only after ~600 ms
        // of silence (12 + 24 frames at 60 FPS).
        out.set(key, b);
      }
      continue;
    }

    // At least one writer is active — reset stale counter.
    _staleCounter.set(key, 0);

    // Choose base: LVP when available (continuity), bind on first frame.
    const lvp = _lastFinalPose.get(key);
    const base = (lvp && _isValidQuat(lvp)) ? lvp : b;
    _Q.copy(base);

    const qI = idle.get(key);
    if (qI && wI > 1e-6) _Q.slerp(qI, Math.min(1, wI));
    const qG = generative.get(key);
    if (qG && wG > 1e-6) _Q.slerp(qG, Math.min(1, wG));
    const qGe = gesture.get(key);
    if (qGe && wGe > 1e-6) _Q.slerp(qGe, Math.min(1, wGe));
    const qC = collision.get(key);
    if (qC && wC > 1e-6) _Q.slerp(qC, Math.min(1, wC));
    const qV = vrma.get(key);
    if (qV && wV > 1e-6) _Q.slerp(qV, Math.min(1, wV));

    // Guard against NaN propagation before persisting.
    if (!_isValidQuat(_Q)) {
      // Corrupted blend result — fall back to bind, do NOT update LVP.
      out.set(key, b);
      continue;
    }

    // Persist into LVP (reuse existing Quaternion object to avoid allocation).
    let stored = _lastFinalPose.get(key);
    if (!stored) {
      stored = new THREE.Quaternion();
      _lastFinalPose.set(key, stored);
    }
    stored.copy(_Q).normalize();
    out.set(key, stored);
  }

  _updatePoseContinuityDebug();
  return out;
}

export type BoneRefMap = Record<string, THREE.Object3D | null>;

/** PoseComposer short keys → VRM humanoid names for `getNormalizedBoneNode`. */
export const ARM_BONE_MAP: Readonly<Record<string, string>> = {
  lua: 'leftUpperArm',
  rua: 'rightUpperArm',
  lla: 'leftLowerArm',
  rla: 'rightLowerArm',
  lh: 'leftHand',
  rh: 'rightHand',
  lThumbProximal: 'leftThumbProximal',
  lIndexProximal: 'leftIndexProximal',
  lMiddleProximal: 'leftMiddleProximal',
  lRingProximal: 'leftRingProximal',
  lLittleProximal: 'leftLittleProximal',
  rThumbProximal: 'rightThumbProximal',
  rIndexProximal: 'rightIndexProximal',
  rMiddleProximal: 'rightMiddleProximal',
  rRingProximal: 'rightRingProximal',
  rLittleProximal: 'rightLittleProximal',
};

let __applyFinalPoseBoneLogNextAt = 0;
let __finalPoseKeysLogNextAt = 0;

/**
 * Sole function that mutates VRM normalized bone quaternions from composed poses.
 * Applies exponential smoothing toward `finalPose` for frame-rate independence.
 */
export function applyFinalPoseToVrm(params: {
  finalPose: BonePoseMap;
  boneRefs: BoneRefMap;
  /** When set, arm short keys resolve through `humanoid.getNormalizedBoneNode` if missing from `boneRefs`. */
  humanoid?: import('@pixiv/three-vrm').VRM['humanoid'] | null;
  /** rad/s style smoothing; higher = snappier */
  smoothLambda?: number;
  /** Max rotation toward target per frame (rad) — anti-teleport. */
  maxRotationPerFrameRad?: number;
  /** Pose keys that copy target quaternion exactly (no slerp) — kinematic hold. */
  kinematicSnapKeys?: ReadonlySet<string>;
  delta: number;
}): void {
  const { finalPose, boneRefs, delta, humanoid, kinematicSnapKeys } = params;
  logFinalPoseApplyProbe(finalPose, delta);
  const motionPoseDebug = isDebugMotion();
  if (
    motionPoseDebug &&
    typeof performance !== 'undefined'
  ) {
    const n = performance.now();
    if (n >= __finalPoseKeysLogNextAt) {
      __finalPoseKeysLogNextAt = n + 900;
      motionDebug('FINAL POSE KEYS:', [...finalPose.keys()], 'count=', finalPose.size);
    }
  }
  const lambda = params.smoothLambda ?? 16;
  const alpha = 1 - Math.exp(-lambda * Math.min(delta, 0.1));
  const maxRotationPerFrameRad = params.maxRotationPerFrameRad ?? 0.1;

  for (const [key, qT] of finalPose) {
    const mappedKey = ARM_BONE_MAP[key] ?? key;
    let obj: THREE.Object3D | null = boneRefs[key] ?? null;
    if (!obj && humanoid) {
      try {
        obj = humanoid.getNormalizedBoneNode(mappedKey as never) ?? null;
      } catch {
        obj = null;
      }
    }
    if (!obj) continue;
    if (
      motionPoseDebug &&
      ARM_BONE_MAP[key] &&
      typeof performance !== 'undefined'
    ) {
      const n = performance.now();
      if (n >= __applyFinalPoseBoneLogNextAt) {
        __applyFinalPoseBoneLogNextAt = n + 1200;
        // eslint-disable-next-line no-console -- DEBUG: confirm arm mapping path
        console.log('APPLYING TO BONE:', mappedKey, '(pose key:', key, ')');
      }
    }
    _Q2.copy(qT);
    const qCur = obj.quaternion;
    const snap =
      kinematicSnapKeys?.has(key) ||
      kinematicSnapKeys?.has(mappedKey);
    if (snap) {
      qCur.copy(_Q2);
      qCur.normalize();
      continue;
    }
    const dot = THREE.MathUtils.clamp(Math.abs(qCur.dot(_Q2)), 0, 1);
    const omega = 2 * Math.acos(dot);
    let t = Math.min(1, Math.max(0, alpha));
    if (omega > 1e-5) {
      t = Math.min(t, maxRotationPerFrameRad / omega);
    }
    qCur.slerp(_Q2, t);
    qCur.normalize();
  }
}

/**
 * Hard lock avatar root in local space each frame: no translation/rotation accumulation on
 * `vrm.scene` or normalized hips (V121 vertical correction stays on `liftNode`, not here).
 */
export function enforceAvatarRootStability(vrm: VRM): void {
  const scene = vrm.scene;
  scene.position.set(0, 0, 0);
  scene.quaternion.identity();

  const humanoid = vrm.humanoid;
  if (!humanoid) return;
  try {
    const hip = humanoid.getNormalizedBoneNode('hips');
    if (hip) {
      hip.position.set(0, 0, 0);
      hip.quaternion.normalize();
    }
  } catch {
    /* */
  }
}

export function clonePoseMap(src: BonePoseMap): BonePoseMap {
  const m: BonePoseMap = new Map();
  for (const [k, v] of src) m.set(k, v.clone());
  return m;
}

/** VRM humanoid bone name → PoseComposer short key */
export const VRM_HUMANOID_TO_POSE_KEY: Readonly<Record<string, string>> = {
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperChest: 'chest',
  neck: 'neck',
  head: 'head',
  leftShoulder: 'leftShoulder',
  rightShoulder: 'rightShoulder',
  leftUpperArm: 'lua',
  rightUpperArm: 'rua',
  leftLowerArm: 'lla',
  rightLowerArm: 'rla',
  leftHand: 'lh',
  rightHand: 'rh',
  leftUpperLeg: 'leftUpperLeg',
  rightUpperLeg: 'rightUpperLeg',
  leftLowerLeg: 'leftLowerLeg',
  rightLowerLeg: 'rightLowerLeg',
  leftFoot: 'leftFoot',
  rightFoot: 'rightFoot',
  leftToes: 'leftToes',
  rightToes: 'rightToes',
  leftThumbProximal: 'lThumbProximal',
  leftThumbMetacarpal: 'lThumbProximal',
  leftThumbDistal: 'leftThumbDistal',
  leftIndexProximal: 'lIndexProximal',
  leftIndexIntermediate: 'leftIndexIntermediate',
  leftIndexDistal: 'leftIndexDistal',
  leftMiddleProximal: 'lMiddleProximal',
  leftMiddleIntermediate: 'leftMiddleIntermediate',
  leftMiddleDistal: 'leftMiddleDistal',
  leftRingProximal: 'lRingProximal',
  leftRingIntermediate: 'leftRingIntermediate',
  leftRingDistal: 'leftRingDistal',
  leftLittleProximal: 'lLittleProximal',
  leftLittleIntermediate: 'leftLittleIntermediate',
  leftLittleDistal: 'leftLittleDistal',
  rightThumbProximal: 'rThumbProximal',
  rightThumbMetacarpal: 'rThumbProximal',
  rightThumbDistal: 'rightThumbDistal',
  rightIndexProximal: 'rIndexProximal',
  rightIndexIntermediate: 'rightIndexIntermediate',
  rightIndexDistal: 'rightIndexDistal',
  rightMiddleProximal: 'rMiddleProximal',
  rightMiddleIntermediate: 'rightMiddleIntermediate',
  rightMiddleDistal: 'rightMiddleDistal',
  rightRingProximal: 'rRingProximal',
  rightRingIntermediate: 'rightRingIntermediate',
  rightRingDistal: 'rightRingDistal',
  rightLittleProximal: 'rLittleProximal',
  rightLittleIntermediate: 'rightLittleIntermediate',
  rightLittleDistal: 'rightLittleDistal',
};

const HUMANOID_NAMES = Object.keys(VRM_HUMANOID_TO_POSE_KEY) as string[];

/**
 * Copies current normalized humanoid quaternions into `out` using short pose keys.
 */
export function captureNormalizedHumanoidPose(
  humanoid: NonNullable<import('@pixiv/three-vrm').VRM['humanoid']>,
  out: BonePoseMap,
): void {
  out.clear();
  for (const vrmName of HUMANOID_NAMES) {
    const poseKey = VRM_HUMANOID_TO_POSE_KEY[vrmName];
    if (!poseKey) continue;
    try {
      const node = humanoid.getNormalizedBoneNode(vrmName as never);
      if (node) out.set(poseKey, node.quaternion.clone());
    } catch {
      /* bone missing on model */
    }
  }
}

/**
 * Restores normalized humanoid quaternions from a snapshot map (same keys as capture).
 */
export function restoreNormalizedHumanoidPose(
  humanoid: NonNullable<import('@pixiv/three-vrm').VRM['humanoid']>,
  snap: BonePoseMap,
): void {
  for (const vrmName of HUMANOID_NAMES) {
    const poseKey = VRM_HUMANOID_TO_POSE_KEY[vrmName];
    if (!poseKey) continue;
    const q = snap.get(poseKey);
    if (!q) continue;
    try {
      const node = humanoid.getNormalizedBoneNode(vrmName as never);
      if (node) node.quaternion.copy(q);
    } catch {
      /* */
    }
  }
}
