/**
 * avatar.ts — Centralised avatar configuration.
 *
 * VRM_FALLBACKS is tried in order by loadVrmWithFallback() inside AvatarCanvas.
 * Set NEXT_PUBLIC_AVATAR_VRM_URL in .env.local to override the primary model
 * without touching source code.
 *
 * Feature flags — all default OFF so experimental code is never active in prod.
 */

// ── VRM URL chain ─────────────────────────────────────────────────────────────
export const VRM_FALLBACKS: readonly string[] = [
  ...(
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_AVATAR_VRM_URL?.trim()
      ? [process.env.NEXT_PUBLIC_AVATAR_VRM_URL.trim()]
      : []
  ),
  '/models/teach.vrm?v=hips-fix', // PRIMARY — VRM 0.x, hips quaternion reset
];

/** Returns the primary VRM URL. All components must call this — never hardcode paths. */
export function pickVrmUrl(): string {
  return '/models/teach.vrm?v=hips-fix';
}

// ── Feature flags ─────────────────────────────────────────────────────────────

/** Inverse kinematics for arm pointing. Default OFF — heavy, requires three-ik. */
export const USE_IK =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_IK === 'true';

/** Use device camera for gaze targeting (requires user consent). Default OFF. */
export const USE_CAMERA_GAZE =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_CAMERA_GAZE === 'true';

/** Viseme prediction (lookahead). Default OFF — may cause mouth-pop artefacts. */
export const USE_VISEME_PREDICT =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_VISEME_PREDICT === 'true';

/**
 * MIME mode — bypass all browser/API TTS; simulate speaking duration from text length
 * (~65 ms/char) for gesture/expression testing without audio latency or failures.
 * Set `true` locally when debugging motion; keep `false` in production builds.
 */
export const ENABLE_MIME_MODE = false;

// ── Humanization tuning ───────────────────────────────────────────────────────

/** Respiratory rate (Hz) — ~13 breaths/min at 0.22 */
export const BREATHE_BASE_HZ  = 0.22;
/** @deprecated Prefer BREATHE_AMP_STANDING / BREATHE_AMP_SITTING + proceduralLife */
export const BREATHE_BASE_AMP = 0.022;
/** Second harmonic multiplier on top of BREATHE_HZ (legacy spine layer) */
export const BREATHE_HARMONIC = 1.60;

/** V20 — alias for breathing frequency */
export const BREATHE_HZ = BREATHE_BASE_HZ;
/** V20 — spine / chest procedural amplitude (radians-scale) */
export const BREATHE_AMP_STANDING = 0.012;
export const BREATHE_AMP_SITTING  = 0.006;
/** V20 — weight of second harmonic (less mechanical breathing) */
export const BREATHE_HARMONIC_STRENGTH = 0.3;
/** V20 — second harmonic frequency multiplier (not the old BREATHE_HARMONIC name clash) */
export const BREATHE_HARMONIC_FREQ = 2.1;
/** V20 — tiny world-space Y bounce on avatar group (before physics resolve) */
export const BREATHE_GROUP_BOUNCE_M = 0.002;

/** V20 — slow weight-shift on X (metres, peak) */
export const WEIGHT_SHIFT_AMP_STANDING = 0.012;
export const WEIGHT_SHIFT_AMP_SITTING   = 0.004;
/** V20 — long-cycle head roll bias (rad), toggled ~1 min */
export const LONG_HEAD_TILT_RAD = 0.02;
/** V20 — shoulder asymmetry (rad) applied to upper-arm Z */
export const SHOULDER_DROP_RAD = 0.022;
/** V20 — idle foot yaw wiggle (rad, peak) */
export const FOOT_IDLE_YAW_RAD = 0.014;
/** V20 — micro-expression idle interval (ms) */
/** V29 — idle micro-expressions every ~6–12 s */
export const MICRO_EXPR_MIN_MS = 6_000;
export const MICRO_EXPR_MAX_MS = 12_000;

/** V30 — idle VRMA swap cadence (standing / seated subtle motion) */
export const IDLE_VRMA_MIN_MS = 10_000;
export const IDLE_VRMA_MAX_MS = 15_000;
/** V30 — multiply procedural life layers while a VRMA gesture clip is playing (0–1) */
export const PROC_LIFE_DURING_VRMA_GESTURE = 0.52;
/** V30 — clap / cheer temporary elbow spread multiplier duration (ms) */
export const HAND_SEPARATION_PULSE_MS = 520;
/** V30 — require this much calm idle time before first auto micro-gesture */
export const IDLE_MICRO_GESTURE_MIN_MS = 5_000;
/** V30 — cooldown between auto micro-gestures */
export const IDLE_MICRO_GESTURE_COOLDOWN_MIN_MS = 8_000;
export const IDLE_MICRO_GESTURE_COOLDOWN_MAX_MS = 14_000;

/** Per-emotion breathing modulation { hz, amp } */
export const EMOTION_BREATHE: Readonly<Record<string, { hz: number; amp: number }>> = {
  angry:   { hz: 3.0, amp: 0.030 },
  excited: { hz: 2.5, amp: 0.028 },
  sad:     { hz: 1.2, amp: 0.015 },
  calm:    { hz: 0.9, amp: 0.012 },
  relax:   { hz: 0.9, amp: 0.012 },
};

/** Subconscious life — human-like blink spacing (~3–7 s). */
export const BLINK_MIN_SEC     = 3.0;
export const BLINK_MAX_SEC     = 7.0;
export const BLINK_DURATION_MS = 160;
export const PARTIAL_BLINK_CHANCE = 0.25;  // 25 % of blinks are partial (70 % closure)

export const SACCADE_AMP_M        = 0.012; // ±12 mm look-at jitter
/** Fixation hold between saccades when idle (ms) — 2–5 s feels less “darting robot”. */
export const GAZE_FIXATE_IDLE_MIN_MS = 2000;
export const GAZE_FIXATE_IDLE_MAX_MS = 5000;
export const SACCADE_IDLE_HZ      = 0.5;  // update freq while idle
export const SACCADE_SPEAK_HZ     = 0.25; // slower while speaking
export const SACCADE_LISTEN_HZ    = 1.0;  // faster while listening

/** Natural reply delay (ms) before TTS starts. Sampled uniformly in [min,max]. */
export const REPLY_DELAY_MIN_MS = 500;
export const REPLY_DELAY_MAX_MS = 1500;

// ── WS / voice protocol constants ─────────────────────────────────────────

/** Timeout (ms) for a single STT/WS round-trip before retry. */
export const REQ_TIMEOUT_MS = 5_000;

/** Max STT retries on network failure (0 = no retry). */
export const MAX_STT_RETRY = 1;

/** WS heartbeat period in seconds — must match HEARTBEAT_INTERVAL_SEC in backend/.env */
export const HEARTBEAT_INTERVAL_SEC = 15;

/** Consecutive TTS failures before circuit opens and falls back to text-only mode. */
export const TTS_CIRCUIT_BREAKER_THRESHOLD = 2;

/** Seconds the TTS circuit breaker stays open before auto-closing. */
export const TTS_COOLDOWN_SEC = 60;

// ── WS protocol version ───────────────────────────────────────────────────────

/** WS protocol version stamped on all outgoing frames. */
export const WS_PROTOCOL_VERSION = 1.1;

// ── Proactive silence timings ─────────────────────────────────────────────────

/** Ms of user silence before avatar dispatches a minor idle gesture. */
export const PROACTIVE_GESTURE_MS = 20_000;

/** Ms of user silence before avatar sends a proactive question via WS. */
export const PROACTIVE_QUESTION_MS = 30_000;

// ── Locomotion (Checkpoint #40 — AvatarCanvas `onWalk` + §8 + clap separation) ─
export const WALK_SPEED_MPS = 1.2;
export const WALK_STEP_DURATION = 0.6;
export const WALK_CYCLE_RAD_PER_S = 3.8;
export const WALK_DEFAULT_DISTANCE_METERS = 2.0;
export const WALK_WRIST_MIN_SEP_M = 0.15;

// ── Rapier / avatar-environment physics (AvatarCanvas + WorldColliders) ─────

/** Tuning for Rapier world, character capsule, and static furniture colliders. */
export const PHYSICS_CONFIG = {
  gravity: [0, -9.81, 0] as const,
  avatar: {
    mass: 70,
    friction: 0.5,
    restitution: 0.2,
    capsuleRadius: 0.3,
    /** Total capsule length along Y (segment + spherical caps — see rapierColliders). */
    capsuleHeight: 1.6,
  },
  environment: {
    friction: 0.7,
    restitution: 0.1,
  },
  layers: {
    AVATAR: 0b0001,
    DESK: 0b0010,
    CHAIR: 0b0100,
    FLOOR: 0b1000,
  },
} as const;
