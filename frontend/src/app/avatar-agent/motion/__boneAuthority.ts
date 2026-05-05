'use client';
/**
 * __boneAuthority.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Bone Authority + Diagnostic Trace System (PHASE-A: log-only, additive).
 *
 * PURPOSE
 *   Turn the avatar pose pipeline into a deterministic, debuggable system
 *   where no bone can be silently overridden again.  This file provides:
 *
 *     PART 1  Per-frame `BoneAuthority` registration map
 *     PART 2  `applyBoneRotationSafe` write guard (log-only by default;
 *             blocks secondary writes only when `__STRICT_BONE_AUTHORITY`)
 *     PART 3  Six structured trace points (INPUT, POSE_COMPOSER,
 *             BEFORE_APPLY, AFTER_APPLY, AFTER_VRM_UPDATE, FINAL_FRAME)
 *     PART 4  Freeze detector — per-bone Euler delta over N frames
 *     PART 5  Root-motion check — external AvatarRoot vs vrm.scene
 *     PART 6  Pose-loss detection — missing critical keys
 *     PART 7  VRM-override detection — quaternion drift across vrm.update
 *     PART 8  Gesture-duplication tracker — same gesture twice in a window
 *     PART 9  Throttled output — every N frames, all gated behind
 *             `AVATAR_DEBUG` (`NEXT_PUBLIC_AVATAR_DEBUG=true`)
 *     PART 10 `getAuthorityReport()` — single-call audit summary
 *
 * INVARIANTS
 *   • Never imports React or any avatar pipeline module — pure utility.
 *   • Zero allocations per frame for the hot paths (counters, scratch
 *     Euler, reused snapshot Maps).
 *   • Logs only; never mutates pose state outside its own internals.
 *   • Strict mode (block writes) is opt-in via `window.__STRICT_BONE_AUTHORITY`.
 */

import * as THREE from 'three';
import { AVATAR_DEBUG } from './__avatarErrorTracker';

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — BoneAuthority enum + per-frame map
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Logical "owner" of a bone write within a single frame.
 * String values keep console output human-readable (vs numeric enums).
 */
export const BoneAuthority = Object.freeze({
  NONE:    'NONE',
  VRMA:    'VRMA',
  INTENT:  'INTENT',
  GESTURE: 'GESTURE',
  MICRO:   'MICRO',
  PHYSICS: 'PHYSICS',
} as const);

export type BoneAuthority = (typeof BoneAuthority)[keyof typeof BoneAuthority];

/**
 * Priority lookup.  Higher number = higher authority.
 *   MICRO   (1) — breathing, blink, idle saccades, breath-noise
 *   INTENT  (2) — semantic gestures driven by LLM/intent classifier
 *   GESTURE (3) — explicit gesture system (UnifiedGestureEngine)
 *   VRMA    (4) — VRMA clip playback (deterministic clip data)
 *   PHYSICS (5) — corrective writes (collision, kinematic snap, calibration)
 *   NONE    (0) — sentinel, never claimed
 */
export const AUTHORITY_PRIORITY: Readonly<Record<BoneAuthority, number>> = Object.freeze({
  NONE:    0,
  MICRO:   1,
  INTENT:  2,
  GESTURE: 3,
  VRMA:    4,
  PHYSICS: 5,
});

interface FrameState {
  frame:                       number;
  perBoneAuthority:            Map<string, BoneAuthority>;
  conflictsThisFrame:          number;
  rejectionsThisFrame:         number;
  /** Equal-priority cooperative blends — counted but not warned about. */
  cooperativeBlendsThisFrame:  number;
}

/**
 * Per-frame diagnostic snapshot — fed by detection helpers below; consumed
 * by `getFrameDiagnosticSummary()` and the optional debug overlay.
 *
 * `prevExternalX/Z` carry over between frames so we can compute
 * `rootMotion` (did the outer AvatarRoot translate this frame?).
 */
const _frameDiag: {
  missingPose:  string[];
  overrides:    string[];
  rootMotion:   boolean;
  prevExternalX: number;
  prevExternalZ: number;
  hasExternalRoot: boolean;
} = {
  missingPose:     [],
  overrides:       [],
  rootMotion:      false,
  prevExternalX:   0,
  prevExternalZ:   0,
  hasExternalRoot: false,
};

const _state: FrameState = {
  frame:                      0,
  perBoneAuthority:           new Map(),
  conflictsThisFrame:         0,
  rejectionsThisFrame:        0,
  cooperativeBlendsThisFrame: 0,
};

/** Bounded conflict log — newest at the end. */
const _conflictLog: Array<{
  bone:     string;
  current:  BoneAuthority;
  incoming: BoneAuthority;
  frame:    number;
}> = [];
const _CONFLICT_LOG_MAX = 64;

/** De-dup conflict warnings (same bone × current × incoming) — fire once per `_DEDUP_WINDOW_FRAMES`. */
const _conflictSeen = new Map<string, number>();
const _DEDUP_WINDOW_FRAMES = 60; // ~1 s @ 60fps

// ═══════════════════════════════════════════════════════════════════════════
// PART 9 — Throttling primitives (must come before consumers)
// ═══════════════════════════════════════════════════════════════════════════

/** Increment global frame counter; call once per useFrame. */
export function tickFrameCounter(): number {
  return ++_state.frame;
}

export function getFrameCounter(): number {
  return _state.frame;
}

/**
 * True when the current frame should emit a structured trace.
 * Default cadence: every 20 frames.  Always false unless `AVATAR_DEBUG`.
 */
export function shouldLogThisFrame(everyNthFrame: number = 20): boolean {
  if (!AVATAR_DEBUG) return false;
  if (_state.frame <= 0) return false;
  return _state.frame % everyNthFrame === 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 (cont.) — Authority registration & conflict logging
// ═══════════════════════════════════════════════════════════════════════════

/** Reset per-frame authority map.  Call once at the very top of useFrame. */
export function resetBoneAuthorityFrame(): void {
  _state.perBoneAuthority.clear();
  _state.conflictsThisFrame         = 0;
  _state.rejectionsThisFrame        = 0;
  _state.cooperativeBlendsThisFrame = 0;
  _frameDiag.missingPose = [];
  _frameDiag.overrides   = [];
  _frameDiag.rootMotion  = false;
}

/**
 * Register a bone write attempt with priority semantics.
 *
 * Rules (deterministic, cooperative-blending):
 *   0.  `MICRO` is a passive blend tier — never claims ownership, never
 *       triggers conflicts, never blocks anything.  It is the breath /
 *       blink / saccade background that always runs alongside whatever
 *       higher-priority layer owns the bone.  Returns `true` immediately.
 *   1.  No prior owner → claim, return `true`.
 *   2.  Same owner re-claims → no-op, return `true`.
 *   3.  Different owner, incoming.priority === existing.priority
 *       → cooperative blend (silent).  No log, no override of the
 *         authority record.  Tracked in `cooperativeBlendsThisFrame`.
 *   4.  Different owner, incoming.priority < existing.priority
 *       → log `[AUTHORITY_REJECTED]`, do NOT update map, return `false`.
 *   5.  Different owner, incoming.priority > existing.priority
 *       → log `[AUTHORITY_CONFLICT]`, update map (higher priority wins),
 *         return `true`.
 *
 * Conflict / rejection warnings are de-duplicated within a 60-frame window
 * so a recurring but harmless conflict does not flood the console.
 * Per-frame counters always reflect ground truth.
 */
export function registerBoneAuthority(
  bone: string,
  authority: BoneAuthority,
): boolean {
  // ── PART 1 fix: MICRO never competes — pure passive blend ────────────────
  if (authority === BoneAuthority.MICRO) {
    // Claim the bone only if nobody else owns it; otherwise stay invisible.
    if (!_state.perBoneAuthority.has(bone)) {
      _state.perBoneAuthority.set(bone, BoneAuthority.MICRO);
    }
    return true;
  }

  const existing = _state.perBoneAuthority.get(bone);
  if (!existing) {
    _state.perBoneAuthority.set(bone, authority);
    return true;
  }
  if (existing === authority) return true;

  // MICRO ownership yields immediately to any higher-priority claimant.
  if (existing === BoneAuthority.MICRO) {
    _state.perBoneAuthority.set(bone, authority);
    return true;
  }

  const incomingP = AUTHORITY_PRIORITY[authority];
  const existingP = AUTHORITY_PRIORITY[existing];

  // ── PART 5: equal priority → cooperative blend (silent, no override) ─────
  if (incomingP === existingP) {
    _state.cooperativeBlendsThisFrame++;
    return true;
  }

  if (incomingP < existingP) {
    // ── Lower-priority secondary write — REJECTED (tracking only here;
    //    enforcement via `applyBoneRotationSafe` + __STRICT_BONE_AUTHORITY).
    _state.rejectionsThisFrame++;
    if (AVATAR_DEBUG) {
      const dedupKey = `R|${bone}|${existing}|${authority}`;
      const lastFrame = _conflictSeen.get(dedupKey) ?? -Infinity;
      if (_state.frame - lastFrame > _DEDUP_WINDOW_FRAMES) {
        _conflictSeen.set(dedupKey, _state.frame);
        console.warn('[AUTHORITY_REJECTED]', {
          bone,
          incoming:         authority,
          incomingPriority: incomingP,
          current:          existing,
          currentPriority:  existingP,
        });
      }
    }
    return false;
  }

  // ── Strictly higher priority — override permitted, log as conflict.
  _state.conflictsThisFrame++;
  if (_conflictLog.length >= _CONFLICT_LOG_MAX) _conflictLog.shift();
  _conflictLog.push({
    bone,
    current:  existing,
    incoming: authority,
    frame:    _state.frame,
  });
  if (AVATAR_DEBUG) {
    const dedupKey = `C|${bone}|${existing}|${authority}`;
    const lastFrame = _conflictSeen.get(dedupKey) ?? -Infinity;
    if (_state.frame - lastFrame > _DEDUP_WINDOW_FRAMES) {
      _conflictSeen.set(dedupKey, _state.frame);
      console.warn('[AUTHORITY_CONFLICT]', {
        bone,
        current:          existing,
        currentPriority:  existingP,
        incoming:         authority,
        incomingPriority: incomingP,
        action:           'override (higher priority)',
      });
    }
  }
  _state.perBoneAuthority.set(bone, authority);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — applyBoneRotationSafe write guard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strict-mode resolver (PART 4).
 *
 * Strict mode now defaults to `true` — the deterministic, production-safe
 * behaviour.  Two console-toggleable flags exist:
 *   • `window.__STRICT_BONE_AUTHORITY = false` — explicit opt-out.
 *   • `window.__ALLOW_CONFLICTS       = true`  — escape hatch that wins over
 *     strict mode (lets every legacy direct write through, useful while
 *     debugging a new layer).
 */
function _strictModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__ALLOW_CONFLICTS === true) return false; // explicit override wins
  // Default: strict.  Only an explicit `false` disables.
  return w.__STRICT_BONE_AUTHORITY !== false;
}

/** Scratch quaternion for Euler→Quat conversions in additive paths. */
const _qScratchSafe = new THREE.Quaternion();

/**
 * Wrap any direct rotation/quaternion write to a bone node.
 *
 * Source semantics:
 *   • `MICRO`: ADDITIVE blend — multiplied onto current quaternion, never
 *     replaces.  Always permitted, never registers authority, never blocked
 *     by strict mode.  This is the breath / blink / saccade tier.
 *   • Other sources: priority-based replacement.  If the incoming priority
 *     is lower than the current owner's, the write is REJECTED (logged
 *     once per dedup window).  In strict mode the actual rotation copy is
 *     skipped; non-strict falls through to preserve legacy behaviour.
 *   • Equal-priority writes from a different source are silently treated
 *     as cooperative blends (`registerBoneAuthority` returns `true`).
 *
 * Returns `true` when the rotation was actually written, `false` otherwise.
 */
export function applyBoneRotationSafe(
  bone:     THREE.Object3D | null | undefined,
  rotation: THREE.Quaternion | THREE.Euler,
  source:   BoneAuthority,
): boolean {
  if (!bone) return false;

  // ── PART 1 fix: MICRO is additive blend, never an authority claim ────────
  if (source === BoneAuthority.MICRO) {
    if (rotation instanceof THREE.Quaternion) {
      bone.quaternion.multiply(rotation);
    } else {
      _qScratchSafe.setFromEuler(rotation);
      bone.quaternion.multiply(_qScratchSafe);
    }
    return true;
  }

  const name = bone.name || 'unknown';
  const accepted = registerBoneAuthority(name, source);
  if (!accepted) {
    if (_strictModeEnabled()) {
      if (AVATAR_DEBUG) {
        console.warn('[AUTHORITY_BLOCK]', {
          bone:    name,
          source,
          reason:  'STRICT_BONE_AUTHORITY: lower-priority write blocked',
        });
      }
      return false;
    }
    // Non-strict: fall through and write anyway (legacy behaviour).
  }
  if (rotation instanceof THREE.Quaternion) {
    bone.quaternion.copy(rotation);
  } else {
    bone.quaternion.setFromEuler(rotation);
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Pose-snapshot helpers + structured trace emitters
// ═══════════════════════════════════════════════════════════════════════════

/** Critical bone keys we monitor across the pipeline (PoseComposer short keys). */
export const TRACKED_POSE_KEYS = [
  'head', 'neck',
  'lua', 'rua',
  'lla', 'rla',
  'leftShoulder', 'rightShoulder',
  'spine', 'chest',
] as const;

/** Critical bone keys, canonical VRM humanoid names — for live VRM reads. */
export const TRACKED_HUMANOID_NAMES = [
  'head', 'neck',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftShoulder', 'rightShoulder',
  'spine', 'chest',
] as const;

/** Compact quaternion signature — order matters for byte-for-byte equality. */
function _qSig(q: THREE.Quaternion): string {
  return `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}`;
}

/** Capture short-form quaternion signatures for `keys` from `pose`. */
export function captureSignatureSnapshot(
  pose: Map<string, THREE.Quaternion>,
  keys: readonly string[],
  out: Map<string, string>,
): void {
  out.clear();
  for (const k of keys) {
    const q = pose.get(k);
    if (q) out.set(k, _qSig(q));
  }
}

/**
 * Compare current `pose` against `snap`; for every key that changed, register
 * the supplied authority and refresh the snap entry.  Lets callers attribute
 * post-hoc which layer modified which bones with O(n) cost where n = keys.
 */
export function diffAndRegisterAuthority(
  authority: BoneAuthority,
  pose:      Map<string, THREE.Quaternion>,
  keys:      readonly string[],
  snap:      Map<string, string>,
): void {
  for (const k of keys) {
    const after = pose.get(k);
    if (!after) continue;
    const sig = _qSig(after);
    if (snap.get(k) !== sig) {
      registerBoneAuthority(k, authority);
      snap.set(k, sig);
    }
  }
}

/** Flatten a quaternion to plain digits for log output. */
function _qPlain(q: THREE.Quaternion | undefined | null): { x: number; y: number; z: number; w: number } | null {
  if (!q) return null;
  return {
    x: +q.x.toFixed(4),
    y: +q.y.toFixed(4),
    z: +q.z.toFixed(4),
    w: +q.w.toFixed(4),
  };
}

export type LiveBoneSnapshot = Record<string, { rx: number; ry: number; rz: number } | null>;

/** Read live euler-X/Y/Z from a humanoid; returns plain numbers for log dumps. */
export function readLiveBoneSnapshot(
  humanoid: import('@pixiv/three-vrm').VRM['humanoid'] | null | undefined,
  names: readonly string[] = TRACKED_HUMANOID_NAMES,
): LiveBoneSnapshot {
  const out: LiveBoneSnapshot = {};
  if (!humanoid) {
    for (const n of names) out[n] = null;
    return out;
  }
  for (const n of names) {
    let node: THREE.Object3D | null | undefined;
    try {
      node = humanoid.getNormalizedBoneNode(n as never) ?? null;
    } catch {
      node = null;
    }
    out[n] = node ? {
      rx: +node.rotation.x.toFixed(4),
      ry: +node.rotation.y.toFixed(4),
      rz: +node.rotation.z.toFixed(4),
    } : null;
  }
  return out;
}

// ── Frame trace group (PART 7 — log cleanup) ──────────────────────────────
// All structured logs that fire on a "log frame" (every 20 frames) are
// emitted inside a collapsed console group so the console stays scannable.
// Lazy open: the first emitter that runs opens the group; the explicit
// `endFrameTraceGroup()` call at end-of-frame closes it.

let _frameTraceGroupOpen = false;

function _ensureFrameTraceGroup(): void {
  if (_frameTraceGroupOpen) return;
  if (!shouldLogThisFrame(20)) return;
  console.groupCollapsed(`[AVATAR_FRAME ${_state.frame}]`);
  _frameTraceGroupOpen = true;
}

/** Open the group eagerly (called once near the top of useFrame). */
export function beginFrameTraceGroup(): void {
  _ensureFrameTraceGroup();
}

/** Close the group at end-of-frame.  Always safe to call. */
export function endFrameTraceGroup(): void {
  if (_frameTraceGroupOpen) {
    console.groupEnd();
    _frameTraceGroupOpen = false;
  }
}

// ── Trace emitters (Part 3) ────────────────────────────────────────────────

export function traceInput(payload: {
  gestures?:        unknown;
  motorCommands?:   unknown;
  performance?:     unknown;
  emotion?:         string;
  intent?:          string;
  speaking?:        boolean;
}): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  console.log('[TRACE_INPUT]', {
    frame:          _state.frame,
    gestures:       payload.gestures        ?? null,
    motorCommands:  payload.motorCommands   ?? null,
    performance:    payload.performance     ?? null,
    emotion:        payload.emotion         ?? null,
    intent:         payload.intent          ?? null,
    speaking:       payload.speaking        ?? null,
  });
}

export function tracePoseComposer(params: {
  finalPose: Map<string, THREE.Quaternion>;
  weights:   Record<string, number>;
}): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  const { finalPose, weights } = params;
  const samplePoseKeys = [...finalPose.keys()].slice(0, 30);
  console.log('[TRACE_POSE_COMPOSER]', {
    frame:          _state.frame,
    keyCount:       finalPose.size,
    sampleKeys:     samplePoseKeys,
    weights,
    headPresent:    finalPose.has('head'),
    luaPresent:     finalPose.has('lua'),
    ruaPresent:     finalPose.has('rua'),
    neckPresent:    finalPose.has('neck'),
    spinePresent:   finalPose.has('spine'),
    chestPresent:   finalPose.has('chest'),
  });
}

export function traceBeforeApply(params: {
  finalPose: Map<string, THREE.Quaternion>;
  liveBones: LiveBoneSnapshot;
}): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  console.log('[TRACE_BEFORE_APPLY]', {
    frame:    _state.frame,
    pose: {
      head:  _qPlain(params.finalPose.get('head')),
      neck:  _qPlain(params.finalPose.get('neck')),
      lua:   _qPlain(params.finalPose.get('lua')),
      rua:   _qPlain(params.finalPose.get('rua')),
    },
    liveBones: params.liveBones,
  });
}

export function traceAfterApply(liveBones: LiveBoneSnapshot): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  console.log('[TRACE_AFTER_APPLY]', {
    frame:     _state.frame,
    liveBones,
  });
}

export function traceAfterVrmUpdate(liveBones: LiveBoneSnapshot): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  console.log('[TRACE_AFTER_VRM_UPDATE]', {
    frame:     _state.frame,
    liveBones,
    note: 'In this codebase vrm.update() runs BEFORE applyFinalPoseToVrm — values here are the pre-apply baseline.',
  });
}

export function traceFinalFrame(payload: {
  liveBones?:    LiveBoneSnapshot;
  externalRoot?: { x: number; z: number };
  vrmRoot?:      { x: number; y: number; z: number };
  hipsLocal?:    { x: number; y: number; z: number };
}): void {
  if (!shouldLogThisFrame(20)) return;
  _ensureFrameTraceGroup();
  console.log('[TRACE_FINAL_FRAME]', {
    frame:          _state.frame,
    head:           payload.liveBones?.['head']         ?? null,
    leftUpperArm:   payload.liveBones?.['leftUpperArm'] ?? null,
    rightUpperArm:  payload.liveBones?.['rightUpperArm']?? null,
    spine:          payload.liveBones?.['spine']        ?? null,
    chest:          payload.liveBones?.['chest']        ?? null,
    externalRoot:   payload.externalRoot                ?? null,
    vrmRoot:        payload.vrmRoot                     ?? null,
    hipsLocal:      payload.hipsLocal                   ?? null,
    authorityCount: _state.perBoneAuthority.size,
    conflicts:      _state.conflictsThisFrame,
    rejections:     _state.rejectionsThisFrame,
    health:         (_state.conflictsThisFrame + _state.rejectionsThisFrame) === 0 ? 'OK' : 'DEGRADED',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — Freeze detector
// ═══════════════════════════════════════════════════════════════════════════

const FREEZE_THRESHOLD_RAD = 0.0015;
const FREEZE_FRAMES        = 90;     // ≈1.5 s @ 60fps
const FREEZE_REPORT_COOLDOWN_FRAMES = 240; // re-warn at most every ~4 s

const _frozenLookup = new Map<string, {
  lastEx:        number;
  lastEy:        number;
  lastEz:        number;
  framesFrozen:  number;
  reportedFrame: number;
}>();

const _eulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Per-frame freeze detector — call once at the end of each useFrame after
 * all writers are done.  Logs `[FROZEN_BONE]` when a bone hasn't moved for
 * ≥`FREEZE_FRAMES` frames.  No-ops when `AVATAR_DEBUG` is false.
 */
export function tickFreezeDetector(
  liveBoneNodes: Record<string, THREE.Object3D | null | undefined>,
): void {
  if (!AVATAR_DEBUG) return;
  for (const name in liveBoneNodes) {
    const node = liveBoneNodes[name];
    if (!node) continue;
    _eulerScratch.setFromQuaternion(node.quaternion, 'YXZ');
    const ex = _eulerScratch.x, ey = _eulerScratch.y, ez = _eulerScratch.z;
    const entry = _frozenLookup.get(name);
    if (!entry) {
      _frozenLookup.set(name, {
        lastEx: ex, lastEy: ey, lastEz: ez,
        framesFrozen:  0,
        reportedFrame: -Infinity,
      });
      continue;
    }
    const moved = (Math.abs(ex - entry.lastEx) +
                   Math.abs(ey - entry.lastEy) +
                   Math.abs(ez - entry.lastEz)) > FREEZE_THRESHOLD_RAD;
    if (moved) {
      entry.framesFrozen = 0;
      entry.lastEx = ex; entry.lastEy = ey; entry.lastEz = ez;
    } else {
      entry.framesFrozen++;
      if (
        entry.framesFrozen >= FREEZE_FRAMES &&
        _state.frame - entry.reportedFrame > FREEZE_REPORT_COOLDOWN_FRAMES
      ) {
        entry.reportedFrame = _state.frame;
        console.warn('[FROZEN_BONE]', {
          bone:   name,
          frames: entry.framesFrozen,
          reason: 'no rotation update for ≥' + FREEZE_FRAMES + ' frames — overridden or unwritten',
          eulerSnapshot: { rx: +ex.toFixed(4), ry: +ey.toFixed(4), rz: +ez.toFixed(4) },
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 5 — Root-motion check
// ═══════════════════════════════════════════════════════════════════════════

export function logRootMotion(
  externalRoot: { x: number; z: number },
  vrmRoot:      { x: number; y: number; z: number },
): void {
  // ── Update frame summary every frame (overlay reads this) ─────────────────
  if (_frameDiag.hasExternalRoot) {
    const dx = Math.abs(externalRoot.x - _frameDiag.prevExternalX);
    const dz = Math.abs(externalRoot.z - _frameDiag.prevExternalZ);
    _frameDiag.rootMotion = (dx + dz) > 1e-4;
  }
  _frameDiag.prevExternalX  = externalRoot.x;
  _frameDiag.prevExternalZ  = externalRoot.z;
  _frameDiag.hasExternalRoot = true;

  // ── Console log throttled to every 60 frames ──────────────────────────────
  if (!shouldLogThisFrame(60)) return;
  // vrmRoot is *expected* to be (0,0,0) — locomotion lives on the outer
  // <group ref={groupRef} name="AvatarRoot"> in AvatarCanvas.tsx.
  // We log both so a future regression that lets vrm.scene drift is visible.
  const vrmDrifted = Math.hypot(vrmRoot.x, vrmRoot.y, vrmRoot.z) > 1e-4;
  _ensureFrameTraceGroup();
  console.log('[ROOT_MOTION]', {
    frame:        _state.frame,
    externalRoot,
    vrmRoot,
    vrmDrifted,
    rootMoving:   _frameDiag.rootMotion,
    note:         vrmDrifted
      ? '⚠ vrm.scene.position non-zero — enforceAvatarRootStability did not run or was bypassed'
      : 'OK — vrm root stable, locomotion handled on outer AvatarRoot',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 6 — Pose-loss detection
// ═══════════════════════════════════════════════════════════════════════════

const POSE_LOSS_REQUIREMENTS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['head',          ['head']],
  ['leftUpperArm',  ['lua', 'leftUpperArm']],
  ['rightUpperArm', ['rua', 'rightUpperArm']],
  ['neck',          ['neck']],
];
let _lastPoseLossReportFrame = -Infinity;

export function detectPoseLoss(finalPose: Map<string, THREE.Quaternion>): void {
  const missing: string[] = [];
  for (const [canonical, aliases] of POSE_LOSS_REQUIREMENTS) {
    if (!aliases.some((a) => finalPose.has(a))) missing.push(canonical);
  }
  // Always feed the frame summary (overlay reads this) — not throttled.
  _frameDiag.missingPose = missing;
  if (missing.length === 0) return;
  // Console-error rate-limited to ~1 / 2 s to avoid log spam.
  if (_state.frame - _lastPoseLossReportFrame < 120) return;
  _lastPoseLossReportFrame = _state.frame;
  console.error('[POSE_LOSS]', { frame: _state.frame, missing });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 7 — VRM-override detection
// ═══════════════════════════════════════════════════════════════════════════

const VRM_OVERRIDE_THRESHOLD = 0.01; // sum-of-abs quaternion delta per bone
let _lastVrmOverrideReportFrame = -Infinity;

export function detectVrmOverride(
  before: LiveBoneSnapshot,
  after:  LiveBoneSnapshot,
): void {
  // Always compute overrides for the frame summary, even when AVATAR_DEBUG is
  // off — the overlay must remain useful in production-debug builds.
  const overrides: Array<{ bone: string; before: unknown; after: unknown; delta: number }> = [];
  for (const name in before) {
    const b = before[name];
    const a = after[name];
    if (!a || !b) continue;
    const d = Math.abs(a.rx - b.rx) + Math.abs(a.ry - b.ry) + Math.abs(a.rz - b.rz);
    if (d > VRM_OVERRIDE_THRESHOLD) {
      overrides.push({ bone: name, before: b, after: a, delta: +d.toFixed(4) });
    }
  }
  _frameDiag.overrides = overrides.map((o) => o.bone);
  if (!AVATAR_DEBUG) return;
  if (overrides.length === 0) return;
  if (_state.frame - _lastVrmOverrideReportFrame < 30) return;
  _lastVrmOverrideReportFrame = _state.frame;
  _ensureFrameTraceGroup();
  console.warn('[VRM_OVERRIDE]', {
    frame:     _state.frame,
    overrides,
    note:      'Bones changed between BEFORE_APPLY snapshot and the snapshot taken AFTER vrm.update + applyFinalPoseToVrm. Some delta is expected (slerp toward target); a delta > '
      + VRM_OVERRIDE_THRESHOLD
      + ' rad-eq usually means VRM internals (lookAt, animationManager) are also writing.',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 8 — Gesture-duplication tracker
// ═══════════════════════════════════════════════════════════════════════════

const GESTURE_DUP_WINDOW_MS = 600;
const _gestureLog: Array<{ key: string; ts: number }> = [];
const _GESTURE_LOG_MAX = 32;

/**
 * Record a gesture dispatch.  Returns `true` when the same gesture key
 * fired within the last `GESTURE_DUP_WINDOW_MS` (a likely double-trigger).
 */
export function trackGestureDispatch(gestureKey: string | undefined | null): boolean {
  if (!gestureKey) return false;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  _lastGestureDispatchMs = now;
  while (_gestureLog.length > 0 && now - _gestureLog[0].ts > GESTURE_DUP_WINDOW_MS) {
    _gestureLog.shift();
  }
  const dup = _gestureLog.find((g) => g.key === gestureKey);
  if (_gestureLog.length >= _GESTURE_LOG_MAX) _gestureLog.shift();
  _gestureLog.push({ key: gestureKey, ts: now });
  if (dup) {
    if (AVATAR_DEBUG) {
      console.warn('[GESTURE_DUPLICATION]', {
        gesture:     gestureKey,
        msSinceLast: Math.round(now - dup.ts),
      });
    }
    return true;
  }
  return false;
}

/** Most-recent gesture dispatch timestamp (`performance.now()`-aligned). 0 = never. */
let _lastGestureDispatchMs = 0;
export function getLastGestureDispatchMs(): number {
  return _lastGestureDispatchMs;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — VRMA safety overrides
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bones that carry the user-visible expressivity of an INTENT.  When a VRMA
 * clip is playing AND an LLM-driven intent is active, we cap VRMA influence
 * on these bones so the gesture/intent cannot be silently overwritten by
 * the clip.  Lower limbs and torso keep full VRMA — they carry the clip's
 * weight (idle sway, walk cycle, etc.).
 */
export const VRMA_INTENT_PROTECTED_BONES = [
  'head', 'neck',
  'lua', 'rua',
  'lla', 'rla',
  'leftShoulder', 'rightShoulder',
] as const;

let _lastVrmaWeightAdjustLog = -Infinity;

/**
 * Compute per-bone VRMA weight overrides when an INTENT is active.
 * Returns `null` when no adjustment is needed (cheap fast-path for the
 * common case).  Caller merges the returned weights into the existing
 * `kinematicBoneWeightOverrides` map using `Math.min` so generative locks
 * are never weakened.
 */
export function computeVrmaSafetyOverrides(params: {
  motionSource:    string;
  vrmaLayerW:      number;
  intentIntensity: number;
  intentActive:    boolean;
}): { vrmaReduced: number; bones: ReadonlyArray<string> } | null {
  if (!params.intentActive) return null;
  if (params.motionSource !== 'VRMA') return null;
  if (params.vrmaLayerW <= 0.05) return null;

  // Reduction factor scales with intent intensity:
  //   intent=0.2 (active threshold) → keep ~86% VRMA
  //   intent=1.0 (max)              → keep  30% VRMA
  const intent       = Math.max(0, Math.min(1, params.intentIntensity));
  const reduction    = 1 - intent * 0.7;             // 0.3 .. 1.0
  const vrmaReduced  = params.vrmaLayerW * reduction;

  if (AVATAR_DEBUG && _state.frame - _lastVrmaWeightAdjustLog > 60) {
    _lastVrmaWeightAdjustLog = _state.frame;
    _ensureFrameTraceGroup();
    console.warn('[VRMA_WEIGHT_ADJUST]', {
      bones:           VRMA_INTENT_PROTECTED_BONES,
      vrmaOriginal:    +params.vrmaLayerW.toFixed(3),
      vrmaReduced:     +vrmaReduced.toFixed(3),
      intentIntensity: +intent.toFixed(3),
      reductionFactor: +reduction.toFixed(3),
      reason: 'INTENT active during VRMA playback — protect gesture-critical bones',
    });
  }

  return { vrmaReduced, bones: VRMA_INTENT_PROTECTED_BONES };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Locomotion watchdog
// ═══════════════════════════════════════════════════════════════════════════

const LOCOMOTION_DEAD_THRESHOLD_FRAMES = 240; // ≈ 4 s at 60fps
const LOCOMOTION_LOG_COOLDOWN_FRAMES   = 600; // re-warn at most every 10 s

let _locomotionDeadFrames    = 0;
let _lastLocomotionWarnFrame = -Infinity;

/**
 * Result of the locomotion watcher.  `dead` becomes true after the avatar
 * has been stationary for `LOCOMOTION_DEAD_THRESHOLD_FRAMES` consecutive
 * frames.  `suggested` is a small sin-based dx/dz hint that callers MAY
 * apply — the watcher itself never mutates anything.  Activation is opt-in
 * via `window.__INJECT_LOCOMOTION_FALLBACK = true`.
 */
export interface LocomotionWatchResult {
  dead:        boolean;
  framesIdle:  number;
  suggested:   { dx: number; dz: number } | null;
  injectAllowed: boolean;
}

/**
 * Sample the locomotion state.  Updates internal counters and logs
 * `[LOCOMOTION_DEAD]` (rate-limited) when the avatar has frozen in place.
 *
 * Returns a small suggested micro-translation derived from sin/cos waves
 * (sub-millimetre amplitude) — caller chooses whether to apply, gated by
 * `window.__INJECT_LOCOMOTION_FALLBACK`.
 */
export function tickLocomotionWatcher(): LocomotionWatchResult {
  // No external root sampled yet — nothing to watch.
  if (!_frameDiag.hasExternalRoot) {
    return { dead: false, framesIdle: 0, suggested: null, injectAllowed: false };
  }
  if (_frameDiag.rootMotion) {
    _locomotionDeadFrames = 0;
    return { dead: false, framesIdle: 0, suggested: null, injectAllowed: false };
  }
  _locomotionDeadFrames++;
  if (_locomotionDeadFrames < LOCOMOTION_DEAD_THRESHOLD_FRAMES) {
    return { dead: false, framesIdle: _locomotionDeadFrames, suggested: null, injectAllowed: false };
  }

  // ── LOCOMOTION_DEAD reached ──────────────────────────────────────────────
  if (
    AVATAR_DEBUG &&
    _state.frame - _lastLocomotionWarnFrame > LOCOMOTION_LOG_COOLDOWN_FRAMES
  ) {
    _lastLocomotionWarnFrame = _state.frame;
    _ensureFrameTraceGroup();
    console.warn('[LOCOMOTION_DEAD]', {
      framesIdle:    _locomotionDeadFrames,
      threshold:     LOCOMOTION_DEAD_THRESHOLD_FRAMES,
      hint:          'Avatar root has not translated for ≥' +
                     LOCOMOTION_DEAD_THRESHOLD_FRAMES + ' frames.  ' +
                     'Set window.__INJECT_LOCOMOTION_FALLBACK = true to ' +
                     'inject a sub-millimetre sin sway.',
    });
  }

  const tSec        = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
  const suggested = {
    dx: Math.sin(tSec * 0.4)  * 0.0008,   // ≈ 0.8 mm in X
    dz: Math.cos(tSec * 0.31) * 0.0006,   // ≈ 0.6 mm in Z
  };

  let injectAllowed = false;
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    injectAllowed = (window as any).__INJECT_LOCOMOTION_FALLBACK === true;
  }
  return {
    dead: true,
    framesIdle: _locomotionDeadFrames,
    suggested,
    injectAllowed,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3+4 — Frame summary + Root cause detector
// ═══════════════════════════════════════════════════════════════════════════

export interface FrameDiagnosticSummary {
  frame:              number;
  conflicts:          number;
  rejections:         number;
  cooperativeBlends:  number;
  frozenBones:        string[];
  overrides:          string[];
  missingPose:        string[];
  rootMotion:         boolean;
  hasExternalRoot:    boolean;
  locomotionDeadFrames: number;
}

export interface RootCause {
  cause:      string;
  confidence: 'high' | 'medium' | 'low';
}

/** Snapshot the current frame's diagnostic state.  Pure read — never mutates. */
export function getFrameDiagnosticSummary(): FrameDiagnosticSummary {
  const frozenBones = [..._frozenLookup.entries()]
    .filter(([, v]) => v.framesFrozen >= FREEZE_FRAMES)
    .map(([n]) => n);
  return {
    frame:                _state.frame,
    conflicts:            _state.conflictsThisFrame,
    rejections:           _state.rejectionsThisFrame,
    cooperativeBlends:    _state.cooperativeBlendsThisFrame,
    frozenBones,
    overrides:            [..._frameDiag.overrides],
    missingPose:          [..._frameDiag.missingPose],
    rootMotion:           _frameDiag.rootMotion,
    hasExternalRoot:      _frameDiag.hasExternalRoot,
    locomotionDeadFrames: _locomotionDeadFrames,
  };
}

/**
 * Heuristic root-cause classifier.  Examines the summary in a deterministic
 * priority order — most specific failure wins.
 *
 * Confidence is `high` when a clear single-cause signal is present and
 * `medium` for inconclusive but suggestive states (e.g. avatar standing
 * still on purpose vs locomotion broken — looks the same from this layer).
 */
export function detectRootCause(summary: FrameDiagnosticSummary): RootCause {
  // 1. Pose loss is always the most specific failure: PoseComposer broke.
  if (summary.missingPose.length > 0) {
    return {
      cause:      'PoseComposer failure: missing critical pose keys (' + summary.missingPose.join(', ') + ')',
      confidence: 'high',
    };
  }
  // 2. VRM internals (lookAt / animationManager) are stomping our writes.
  if (summary.overrides.length > 0) {
    return {
      cause:      'VRM override conflict on ' + summary.overrides.join(', '),
      confidence: 'high',
    };
  }
  // 3. Arm-related bones frozen → upstream signal not reaching the layers.
  const armPattern = /(upperArm|lowerArm|hand|shoulder)$/i;
  const armFrozen = summary.frozenBones.filter((b) => armPattern.test(b));
  if (armFrozen.length > 0) {
    return {
      cause:      'No upstream motion input — arm bones frozen: ' + armFrozen.join(', '),
      confidence: 'high',
    };
  }
  // 4. Generic freeze — something is not animating, but we don't know what.
  if (summary.frozenBones.length > 0) {
    return {
      cause:      'Frozen bones detected: ' + summary.frozenBones.join(', '),
      confidence: 'medium',
    };
  }
  // 5. Locomotion check — only fires after sustained stillness so we don't
  //    confuse "intentionally standing" with "broken locomotion".  Confidence
  //    stays medium because both look identical at the bone-authority layer.
  if (
    summary.hasExternalRoot &&
    !summary.rootMotion &&
    summary.locomotionDeadFrames >= LOCOMOTION_DEAD_THRESHOLD_FRAMES
  ) {
    return {
      cause: 'Locomotion system inactive — AvatarRoot has not translated for ' +
             summary.locomotionDeadFrames + ' frames',
      confidence: 'medium',
    };
  }
  return { cause: 'No issues detected', confidence: 'high' };
}

let _lastRootCauseLogFrame = -Infinity;

/**
 * Side-effecting helper: compute summary + root cause and log once per
 * 90-frame window (≈1.5 s).  Suppressed when nothing is wrong.
 */
export function emitRootCauseIfAny(): RootCause {
  const summary = getFrameDiagnosticSummary();
  const rc      = detectRootCause(summary);
  if (rc.cause === 'No issues detected') return rc;
  if (_state.frame - _lastRootCauseLogFrame < 90) return rc;
  _lastRootCauseLogFrame = _state.frame;
  if (AVATAR_DEBUG) {
    _ensureFrameTraceGroup();
    console.warn('[ROOT_CAUSE]', { cause: rc.cause, confidence: rc.confidence });
  }
  return rc;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 10 — Audit report
// ═══════════════════════════════════════════════════════════════════════════

export interface AuthorityReport {
  framesObserved:    number;
  conflictsTotal:    number;
  recentConflicts:   typeof _conflictLog;
  perBoneThisFrame:  Record<string, BoneAuthority>;
  frozenBones:       string[];
  gestureDupsRecent: number;
  health:            'OK' | 'DEGRADED' | 'BROKEN';
}

export function getAuthorityReport(): AuthorityReport {
  const frozen = [..._frozenLookup.entries()]
    .filter(([, v]) => v.framesFrozen >= FREEZE_FRAMES)
    .map(([n]) => n);
  const conflictsTotal = _conflictLog.length;
  const recent = _conflictLog.slice(-10);
  const perBoneThisFrame: Record<string, BoneAuthority> = {};
  for (const [k, v] of _state.perBoneAuthority) perBoneThisFrame[k] = v;
  // Heuristic health: more than a handful of conflicts OR several frozen bones = DEGRADED.
  const health: 'OK' | 'DEGRADED' | 'BROKEN' =
    conflictsTotal === 0 && frozen.length === 0
      ? 'OK'
      : conflictsTotal < 5 && frozen.length < 3
        ? 'DEGRADED'
        : 'BROKEN';
  return {
    framesObserved:    _state.frame,
    conflictsTotal,
    recentConflicts:   recent,
    perBoneThisFrame,
    frozenBones:       frozen,
    gestureDupsRecent: _gestureLog.length,
    health,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Browser console helpers (enabled when AVATAR_DEBUG, plus opt-in flags)
// ═══════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  // PART 4 — strict by default; opt-out via either flag below.
  w.__STRICT_BONE_AUTHORITY = w.__STRICT_BONE_AUTHORITY ?? true;
  w.__ALLOW_CONFLICTS       = w.__ALLOW_CONFLICTS       ?? false;
  w.__AVATAR_DEBUG_OVERLAY  = w.__AVATAR_DEBUG_OVERLAY  ?? false;
  w.__INJECT_LOCOMOTION_FALLBACK =
    w.__INJECT_LOCOMOTION_FALLBACK ?? false;
  w.__avatarAuthorityReport = getAuthorityReport;
  w.__avatarFrameSummary    = getFrameDiagnosticSummary;
  w.__avatarRootCause       = (): RootCause => detectRootCause(getFrameDiagnosticSummary());
}
