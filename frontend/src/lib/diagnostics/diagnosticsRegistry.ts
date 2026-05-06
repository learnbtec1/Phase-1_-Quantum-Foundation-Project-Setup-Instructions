/**
 * Central registry: resolves numeric ids to strings at flush time only.
 * Call sites pass numeric constants — no string literals on hot paths.
 */

import { DM } from './diagnosticsMetrics';

export const SUBSYSTEM = {
  UNKNOWN: 0,
  MOTION: 1,
  VRM: 2,
  SCHEDULER: 3,
  SPEECH: 4,
  TIMELINE: 5,
  SEMANTIC: 6,
  INTENT: 7,
  POSE: 8,
  BIOMECH: 9,
  EXECUTION: 10,
  R3F: 11,
} as const;

export const STAGE = {
  NONE: 0,
  BLEND_POSE: 1,
  APPLY_FINAL: 2,
  HUMANOID_1: 3,
  BIOMECH: 4,
  HUMANOID_2: 5,
  SCHEDULER_TICK: 6,
  TIMELINE_TICK: 7,
  SEMANTIC_RESOLVE: 8,
  ENERGY_TICK: 9,
} as const;

/** File hints for approximate tracing (update lineHint at instrumentation sites periodically). */
export const FILE_ID = {
  UNKNOWN: 0,
  VRMSkeletonManager: 1,
  PoseComposer: 2,
  biomechanicalCorrectionLayer: 3,
  motionScheduler: 4,
  semanticGestureBridge: 5,
  behaviorTimeline: 6,
  unifiedEnergyModel: 7,
  intentClassifier: 8,
  AvatarCanvas: 9,
} as const;

const SUBSYSTEM_LABEL: Record<number, string> = {
  0: 'unknown',
  1: 'motion',
  2: 'vrm',
  3: 'scheduler',
  4: 'speech',
  5: 'timeline',
  6: 'semantic',
  7: 'intent',
  8: 'pose',
  9: 'biomech',
  10: 'execution',
  11: 'r3f',
};

const STAGE_LABEL: Record<number, string> = {
  0: 'none',
  1: 'blendPoseLayers',
  2: 'applyFinalPoseToVrm',
  3: 'humanoid.update:1',
  4: 'applyBiomechanicalLayer',
  5: 'humanoid.update:2',
  6: 'schedulerTick',
  7: 'tickBehaviorTimeline',
  8: 'resolveSemanticGesture',
  9: 'tickUnifiedEnergy/tickStableMotionEnergy',
};

const FILE_LABEL: Record<number, string> = {
  0: 'unknown',
  1: 'VRMSkeletonManager.tsx',
  2: 'PoseComposer.ts',
  3: 'biomechanicalCorrectionLayer.ts',
  4: 'motionScheduler.ts',
  5: 'semanticGestureBridge.ts',
  6: 'behaviorTimeline.ts',
  7: 'unifiedEnergyModel.ts',
  8: 'intentClassifier.ts',
  9: 'AvatarCanvas.tsx',
};

export function resolveSubsystem(id: number): string {
  return SUBSYSTEM_LABEL[id] ?? `subsystem:${id}`;
}

export function resolveStage(id: number): string {
  return STAGE_LABEL[id] ?? `stage:${id}`;
}

export function resolveFile(id: number): string {
  return FILE_LABEL[id] ?? `file:${id}`;
}

/** Dependency graph: parent root cause → contributing signals (metric indices). */
export const ROOT_GRAPH: ReadonlyArray<{
  id: string;
  severity: number;
  summary: string;
  whenMetricAboveZero: readonly number[];
  children: readonly string[];
}> = [
  {
    id: 'gestureFailure',
    severity: 2,
    summary: 'Gesture pipeline likely failed or was visually suppressed',
    whenMetricAboveZero: [DM.GESTURE_WEIGHT_COLLAPSE, DM.IDLE_OVERWRITE_GESTURE, DM.INVALID_QUAT_SAMPLE],
    children: ['schedulerBlocked', 'semanticStarvation', 'invalidQuaternion', 'authorityConflict'],
  },
  {
    id: 'schedulerBlocked',
    severity: 1,
    summary: 'Motion scheduler did not dispatch (gate / cooldown / VRMA)',
    whenMetricAboveZero: [
      DM.SCHED_BLOCKED_MIN_BETWEEN,
      DM.SCHED_BLOCKED_RECENT_ACTION,
      DM.SCHED_BLOCKED_VRMA,
      DM.SCHED_BLOCKED_THINKING,
      DM.SCHED_BLOCKED_IDLE_RANDOM,
    ],
    children: [],
  },
  {
    id: 'semanticStarvation',
    severity: 1,
    summary: 'Semantic bridge returned idle or cooldown blocked gestures',
    whenMetricAboveZero: [DM.SEMANTIC_COOLDOWN_STARVE, DM.SEMANTIC_IDLE_FALLBACK],
    children: [],
  },
  {
    id: 'invalidQuaternion',
    severity: 3,
    summary: 'Invalid quaternion propagation detected in pose/apply path',
    whenMetricAboveZero: [
      DM.INVALID_QUAT_SAMPLE,
      DM.NAN_ROTATION_SAMPLE,
      DM.ZERO_LENGTH_QUAT,
      DM.NORMALIZE_FAILURE,
    ],
    children: [],
  },
  {
    id: 'authorityConflict',
    severity: 2,
    summary: 'Layer authority / overwrite heuristic fired',
    whenMetricAboveZero: [DM.AUTHORITY_CONFLICT, DM.IDLE_OVERWRITE_GESTURE],
    children: [],
  },
  {
    id: 'speechMotionDesync',
    severity: 2,
    summary: 'Speaking with collapsed energy — motion may desync from TTS',
    whenMetricAboveZero: [DM.ENERGY_SPEAKING_ZERO_RAW],
    children: [],
  },
];
