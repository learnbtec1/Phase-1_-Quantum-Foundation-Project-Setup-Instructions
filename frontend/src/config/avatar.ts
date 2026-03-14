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
  '/models/teach.vrm',   // primary — file exists at frontend/public/models/teach.vrm
  '/models/verona.vrm',  // future slot — place verona.vrm here when ready
];

/** Returns the first URL in the fallback chain. */
export function pickVrmUrl(): string {
  return VRM_FALLBACKS[0] ?? '/models/teach.vrm';
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

// ── Humanization tuning ───────────────────────────────────────────────────────

export const BREATHE_BASE_HZ  = 0.22;   // ~13 breaths / min
export const BREATHE_BASE_AMP = 0.022;  // metres, chest rise
export const BREATHE_HARMONIC = 1.60;   // costal harmonic multiplier

/** Per-emotion breathing modulation { hz, amp } */
export const EMOTION_BREATHE: Readonly<Record<string, { hz: number; amp: number }>> = {
  angry:   { hz: 3.0, amp: 0.030 },
  excited: { hz: 2.5, amp: 0.028 },
  sad:     { hz: 1.2, amp: 0.015 },
  calm:    { hz: 0.9, amp: 0.012 },
  relax:   { hz: 0.9, amp: 0.012 },
};

export const BLINK_MIN_SEC     = 2.2;
export const BLINK_MAX_SEC     = 5.0;
export const BLINK_DURATION_MS = 160;
export const PARTIAL_BLINK_CHANCE = 0.25;  // 25 % of blinks are partial (70 % closure)

export const SACCADE_AMP_M        = 0.012; // ±12 mm look-at jitter
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
