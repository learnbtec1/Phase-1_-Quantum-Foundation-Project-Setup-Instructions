'use client';
/**
 * BehaviorOrchestrator
 * ───────────────────────────────────────────────────────────────────────────
 * Production-grade, deltaTime-driven scheduler that composes:
 *
 *      Layer 0  Idle Base    (always active, written by existing idle stack)
 *      Layer 1  Procedural   (lookAt, breathing, micro presence)
 *      Layer 2  Gesture      (this orchestrator — event-driven envelope)
 *      Layer 3  Viseme       (facial morphs — owned by LipSyncManager,
 *                             does NOT write bone quaternions)
 *
 * Final pose is produced by `PoseComposer.blendPoseLayers` (already in the
 * codebase) which slerps each layer in sequence with a weight.  Unwritten
 * bones inherit the Last-Valid-Pose stored in `PoseComposer` — never bind /
 * T-pose unless the LVP budget expires.
 *
 * INTEGRATION CONTRACT (do NOT rewrite existing systems):
 *
 *   • The orchestrator does not own `applyFinalPoseToVrm`, `humanoid.update`,
 *     or the biomechanical clamp — those keep their existing positions in
 *     `VRMSkeletonManager.tsx`'s useFrame.
 *
 *   • The orchestrator translates `BehaviorAction` → the existing
 *     `behaviorTimeline.pushBehavior(...)` so the established phase/inertia/
 *     emotion logic (see `motion/behaviorTimeline.ts`) keeps working.
 *
 *   • Module-scope state only.  Maps and Quaternions are reused — zero
 *     per-frame allocations.  All consumer reads return `Readonly` views.
 *
 * USAGE — inside `useFrame` (priority 0):
 *
 *      const tick = tickBehaviorOrchestrator({ now, deltaSec });
 *      const gesturePose = composeGestureLayer(t, tick);
 *      const finalPose = composeLayeredPose({
 *        bind, idle: idlePose, procedural: proceduralPose,
 *        weights: { gesture: tick.envelope },
 *      });
 *      // … then the existing applyFinalPoseToVrm → humanoid.update →
 *      //   biomechanical → humanoid.update chain, untouched.
 */

import * as THREE from 'three';

import {
  pushBehavior,
  tickBehaviorTimeline,
  computeBehaviorFrame,
  getCurrentBehavior,
  type BehaviorEvent,
  type BehaviorFrame,
  type TimelineGestureId,
} from './behaviorTimeline';

import {
  blendPoseLayers,
  type BonePoseMap as ComposerBonePoseMap,
} from './PoseComposer';

import {
  type BehaviorAction,
  type BehaviorActionType,
  type BehaviorFrameSnapshot,
  type BehaviorTickInput,
  type ComposeLayersInput,
  type GestureClip,
  type LayerWeights,
  EASING,
  DEFAULT_LAYER_WEIGHTS,
} from './BehaviorTypes';

// ─── Built-in clips (extend by appending; never mutate existing entries) ─────

/**
 * EXAMPLE GESTURE — wave.
 *
 * Right hand raises and waves left/right at the wrist.  Bone deltas are
 * additive Euler radians.  Envelope (0..1) scales the deltas, so the whole
 * motion is non-destructive.
 */
const WAVE_CLIP: GestureClip = {
  id: 'wave',
  defaultDuration: { blendIn: 240, hold: 1400, blendOut: 720 },
  defaultEasing:   EASING.easeInOut,
  bones: {
    rightShoulder: { rx:  0.00, ry:  0.00, rz: -0.18 },
    rua:           { rx: -1.10, ry: -0.10, rz: -0.55 }, // raise upper arm
    rla:           { rx:  0.00, ry:  0.00, rz: -0.85 }, // bend elbow
    rh:            { rx:  0.00, ry:  0.00, rz: -0.10 }, // wrist neutral
  },
};

const _CLIPS: Record<BehaviorActionType, GestureClip> = {
  wave: WAVE_CLIP,
  // Other ids fall through to behaviorTimeline (no bone-delta clip required —
  // the existing intent / motor stack handles them).  Add clip definitions
  // here as you migrate gestures into the orchestrator.
  explain: { id: 'explain', defaultDuration: { blendIn: 200, hold: 2200, blendOut: 400 }, defaultEasing: EASING.easeInOut, bones: {} },
  point:   { id: 'point',   defaultDuration: { blendIn: 220, hold: 1800, blendOut: 380 }, defaultEasing: EASING.easeInOut, bones: {} },
  think:   { id: 'think',   defaultDuration: { blendIn: 280, hold: 2200, blendOut: 520 }, defaultEasing: EASING.easeInOut, bones: {} },
  agree:   { id: 'agree',   defaultDuration: { blendIn: 180, hold:  900, blendOut: 220 }, defaultEasing: EASING.easeInOut, bones: {} },
  clap:    { id: 'clap',    defaultDuration: { blendIn: 160, hold: 1400, blendOut: 240 }, defaultEasing: EASING.easeInOut, bones: {} },
  idle:    { id: 'idle',    defaultDuration: { blendIn:   0, hold:    0, blendOut:   0 }, defaultEasing: EASING.linear,    bones: {} },
};

export function getClip(type: BehaviorActionType): Readonly<GestureClip> {
  return _CLIPS[type] ?? _CLIPS.idle;
}

// ─── Module-scope scratch (NO per-frame allocations) ─────────────────────────

const _GESTURE_POSE: ComposerBonePoseMap = new Map();
const _Q_TMP = new THREE.Quaternion();
const _E_TMP = new THREE.Euler(0, 0, 0, 'YXZ');

/** Empty maps reused for `blendPoseLayers` slots we do not write. */
const _EMPTY_COLLISION: ComposerBonePoseMap = new Map();
const _EMPTY_VRMA:      ComposerBonePoseMap = new Map();

/** Reused snapshot — one allocation total, mutated in-place each frame. */
const _SNAPSHOT: BehaviorFrameSnapshot = {
  action: null,
  globalT: 0,
  envelope: 0,
  segment: 'idle',
};

// ─── Active action mirror (kept alongside behaviorTimeline._current) ────────
//
// We keep our own typed `BehaviorAction` mirror because the existing engine
// stores its own `BehaviorEvent` shape.  The mirror is read-only for callers
// and is updated atomically in `enqueue()` and on event completion in
// `tickBehaviorOrchestrator`.

let _activeAction: BehaviorAction | null = null;

// ─── Public: enqueue ─────────────────────────────────────────────────────────

/**
 * Enqueue a behavior action.  Returns a frozen copy of the materialised
 * action (with `startTime` filled in if the caller passed 0).  Higher
 * `priority` preempts the running action via `behaviorTimeline.pushBehavior`.
 */
export function enqueueBehaviorAction(
  partial:
    | (Omit<BehaviorAction, 'startTime' | 'duration' | 'blendIn' | 'hold' | 'blendOut'> &
        Partial<Pick<BehaviorAction, 'startTime' | 'duration' | 'blendIn' | 'hold' | 'blendOut'>>),
): Readonly<BehaviorAction> {
  const clip = getClip(partial.type);
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const blendIn  = partial.blendIn  ?? clip.defaultDuration.blendIn;
  const hold     = partial.hold     ?? clip.defaultDuration.hold;
  const blendOut = partial.blendOut ?? clip.defaultDuration.blendOut;
  const duration = partial.duration ?? (blendIn + hold + blendOut);

  const action: BehaviorAction = {
    type:           partial.type,
    startTime:      partial.startTime && partial.startTime > 0 ? partial.startTime : now,
    duration,
    blendIn,
    hold,
    blendOut,
    easingFunction: partial.easingFunction ?? clip.defaultEasing,
    intensity:      partial.intensity ?? 1,
    priority:       partial.priority ?? 100,
    source:         partial.source,
  };

  // Bridge to existing timeline — it owns the queue + phase machine.
  pushBehavior(action.type as TimelineGestureId, action.startTime, {
    baseDurationMs: action.duration,
    intensity:      action.intensity,
    priority:       action.priority,
    source:         action.source,
  });

  _activeAction = action;
  return Object.freeze({ ...action });
}

// ─── Public: tick (deltaTime-based, no setTimeout) ───────────────────────────

/**
 * Advance the timeline by one frame.  Mutates `_SNAPSHOT` in-place and
 * returns it (read-only view).  Call exactly once per frame, BEFORE
 * `composeGestureLayer` and `composeLayeredPose`.
 */
export function tickBehaviorOrchestrator(
  input: BehaviorTickInput,
): Readonly<BehaviorFrameSnapshot> {
  const { now } = input;

  // 1. Advance the underlying engine (handles preemption + queue + emotion).
  const ev: BehaviorFrame = tickBehaviorTimeline(now);

  // 2. Sync the active-action mirror.
  const cur: BehaviorEvent | null = getCurrentBehavior();
  if (!cur) {
    _activeAction = null;
    _SNAPSHOT.action = null;
    _SNAPSHOT.globalT = 0;
    _SNAPSHOT.envelope = 0;
    _SNAPSHOT.segment = 'idle';
    return _SNAPSHOT;
  }
  if (!_activeAction || _activeAction.startTime !== cur.startTime) {
    // Engine started something we did not enqueue (or the event was preempted
    // to one further down our queue) — synthesise a matching action.
    const clip = getClip(cur.type as BehaviorActionType);
    _activeAction = {
      type:           cur.type as BehaviorActionType,
      startTime:      cur.startTime,
      duration:       cur.duration,
      blendIn:        clip.defaultDuration.blendIn,
      hold:           clip.defaultDuration.hold,
      blendOut:       clip.defaultDuration.blendOut,
      easingFunction: clip.defaultEasing,
      intensity:      cur.intensity,
      priority:       cur.priority,
      source:         cur.source,
    };
  }

  // 3. Compute envelope from the **action's** blendIn / hold / blendOut so
  //    the orchestrator obeys the user-supplied phasing exactly.  We do NOT
  //    use `behaviorTimeline.envelope` here — it is reserved for downstream
  //    polarity / inertia overlays.
  const a = _activeAction;
  const elapsed = Math.max(0, now - a.startTime);
  const ease = a.easingFunction ?? EASING.easeInOut;
  let envelope = 0;
  let segment: BehaviorFrameSnapshot['segment'] = 'idle';

  if (elapsed < a.blendIn) {
    segment  = 'blendIn';
    const u  = a.blendIn > 0 ? elapsed / a.blendIn : 1;
    envelope = ease(u);
  } else if (elapsed < a.blendIn + a.hold) {
    segment  = 'hold';
    envelope = 1;
  } else if (elapsed < a.duration) {
    segment  = 'blendOut';
    const u  = a.blendOut > 0 ? (elapsed - a.blendIn - a.hold) / a.blendOut : 1;
    envelope = 1 - ease(u);
  } else {
    segment  = 'idle';
    envelope = 0;
  }

  envelope *= a.intensity ?? 1;
  if (envelope < 0) envelope = 0;
  else if (envelope > 1) envelope = 1;

  _SNAPSHOT.action = a;
  _SNAPSHOT.globalT = a.duration > 0 ? Math.min(1, elapsed / a.duration) : 1;
  _SNAPSHOT.envelope = envelope;
  _SNAPSHOT.segment = segment;

  // Use the engine's own frame to keep tooling on `__behaviorTimeline` alive.
  void computeBehaviorFrame(ev.event, now);

  return _SNAPSHOT;
}

// ─── Public: gesture-layer pose composition (Layer 2) ────────────────────────

/**
 * Build the gesture layer's bone-quaternion map from the active clip and
 * envelope.  Reuses `_GESTURE_POSE` (cleared in-place) — no per-frame
 * allocations.
 *
 *   • Bones not present in the clip remain absent → caller's Layer 0/1
 *     output drives them (or LVP carries them forward in PoseComposer).
 *   • Quaternions are written once per bone using the YXZ Euler scratch.
 */
export function composeGestureLayer(
  bindPose: ComposerBonePoseMap,
  snap: Readonly<BehaviorFrameSnapshot>,
): ComposerBonePoseMap {
  // Rapid clear: drop entries from previous frame so caller sees only writers.
  for (const k of _GESTURE_POSE.keys()) _GESTURE_POSE.delete(k);

  const action = snap.action;
  if (!action || snap.envelope <= 1e-4) return _GESTURE_POSE;

  const clip = getClip(action.type);
  const env = snap.envelope;

  for (const k in clip.bones) {
    const d = clip.bones[k as keyof typeof clip.bones];
    if (!d) continue;

    // Bone target = bind * eulerDelta * envelope (additive, never destructive).
    const bind = bindPose.get(k);
    _E_TMP.set(d.rx * env, d.ry * env, d.rz * env, 'YXZ');
    _Q_TMP.setFromEuler(_E_TMP);
    if (bind) {
      // Reuse the previous value on this map to avoid allocations.
      let stored = _GESTURE_POSE.get(k);
      if (!stored) {
        stored = new THREE.Quaternion();
        _GESTURE_POSE.set(k, stored);
      }
      stored.copy(bind).multiply(_Q_TMP).normalize();
    } else {
      let stored = _GESTURE_POSE.get(k);
      if (!stored) {
        stored = new THREE.Quaternion();
        _GESTURE_POSE.set(k, stored);
      }
      stored.copy(_Q_TMP).normalize();
    }
  }

  return _GESTURE_POSE;
}

// ─── Public: layered pose composition (delegates to PoseComposer) ────────────

/**
 * Final layer merge.  Wraps `PoseComposer.blendPoseLayers` so callers see
 * a 4-layer mental model (idle / procedural / gesture / viseme) without
 * needing to know the underlying 5-slot signature.
 *
 *   • Viseme is a facial-morph layer; it never writes bone quaternions, so
 *     it has no slot here.  Pass viseme weights to `LipSyncManager` directly.
 *   • Last-Valid-Pose carry / decay / fail-safe is owned by `PoseComposer`
 *     — when a layer fails to produce a value for a bone, the prior valid
 *     quaternion is reused; we never snap to bind unless the LVP budget +
 *     decay window both expire.
 */
export function composeLayeredPose(input: ComposeLayersInput): ComposerBonePoseMap {
  const w: LayerWeights = {
    ...DEFAULT_LAYER_WEIGHTS,
    ...(input.weights ?? {}),
  };

  // Slot mapping: PoseComposer takes (idle, generative, gesture, collision, vrma).
  // We expose (idle, procedural, gesture, viseme); procedural → generative,
  // viseme is non-bone (ignored at this layer).
  return blendPoseLayers({
    bind:       input.bind,
    idle:       input.idle,
    generative: input.procedural,
    gesture:    _GESTURE_POSE,
    collision:  _EMPTY_COLLISION,
    vrma:       _EMPTY_VRMA,
    weights: {
      idle:       w.idle,
      generative: w.procedural,
      gesture:    w.gesture,
      collision:  0,
      vrma:       0,
    },
  });
}

// ─── Public: debug surface ───────────────────────────────────────────────────

export function getOrchestratorDebug(): Readonly<{
  active: Readonly<BehaviorAction> | null;
  snap:   Readonly<BehaviorFrameSnapshot>;
  clipsRegistered: number;
}> {
  return {
    active: _activeAction ? Object.freeze({ ..._activeAction }) : null,
    snap:   _SNAPSHOT,
    clipsRegistered: Object.keys(_CLIPS).length,
  };
}
