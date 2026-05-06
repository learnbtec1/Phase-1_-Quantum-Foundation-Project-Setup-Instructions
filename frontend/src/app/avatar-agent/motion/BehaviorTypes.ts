'use client';
/**
 * BehaviorTypes — public surface for the layered, deltaTime-driven behavior
 * timeline that sits on top of the existing motion pipeline (`behaviorTimeline`,
 * `PoseComposer`, `gestureLibrary`).
 *
 * Design contract
 * ───────────────────────────────────────────────────────────────────────────
 *   • All time values are in **milliseconds** and are accumulated externally —
 *     consumers feed `deltaSec` into the orchestrator each frame, never call
 *     `setTimeout` to schedule motion.
 *   • Quaternions are produced as `Map<string, THREE.Quaternion>` (re-used
 *     module-scope in the orchestrator → zero per-frame allocations).
 *   • Easing functions take a normalized 0..1 input and return 0..1.
 *   • Bone keys are the short canonical aliases used by `PoseComposer`
 *     (`hips`, `spine`, `chest`, `neck`, `head`, `lua`, `rua`, `lla`, `rla`,
 *     `lh`, `rh`, `leftShoulder`, `rightShoulder`, …).
 */

import * as THREE from 'three';

// ─── Bone alias / pose map (mirrors PoseComposer types) ──────────────────────

export type BoneKey = string; // canonical short alias (`rua`, `lua`, `head`, …)
export type BonePoseMap = Map<BoneKey, THREE.Quaternion>;

// ─── Easing ──────────────────────────────────────────────────────────────────

export type EasingFunction = (t: number) => number;

export const EASING: Readonly<Record<string, EasingFunction>> = {
  linear:       (t) => t,
  easeInQuad:   (t) => t * t,
  easeOutQuad:  (t) => t * (2 - t),
  easeInOut:    (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInCubic:  (t) => t * t * t,
  /** Bell shape (0 → 1 → 0). Useful for one-shot gestures. */
  sineBell:     (t) => Math.sin(Math.PI * t),
};

// ─── Behavior action — the public, ergonomic shape requested in the spec ─────

/** Discriminated set of recognised behaviors. Extend the orchestrator clip
 *  registry to add new ones — never wire them via raw strings outside it. */
export type BehaviorActionType =
  | 'wave'
  | 'explain'
  | 'point'
  | 'think'
  | 'agree'
  | 'clap'
  | 'idle';

export interface BehaviorAction {
  type:     BehaviorActionType;
  /** `performance.now()` ms when the action becomes active.  If omitted on
   *  enqueue, the orchestrator fills it with the current monotonic clock. */
  startTime: number;
  /** Total wall-clock duration in ms (blendIn + hold + blendOut). */
  duration:  number;
  /** Ramp-in time in ms (envelope rises 0 → 1, eased). */
  blendIn:   number;
  /** Hold time in ms (envelope stays at 1). */
  hold:      number;
  /** Ramp-out time in ms (envelope falls 1 → 0, eased). */
  blendOut:  number;
  /** Easing curve applied to envelope (default: easeInOut). */
  easingFunction?: EasingFunction;
  /** 0..1 amplitude scalar (gets multiplied into the envelope). Default 1. */
  intensity?: number;
  /** Higher priority preempts a running lower-priority action. */
  priority?: number;
  /** Free-form label for diagnostics. */
  source?: string;
}

// ─── Layer model (4 layers, weighted blend, non-destructive) ─────────────────

export type LayerName = 'idle' | 'procedural' | 'gesture' | 'viseme';

export interface LayerWeights {
  idle:       number; // 0..1 — base posture
  procedural: number; // 0..1 — lookAt, breathing, micro presence
  gesture:    number; // 0..1 — current behavior timeline action
  viseme:     number; // 0..1 — face only (does not write bone quats)
}

export const DEFAULT_LAYER_WEIGHTS: Readonly<LayerWeights> = {
  idle:       1.0,
  procedural: 0.55,
  gesture:    1.0,
  viseme:     1.0,
};

// ─── Frame snapshot the orchestrator returns each tick ───────────────────────

export interface BehaviorFrameSnapshot {
  /** Active action, or null when idle.                                       */
  action: BehaviorAction | null;
  /** 0..1 normalized progress through the *whole* action.                    */
  globalT: number;
  /** Effective amplitude envelope (0..1, easing-applied).                    */
  envelope: number;
  /** Currently inside which segment.                                         */
  segment: 'idle' | 'blendIn' | 'hold' | 'blendOut';
}

// ─── Clip definition — bone deltas in *radians*, consumed by orchestrator ───

export interface GestureClip {
  /** Stable id (matches `BehaviorActionType` for built-ins). */
  id: BehaviorActionType;
  /** Default duration / phasing in ms, used when the action does not specify. */
  defaultDuration: { blendIn: number; hold: number; blendOut: number };
  /** Default easing, used when the action does not specify.                  */
  defaultEasing:   EasingFunction;
  /** Per-bone Euler delta (radians, YXZ order) at full envelope (env = 1).   */
  bones: Partial<Record<BoneKey, { rx: number; ry: number; rz: number }>>;
}

// ─── Orchestrator I/O contract ───────────────────────────────────────────────

export interface BehaviorTickInput {
  /** Monotonic clock in ms (`performance.now()`).                            */
  now: number;
  /** Frame delta in seconds (clamped by the caller).                         */
  deltaSec: number;
}

export interface ComposeLayersInput {
  /** Avatar bind pose (normalized humanoid) — last-valid-pose anchor.        */
  bind: BonePoseMap;
  /** Pose written by the idle stack this frame.                              */
  idle: BonePoseMap;
  /** Pose written by procedural layers (lookAt, breathing, presence).        */
  procedural: BonePoseMap;
  /** Optional weight overrides this frame.                                   */
  weights?: Partial<LayerWeights>;
}
