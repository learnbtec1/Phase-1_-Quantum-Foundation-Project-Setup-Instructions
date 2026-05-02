/**
 * Thresholds and coefficients for the predictive stability engine.
 * Tune here only — keeps predictiveEngine.ts logic stable.
 *
 * Example predictions (illustrative, not exhaustive):
 * - lip_warn_eta: lip drift slope >0.35 ms/s and ETA to 40 ms warn band under ~2.5 s
 * - root_drift_rise: root translation slope away from baseline (motion trend)
 * - fps_drop: negative FPS slope or sustained FPS <36 with high variance
 *
 * Warning bands map from confidence (severity × trend × duration):
 * - low → monitor (CAUTION mode, light adaptive)
 * - medium/high → prepare / pre-fix (pre-empt lip nudge, stride bonus, gesture damp)
 */

/** Rolling history window (ms) — ~5–10 s effective at typical notify cadence */
export const PREDICTIVE_HISTORY_MS = 10_000;

/** Max samples retained (ring) — bounds work per tick */
export const PREDICTIVE_MAX_SAMPLES = 120;

/** Lip drift warning / critical (aligned with audioLipSyncMonitor) */
export const LIP_WARN_MS = 40;
export const LIP_CRITICAL_MS = 80;

/** Predict failure if estimated time-to-warning drops below this (seconds) */
export const PREDICT_TIME_TO_WARN_SEC = 2.5;

/** Minimum samples before trend / prediction is considered */
export const MIN_SAMPLES_FOR_TREND = 6;

/** Slope magnitude above this (normalized) counts as “rising instability” */
export const SLOPE_SIGNIFICANT = 0.35;

/** Variance above this on FPS = unstable */
export const FPS_VARIANCE_HIGH = 42;

/** Spike: z-score threshold (robust for small n) */
export const SPIKE_Z = 2.0;

/** Confidence = severity × trendStrength × durationFactor (each 0..1) */
export const CONFIDENCE_LOW = 0.22;
export const CONFIDENCE_MEDIUM = 0.45;
export const CONFIDENCE_HIGH = 0.68;

/** Global safety: max automated predictive corrections per rolling minute */
export const MAX_PREDICTIVE_CORRECTIONS_PER_MIN = 10;

/** Cooldowns (ms) — predictive lane (separate from reactive self-healing) */
export const PREDICTIVE_COOLDOWN_MS = {
  lip_preempt: 2800,
  motion_damp: 4000,
  fps_damp: 12_000,
  gesture_variation: 14_000,
  stability_broadcast: 800,
} as const;

/** Adaptive parameter bounds (multipliers applied by readers / events) */
export const ADAPTIVE_BOUNDS = {
  gestureWeight: { min: 0.72, max: 1, default: 1 },
  smoothing: { min: 1, max: 1.28, default: 1 },
  notifyStrideBonus: { min: 0, max: 8 },
} as const;
