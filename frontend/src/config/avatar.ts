/**
 * avatar.ts — Centralised avatar configuration.
 *
 * VRM_FALLBACKS is tried in order by loadVrmWithFallback() inside AvatarCanvas.
 * Set NEXT_PUBLIC_AVATAR_VRM_URL in .env.local to override the primary model
 * without touching source code.
 *
 * Primary on-disk model: `public/models/cogni-avatar.vrm` (Linux case-sensitive). Aliases below for other exports.
 *
 * Feature flags — all default OFF so experimental code is never active in prod.
 */

/** Env override or null — single source for URL chain + pickVrmUrl. */
function primaryVrmUrlFromEnv(): string | null {
  if (typeof process === 'undefined') return null;
  const v = process.env.NEXT_PUBLIC_AVATAR_VRM_URL?.trim();
  return v || null;
}

// ── VRM URL chain ─────────────────────────────────────────────────────────────
export const VRM_FALLBACKS: readonly string[] = [
  ...(primaryVrmUrlFromEnv() ? [primaryVrmUrlFromEnv()!] : []),
  '/models/cogni-avatar.vrm', // PRIMARY — actual filename on disk (Docker/Linux)
  '/models/Cogni-AVatar.vrm', // alias if asset shipped with this casing
];

/** Returns the primary VRM URL (must match first non-env entry in `VRM_FALLBACKS`). */
export function pickVrmUrl(): string {
  return primaryVrmUrlFromEnv() ?? '/models/cogni-avatar.vrm';
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
 *
 * ── Production lock (V110.1) ──────────────────────────────────────────────
 * • PRODUCTION: always false, regardless of any localStorage override.
 * • DEVELOPMENT: false by default; auto-enabled only after /health/tts fails
 *   (see tts.ts → _tryEnableMimeFallback).
 *   Manual kill-switch: localStorage.setItem('MIME_MODE','0') → stays off.
 *   Manual force-on:    localStorage.setItem('MIME_MODE','1') → stays on (dev only).
 * Call getMimeMode() at runtime — do NOT read ENABLE_MIME_MODE as a static bool.
 */
export const ENABLE_MIME_MODE = false;  // static default — always false at module init

/** Whether the dev health-check has determined Azure is unreachable this session. */
let _mimeModeDynamic = false;

/**
 * Set MIME_MODE on (dev only) after health check determines Azure TTS is unreachable.
 * No-op in production.
 */
export function enableMimeFallback(): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  _mimeModeDynamic = true;
}

/**
 * Runtime MIME_MODE gate — call this in handlers instead of reading ENABLE_MIME_MODE.
 *
 * Returns true ONLY when:
 *   1. NODE_ENV === 'development'           (never true in production)
 *   2. Dynamic flag is on (health check failed) OR localStorage 'MIME_MODE' === '1'
 *   3. localStorage 'MIME_MODE' !== '0'    (user kill-switch respected)
 */
export function getMimeMode(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return false;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem('MIME_MODE');
    if (stored === '0') return false;   // explicit user kill-switch
    if (stored === '1') return true;    // explicit user force-on (dev only)
  }
  return _mimeModeDynamic;
}

// ── TTS Endpoint URLs (V110.1) ────────────────────────────────────────────────
// NEXT_PUBLIC_API_BASE must be set in Compose/env for cross-origin setups.
// Falls back to '' (empty) → uses Next.js rewrites or direct relative paths.
const _API_BASE: string = (() => {
  if (typeof process === 'undefined') return '';
  return (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
})();

/** Live Azure TTS health — GET → {ok, provider, voice, len, avg_latency_ms} */
export const TTS_HEALTH_URL = `${_API_BASE}/health/tts`;
/** Direct Azure WAV synthesis — POST {text, voice?, type?} → audio/wav */
export const TTS_SPEAK_URL  = `${_API_BASE}/tts/speak`;

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

// ── V52 — Cogni-AVatar / multi-VRM calibration (AvatarCanvas runtime + env overrides) ─
// NEXUS V100 / COGNI sub-floor: stand trim 0; rug extra default 0.10 m (override via NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA).

/**
 * Extra Y offset (metres) added **after** automatic foot–floor calibration.
 * Negative = sink slightly; positive = lift. Set in `.env.local` e.g. `-0.03`.
 */
export function readAvatarStandYOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = process.env.NEXT_PUBLIC_AVATAR_STAND_Y_OFFSET?.trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Added to carpet world AABB **max.y** when setting `ROOM_BOUNDS.floorY` (rug walk height).
 * Keeps feet on the upper surface when the logical floor mesh sits below the visible pile, or after backdrop transforms.
 *
 * **Env:** `NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA` (metres). If unset or empty → **default 0.10** (pile / walk surface).
 * Typical tune: **0.06–0.15** after measuring foot–`floorY` gap in dev (see `AvatarCanvas` dev expose + console snippet).
 */
export function readRugWalkSurfaceYExtraEnv(): number {
  const fallback = 0.1;
  if (typeof process === 'undefined') return fallback;
  const v = process.env.NEXT_PUBLIC_RUG_WALK_SURFACE_Y_EXTRA?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Optional override for body yaw base (rad). `Math.PI` = legacy teach; `0` = typical VRM 1.0 forward. Unset = auto from meta. */
export function readAvatarFacingYawBaseEnv(): number | null {
  if (typeof process === 'undefined') return null;
  const v = process.env.NEXT_PUBLIC_AVATAR_FACING_YAW_BASE?.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Multiply spine/chest breathing amplitude when VRM 1.0 meta is detected (subtle boost if motion reads flat). */
export const AVATAR_BREATHE_SCALE_VRM1 = 1.12;

/** Seated upper-leg local X (rad) — VRM 1.0 / A-pose rigs sometimes need slightly less than 1.57. */
export const SIT_UPPER_LEG_X_VRM0 = 1.57;
export const SIT_UPPER_LEG_X_VRM1 = 1.48;
export const SIT_LOWER_LEG_X_SEATED = -1.57;

/** Added to world sit Y when VRM 1.0 meta — tune if hips sit too high/low vs chair. */
export const SIT_WORLD_Y_TRIM_VRM1 = 0;

/**
 * Optional env trim (metres) on seated avatar group Y (after foot calibration).
 * Negative = lower into seat. Composes with `SIT_WORLD_Y_TRIM_VRM1` for VRM1.
 */
export function readAvatarSitWorldYOffsetEnv(): number {
  if (typeof process === 'undefined') return 0;
  const v = process.env.NEXT_PUBLIC_AVATAR_SIT_Y_OFFSET?.trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** V52 — slightly stronger chest motion on newer rigs (composes with `AVATAR_BREATHE_SCALE_VRM1` in canvas). */
export const BREATHE_AMP_STANDING_VRM1 = 0.0135;
export const BREATHE_AMP_SITTING_VRM1 = 0.007;

// ── V53 — placement / visibility diagnostics (opt-in) ─────────────────────────

/**
 * When `NEXT_PUBLIC_AVATAR_DEBUG_FORCE_STAND` is `1` or `true`, seated state is ignored
 * and the avatar stays in standing locomotion (helps verify visibility vs chair offset).
 */
export function readAvatarDebugForceStandEnv(): boolean {
  if (typeof process === 'undefined') return false;
  const v = process.env.NEXT_PUBLIC_AVATAR_DEBUG_FORCE_STAND?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

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
