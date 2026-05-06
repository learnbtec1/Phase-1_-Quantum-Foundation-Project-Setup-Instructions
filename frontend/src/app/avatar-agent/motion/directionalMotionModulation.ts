'use client';

/**
 * Direction-aware motion modulation + coordinate-system correction.
 *
 * Owns:
 *   getAvatarForward()               — live world forward from any root
 *   classifyForward()                — dominant-axis classification (safe)
 *   applyAvatarForwardCorrection()   — one-shot yaw fix + model-keyed localStorage cache
 *   applyDirectionalMotionModulation() — per-frame boost/damp in motion channels
 *
 * Coordinate contract:
 *   Runtime standard: +Z forward, +Y up, +X right
 *   NEVER depends on hardcoded (0,0,1) inside per-frame logic — always reads from root quat.
 *
 * STEP 1 / 2 — Root target:
 *   Apply correction to liftNode (vrm.scene.parent) NOT vrm.scene.
 *   Caller resolves: root = vrm.scene?.parent ?? vrm.scene
 *
 * STEP 4 — Horizontal alignment only:
 *   Forward and targetDir are projected onto XZ plane before dot product.
 *
 * STEP 5 — Dominant-axis classification:
 *   Each axis must be dominant (largest component) AND exceed threshold.
 *
 * STEP 6 — Model-keyed storage:
 *   Both correction and arm-axis keys include modelKey (title or uuid fallback).
 */

import * as THREE from 'three';

// ── Module-scope scratch (zero per-frame allocs) ──────────────────────────────
const _forward    = new THREE.Vector3();
const _quat       = new THREE.Quaternion();
const _avatarPos  = new THREE.Vector3();
const _targetDir  = new THREE.Vector3();

const _CF_QUAT    = new THREE.Quaternion();

// ── Thresholds ────────────────────────────────────────────────────────────────
/** Minimum dot-product magnitude for an axis to be classified as dominant. */
const _FWD_CLASSIFY_THRESHOLD = 0.65;

// ── Storage key helpers (STEP 6 — model-keyed) ───────────────────────────────
/** Sanitise a model title/uuid into a safe storage-key segment. */
function _modelSegment(modelKey?: string): string {
  if (!modelKey) return 'default';
  return modelKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

export function getFwdCorrectionKey(modelKey?: string): string {
  return `cogni_avatar_fwd_correction_v1_${_modelSegment(modelKey)}`;
}

export function getArmAxisKey(modelKey?: string): string {
  return `cogni_arm_axis_map_v1_${_modelSegment(modelKey)}`;
}

// ── Forward classification ────────────────────────────────────────────────────

export type ForwardClassification =
  | 'PLUS_Z'    // ✔️ correct (+Z forward)
  | 'MINUS_Z'   // 180° inversion
  | 'PLUS_X'    // 90° right  → yaw −90°
  | 'MINUS_X'   // 90° left   → yaw +90°
  | 'PLUS_Y'    // Blender +Y authored → yaw −90°
  | 'MINUS_Y'   // authored −Y → yaw +90°
  | 'AMBIGUOUS';

/** Correction yaw (radians) to bring each classification to +Z forward. */
const _CORRECTION_Y: Record<ForwardClassification, number | null> = {
  PLUS_Z:    0,
  MINUS_Z:   Math.PI,
  PLUS_X:    -Math.PI / 2,
  MINUS_X:    Math.PI / 2,
  PLUS_Y:    -Math.PI / 2,
  MINUS_Y:    Math.PI / 2,
  AMBIGUOUS: null,
};

/**
 * Return the live world-forward vector of `root`.
 * Always reads from world quaternion — never hardcodes (0,0,1) blindly.
 */
export function getAvatarForward(root: THREE.Object3D): THREE.Vector3 {
  root.getWorldQuaternion(_CF_QUAT);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(_CF_QUAT).normalize();
}

/**
 * STEP 5 — Dominant-axis classification.
 *
 * An axis is chosen only when it is BOTH:
 *   (a) above the threshold magnitude, AND
 *   (b) the largest absolute component (truly dominant).
 *
 * This prevents a tilted rig from being misclassified because its
 * secondary axis happens to exceed the threshold.
 */
export function classifyForward(root: THREE.Object3D): ForwardClassification {
  const f = getAvatarForward(root);
  const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
  const t = _FWD_CLASSIFY_THRESHOLD;

  if (az >= t && az >= ax && az >= ay) return f.z > 0 ? 'PLUS_Z'  : 'MINUS_Z';
  if (ax >= t && ax >= ay && ax >= az) return f.x > 0 ? 'PLUS_X'  : 'MINUS_X';
  if (ay >= t && ay >= ax && ay >= az) return f.y > 0 ? 'PLUS_Y'  : 'MINUS_Y';
  return 'AMBIGUOUS';
}

// ── Forward correction ────────────────────────────────────────────────────────

export type ForwardCorrectionResult = {
  classification: ForwardClassification;
  forwardBefore:  { x: number; y: number; z: number };
  correctionY:    number;
  applied:        boolean;
  fromCache:      boolean;
};

/**
 * STEP 2 — One-time forward-direction correction.
 *
 * Caller MUST pass `liftNode` (vrm.scene.parent), NOT vrm.scene directly.
 * This isolates the rotation to the VRM-specific subtree and avoids
 * conflicts with VRM's internal lookAt / floorLock updates on vrm.scene.
 *
 * @param root      liftNode = vrm.scene?.parent ?? vrm.scene (resolved by caller)
 * @param modelKey  vrm.meta?.title or uuid — scopes the localStorage key (STEP 6)
 */
export function applyAvatarForwardCorrection(
  root: THREE.Object3D,
  modelKey?: string,
): ForwardCorrectionResult {
  const storageKey = getFwdCorrectionKey(modelKey);
  const forwardBefore = getAvatarForward(root);
  const rawFwd = {
    x: +forwardBefore.x.toFixed(3),
    y: +forwardBefore.y.toFixed(3),
    z: +forwardBefore.z.toFixed(3),
  };

  // ── 1. Cache restore ──────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { correctionY: number; classification: string };
        if (typeof parsed.correctionY === 'number' && isFinite(parsed.correctionY)) {
          root.rotation.y = parsed.correctionY;
          root.updateWorldMatrix(true, true);
          // STEP 7 — Validation guard after cache restore
          const fwdAfter = getAvatarForward(root);
          if (fwdAfter.z < 0.5) {
            console.warn('[FORWARD_GUARD] Cache restored but forward.z < 0.5 — correction may be stale.', {
              forward: { x: +fwdAfter.x.toFixed(3), y: +fwdAfter.y.toFixed(3), z: +fwdAfter.z.toFixed(3) },
              storageKey,
              hint: 'Run window.__setAvatarForwardCorrection(angleDeg) or clear cache.',
            });
          }
          console.log('[FORWARD_CORRECTION] restored from cache', {
            correctionY: +(parsed.correctionY * 180 / Math.PI).toFixed(1) + '°',
            classification: parsed.classification,
            forwardBefore: rawFwd,
            modelKey: modelKey ?? 'default',
            ok: fwdAfter.z >= 0.5,
          });
          return {
            classification: parsed.classification as ForwardClassification,
            forwardBefore: rawFwd,
            correctionY: parsed.correctionY,
            applied: parsed.correctionY !== 0,
            fromCache: true,
          };
        }
      }
    } catch { /* fall through to detection */ }
  }

  // ── 2. Detect + apply ─────────────────────────────────────────────────────
  const classification = classifyForward(root);
  const correctionY = _CORRECTION_Y[classification];

  if (correctionY === null) {
    console.warn('[FORWARD_CORRECTION] ⚠️ AMBIGUOUS — skipping auto-correction.', {
      forwardBefore: rawFwd,
      modelKey: modelKey ?? 'default',
      hint: 'Call window.__setAvatarForwardCorrection(angleDeg) to apply manually.',
    });
    return { classification, forwardBefore: rawFwd, correctionY: 0, applied: false, fromCache: false };
  }

  if (correctionY !== 0) {
    root.rotation.y = correctionY;
    root.updateWorldMatrix(true, true);
  }

  // ── 3. Persist (model-keyed — STEP 6) ────────────────────────────────────
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ correctionY, classification }));
    } catch { /* storage unavailable */ }
  }

  // ── STEP 7 — Validation guard ─────────────────────────────────────────────
  const afterFwd = getAvatarForward(root);
  if (afterFwd.z < 0.5) {
    console.warn('[FORWARD_GUARD] Forward.z < 0.5 after correction — rig may need manual override.', {
      forward: { x: +afterFwd.x.toFixed(3), y: +afterFwd.y.toFixed(3), z: +afterFwd.z.toFixed(3) },
      classification,
      correctionYDeg: +(correctionY * 180 / Math.PI).toFixed(1),
    });
  }

  console.log('[FORWARD_CORRECTION]', {
    classification,
    correctionY: +(correctionY * 180 / Math.PI).toFixed(1) + '°',
    forwardBefore: rawFwd,
    forwardAfter:  { x: +afterFwd.x.toFixed(3), y: +afterFwd.y.toFixed(3), z: +afterFwd.z.toFixed(3) },
    applied: correctionY !== 0,
    ok: afterFwd.z >= 0.5,
    modelKey: modelKey ?? 'default',
  });

  return { classification, forwardBefore: rawFwd, correctionY, applied: correctionY !== 0, fromCache: false };
}

// ── Per-frame directional motion modulation ───────────────────────────────────

export type DirectionalMotionModulationOpts = {
  /** liftNode or outer group — the same root used for forward correction. */
  avatarRoot:  THREE.Object3D | null | undefined;
  /** World-space target point (e.g. camera.position). */
  targetWorld: THREE.Vector3;
  /** 0..1 speech / motion energy. */
  energy:      number;
};

const NOD_ADD_COEFF     = 0.03;
const GESTURE_ADD_COEFF = 0.1;
const BACKWARD_ALIGNMENT = -0.3;
const BACKWARD_DAMP      = 0.45;

/**
 * STEP 3 / 4 — Direction-aware motion modulation (XZ-plane only).
 *
 * STEP 3: Uses `getAvatarForward(root)` — no hardcoded (0,0,1).
 * STEP 4: Projects both forward and targetDir onto the XZ plane before
 *         dot product, so vertical tilt never bleeds into alignment.
 */
export function applyDirectionalMotionModulation(
  motion: { headNod: number; headTilt: number; openGesture: number },
  opts: DirectionalMotionModulationOpts,
): void {
  const { avatarRoot, targetWorld } = opts;
  const energy = Math.max(0, Math.min(1, opts.energy));

  if (!avatarRoot) return;

  // STEP 3: use getAvatarForward instead of hardcoded (0,0,1)
  avatarRoot.getWorldQuaternion(_quat);
  _forward.set(0, 0, 1).applyQuaternion(_quat);

  avatarRoot.getWorldPosition(_avatarPos);
  _targetDir.copy(targetWorld).sub(_avatarPos);

  // STEP 4: flatten to XZ plane — vertical tilt must not affect alignment
  _forward.y   = 0;
  _targetDir.y = 0;

  const fLen = _forward.lengthSq();
  const tLen = _targetDir.lengthSq();
  if (fLen < 1e-10 || tLen < 1e-10) return;
  _forward.multiplyScalar(1 / Math.sqrt(fLen));
  _targetDir.multiplyScalar(1 / Math.sqrt(tLen));

  const alignment    = _forward.dot(_targetDir);
  const facingFactor = Math.max(0, alignment);

  motion.headNod     += energy * facingFactor * NOD_ADD_COEFF;
  motion.openGesture += energy * facingFactor * GESTURE_ADD_COEFF;

  if (alignment < BACKWARD_ALIGNMENT) {
    motion.headNod     *= BACKWARD_DAMP;
    motion.openGesture *= BACKWARD_DAMP;
  }

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__directionalMotion = {
      alignment:    +alignment.toFixed(4),
      facingFactor: +facingFactor.toFixed(4),
      forwardXZ:    { x: +_forward.x.toFixed(3), z: +_forward.z.toFixed(3) },
      targetDirXZ:  { x: +_targetDir.x.toFixed(3), z: +_targetDir.z.toFixed(3) },
    };
  }
}
