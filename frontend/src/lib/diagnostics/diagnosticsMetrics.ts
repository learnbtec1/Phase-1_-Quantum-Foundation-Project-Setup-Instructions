/**
 * Hot-path metric indices — use only with {@link diagInc}.
 * Keep contiguous 0..METRIC_COUNT-1 for Uint32Array backing store.
 */
export const METRIC_COUNT = 48;

export const DM = {
  // Level 1 — pose / quaternion
  INVALID_QUAT_SAMPLE: 0,
  NAN_ROTATION_SAMPLE: 1,
  ZERO_LENGTH_QUAT: 2,
  NORMALIZE_FAILURE: 3,
  NULL_BONE_WRITE_SKIP: 4,
  MISSING_HUMANOID: 5,
  BIND_FALLBACK_USED: 6,
  BLEND_EMPTY_OUTPUT: 7,

  // Authority / overwrite heuristics
  IDLE_OVERWRITE_GESTURE: 8,
  GESTURE_WEIGHT_COLLAPSE: 9,
  AUTHORITY_CONFLICT: 10,

  // Scheduler
  SCHED_BLOCKED_MIN_BETWEEN: 11,
  SCHED_BLOCKED_RECENT_ACTION: 12,
  SCHED_BLOCKED_VRMA: 13,
  SCHED_BLOCKED_THINKING: 14,
  SCHED_BLOCKED_IDLE_RANDOM: 15,
  SCHED_DISPATCH_OK: 16,

  // Semantic / bridge
  SEMANTIC_COOLDOWN_STARVE: 17,
  SEMANTIC_IDLE_FALLBACK: 18,

  // Timeline / embodiment (deep queue = scheduling back-pressure)
  TIMELINE_QUEUE_BACKLOG: 19,
  TIMELINE_SNAP_SHORT_EVENT: 20,

  // Energy / speech
  ENERGY_SPEAKING_ZERO_RAW: 21,
  ENERGY_STABLE_NAN_GUARD: 22,

  // Intent
  INTENT_EMPTY_INPUT: 23,
  INTENT_NO_RULE_MATCH: 24,

  // Runtime
  EXCEPTION_CAPTURED: 25,
  SAFE_CALL_FAILURE: 26,

  // VRM apply
  APPLY_FINAL_GRAB_HUMANOID_FAIL: 27,

  // Mid / high level aggregates (incremented only on flush logic, optional)
  VISUALLY_INVISIBLE_GESTURE: 28,
  MOTION_COLLAPSE: 29,
} as const;

export type DiagnosticMetricKey = keyof typeof DM;
