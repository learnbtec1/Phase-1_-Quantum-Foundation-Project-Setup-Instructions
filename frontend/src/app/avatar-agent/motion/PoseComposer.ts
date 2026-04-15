import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { motionDebug } from '@/lib/avatar/motionDebug';
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
  | 'rIndexProximal'
  | 'rMiddleProximal'
  | 'rRingProximal'
  | 'rLittleProximal'
  | 'rThumbProximal'
  | 'lIndexProximal'
  | 'lMiddleProximal'
  | 'lRingProximal'
  | 'lLittleProximal'
  | 'lThumbProximal';

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

const _Q = new THREE.Quaternion();
const _Q2 = new THREE.Quaternion();

/**
 * Priority stack (low → high): IDLE → GENERATIVE → GESTURE → COLLISION → VRMA.
 * Each step: `out.slerp(layerTarget, weight)` with weight in [0,1].
 */
export function blendPoseLayers(params: {
  bind: Map<string, THREE.Quaternion>;
  idle: BonePoseMap;
  generative: BonePoseMap;
  gesture: BonePoseMap;
  collision: BonePoseMap;
  vrma: BonePoseMap;
  weights: PoseBlendWeights;
}): BonePoseMap {
  const { bind, idle, generative, gesture, collision, vrma, weights } = params;
  const keys = new Set<string>();
  [idle, generative, gesture, collision, vrma].forEach((m) => {
    for (const k of m.keys()) keys.add(k);
  });
  for (const k of bind.keys()) keys.add(k);

  const out: BonePoseMap = new Map();
  const { idle: wI, generative: wG, gesture: wGe, collision: wC, vrma: wV } = weights;

  for (const key of keys) {
    const b = bind.get(key);
    if (!b) continue;
    _Q.copy(b);
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
    out.set(key, _Q.clone());
  }
  return out;
}

export type BoneRefMap = Record<string, THREE.Object3D | null>;

/** PoseComposer short keys → VRM humanoid names for `getNormalizedBoneNode`. */
export const ARM_BONE_MAP: Readonly<Record<string, string>> = {
  lua: 'leftUpperArm',
  rua: 'rightUpperArm',
  lla: 'leftLowerArm',
  rla: 'rightLowerArm',
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
  delta: number;
}): void {
  const { finalPose, boneRefs, delta, humanoid } = params;
  logFinalPoseApplyProbe(finalPose, delta);
  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV === 'development' &&
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
      typeof process !== 'undefined' &&
      process.env.NODE_ENV === 'development' &&
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
  leftIndexProximal: 'lIndexProximal',
  leftMiddleProximal: 'lMiddleProximal',
  leftRingProximal: 'lRingProximal',
  leftLittleProximal: 'lLittleProximal',
  rightThumbProximal: 'rThumbProximal',
  rightThumbMetacarpal: 'rThumbProximal',
  rightIndexProximal: 'rIndexProximal',
  rightMiddleProximal: 'rMiddleProximal',
  rightRingProximal: 'rRingProximal',
  rightLittleProximal: 'rLittleProximal',
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
