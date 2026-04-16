/**
 * Predictive + adaptive layer: trends from rolling history → early warning → bounded pre-emptive actions.
 * Lightweight O(n) on small rings; runs on the same cadence as observability notify (not per-frame).
 */

import type { ObservabilitySnapshot } from './types';
import { isObservabilityEnabled } from './config';
import { pushEventStream } from './eventStream';
import { getObservabilityNotifyStride, setPredictiveNotifyStrideBonus } from './selfHealingEngine';
import {
  PREDICTIVE_HISTORY_MS,
  PREDICTIVE_MAX_SAMPLES,
  LIP_WARN_MS,
  MIN_SAMPLES_FOR_TREND,
  SLOPE_SIGNIFICANT,
  FPS_VARIANCE_HIGH,
  SPIKE_Z,
  CONFIDENCE_LOW,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_HIGH,
  MAX_PREDICTIVE_CORRECTIONS_PER_MIN,
  PREDICTIVE_COOLDOWN_MS,
  ADAPTIVE_BOUNDS,
  PREDICT_TIME_TO_WARN_SEC,
} from './predictiveRules';

// ─── Types ───────────────────────────────────────────────────────────────────

export type StabilityMode = 'NORMAL' | 'CAUTION' | 'STABILIZATION';

export type WarningBand = 'none' | 'low' | 'medium' | 'high';

export type TrendPack = {
  slope: number;
  variance: number;
  spike: boolean;
  n: number;
};

export type PredictionExample = {
  id: string;
  metric: string;
  message: string;
  etaSec: number | null;
  confidence: number;
};

export type PredictiveSnapshot = {
  mode: StabilityMode;
  warningBand: WarningBand;
  confidence: number;
  /** severity × trend × duration, 0..1 */
  confidenceParts: { severity: number; trend: number; duration: number };
  lipTrend: TrendPack;
  motionTrend: TrendPack;
  fpsTrend: TrendPack;
  gestureRepeatTrend: TrendPack;
  predictions: PredictionExample[];
  adaptive: {
    gestureWeightMul: number;
    smoothingMul: number;
  };
  correctionsLastMinute: number;
};

type Sample = {
  t: number;
  fps: number;
  lipMs: number;
  rootM: number;
  gestureRepeat: number;
  frameMs: number;
};

type LearningEntry = {
  action: string;
  /** EMA 0..1 — higher = this action correlated with improvement */
  score: number;
};

// ─── Rolling history ─────────────────────────────────────────────────────────

const samples: Sample[] = [];

function pushSample(s: Sample): void {
  samples.push(s);
  const cutoff = s.t - PREDICTIVE_HISTORY_MS;
  while (samples.length > 0 && samples[0].t < cutoff) samples.shift();
  while (samples.length > PREDICTIVE_MAX_SAMPLES) samples.shift();
}

function series(key: keyof Sample): number[] {
  return samples.map((x) => {
    if (key === 'fps') return x.fps;
    if (key === 'lipMs') return x.lipMs;
    if (key === 'rootM') return x.rootM;
    if (key === 'gestureRepeat') return x.gestureRepeat;
    return x.frameMs;
  });
}

function times(): number[] {
  return samples.map((x) => x.t);
}

/** Linear regression slope (y vs normalized time 0..1). Dimension of y per second (approx). */
function linearSlope(y: number[], tMs: number[]): { slopePerSec: number; meanY: number; varY: number } {
  const n = y.length;
  if (n < 2) return { slopePerSec: 0, meanY: y[0] ?? 0, varY: 0 };
  const t0 = tMs[0]!;
  const t1 = tMs[n - 1]!;
  const spanSec = Math.max(0.05, (t1 - t0) / 1000);
  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;
  for (let i = 0; i < n; i++) {
    const tn = (tMs[i]! - t0) / (t1 - t0 + 1e-6);
    const yi = y[i]!;
    sumT += tn;
    sumY += yi;
    sumTT += tn * tn;
    sumTY += tn * yi;
  }
  const denom = n * sumTT - sumT * sumT;
  const slopeUnit = denom !== 0 ? (n * sumTY - sumT * sumY) / denom : 0;
  const slopePerSec = slopeUnit / spanSec;
  const meanY = sumY / n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = y[i]! - meanY;
    v += d * d;
  }
  const varY = v / n;
  return { slopePerSec, meanY, varY };
}

function detectSpike(last: number, y: number[]): boolean {
  if (y.length < 4) return false;
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  let v = 0;
  for (const x of y) v += (x - mean) ** 2;
  const std = Math.sqrt(v / y.length) || 1e-6;
  return Math.abs(last - mean) > SPIKE_Z * std;
}

function buildTrendPack(key: keyof Sample): TrendPack {
  const y = series(key);
  const t = times();
  const n = y.length;
  if (n < MIN_SAMPLES_FOR_TREND) {
    return { slope: 0, variance: 0, spike: false, n };
  }
  const { slopePerSec, varY } = linearSlope(y, t);
  const last = y[n - 1] ?? 0;
  const spike = detectSpike(last, y);
  const slopeNorm = Math.tanh(Math.abs(slopePerSec) / (key === 'fps' ? 8 : key === 'lipMs' ? 3 : 0.02));
  return { slope: slopePerSec, variance: varY, spike, n };
}

/** Normalize slope to 0..1 “rising bad” per metric */
function badnessLip(slopePerSec: number): number {
  if (slopePerSec <= 0) return 0;
  return Math.min(1, slopePerSec / 4);
}
function badnessMotion(slopePerSec: number): number {
  if (slopePerSec <= 0) return 0;
  return Math.min(1, slopePerSec / 0.015);
}
function badnessFps(slopePerSec: number): number {
  if (slopePerSec >= 0) return 0;
  return Math.min(1, -slopePerSec / 10);
}

// ─── State ───────────────────────────────────────────────────────────────────

let stabilityMode: StabilityMode = 'NORMAL';
let lastModeBroadcast = 0;
let warningBand: WarningBand = 'none';
let lastConfidence = 0;
let lastConfidenceParts = { severity: 0, trend: 0, duration: 0 };
let lastPredictions: PredictionExample[] = [];

let gestureWeightMul: number = ADAPTIVE_BOUNDS.gestureWeight.default;
let smoothingMul: number = ADAPTIVE_BOUNDS.smoothing.default;

const correctionTs: number[] = [];
const lastApplied: Record<string, number> = {};
const learning: Map<string, LearningEntry> = new Map();

/** Anti-oscillation: same action twice opposite sign within window → suppress */
const recentActionSign: { action: string; dir: 1 | -1; t: number }[] = [];

function pruneCorrections(now: number): void {
  const cut = now - 60_000;
  while (correctionTs.length && correctionTs[0]! < cut) correctionTs.shift();
}

function canCorrect(now: number): boolean {
  pruneCorrections(now);
  return correctionTs.length < MAX_PREDICTIVE_CORRECTIONS_PER_MIN;
}

function recordCorrection(now: number): void {
  correctionTs.push(now);
}

function canApplyRule(rule: string): boolean {
  const t = performance.now();
  const last = lastApplied[rule] ?? 0;
  const cd = (PREDICTIVE_COOLDOWN_MS as Record<string, number>)[rule];
  return t - last >= (typeof cd === 'number' ? cd : 3000);
}

function markRule(rule: string): void {
  lastApplied[rule] = performance.now();
}

function oscillationBlock(action: string, direction: 1 | -1): boolean {
  const now = performance.now();
  while (recentActionSign.length && now - recentActionSign[0]!.t > 20_000) recentActionSign.shift();
  const flip = recentActionSign.find((x) => x.action === action && x.dir !== direction);
  if (flip && now - flip.t < 12_000) return true;
  recentActionSign.push({ action, dir: direction, t: now });
  return false;
}

function updateLearning(action: string, improved: boolean): void {
  const e = learning.get(action) ?? { action, score: 0.5 };
  const alpha = 0.15;
  e.score = e.score * (1 - alpha) + (improved ? 1 : 0) * alpha;
  learning.set(action, e);
}

function learningWeight(action: string): number {
  const s = learning.get(action)?.score ?? 0.5;
  return 0.75 + 0.5 * s;
}

// ─── Confidence & mode ───────────────────────────────────────────────────────

function computeConfidence(
  lip: TrendPack,
  motion: TrendPack,
  fps: TrendPack,
  gesture: TrendPack,
  snapshot: ObservabilitySnapshot,
): { conf: number; parts: { severity: number; trend: number; duration: number }; band: WarningBand } {
  const lipBad = badnessLip(lip.slope) + (snapshot.lipDriftMs / 120) * 0.4;
  const motionBad = badnessMotion(motion.slope) + (snapshot.rootDriftWarn ? 0.25 : 0);
  const fpsBad = badnessFps(fps.slope) + (snapshot.fps < 34 ? 0.2 : 0) + (fps.variance > FPS_VARIANCE_HIGH ? 0.15 : 0);
  const gBad = Math.min(1, gesture.slope > 0 ? gesture.slope * 0.05 : 0) + snapshot.gestureRepeatRatio * 0.35;

  const severity = Math.min(1, (lipBad + motionBad + fpsBad + gBad) / 3.2);
  const trendStr = Math.min(
    1,
    (Math.abs(Math.tanh(lip.slope / 3)) +
      Math.abs(Math.tanh(motion.slope / 0.02)) +
      Math.abs(Math.tanh(-fps.slope / 8)) +
      Math.abs(Math.tanh(gesture.slope))) /
      4,
  );
  const duration = Math.min(1, samples.length / 40);

  const raw = severity * (0.35 + 0.35 * trendStr + 0.3 * duration);
  const conf = Math.min(1, Math.max(0, raw));

  let band: WarningBand = 'none';
  if (conf >= CONFIDENCE_HIGH) band = 'high';
  else if (conf >= CONFIDENCE_MEDIUM) band = 'medium';
  else if (conf >= CONFIDENCE_LOW) band = 'low';

  return { conf, parts: { severity, trend: trendStr, duration }, band };
}

function resolveMode(_conf: number, band: WarningBand, snapshot: ObservabilitySnapshot): StabilityMode {
  if (band === 'high' || snapshot.lipDriftLevel === 'critical' || snapshot.fps < 24) return 'STABILIZATION';
  if (
    band === 'medium' ||
    snapshot.lipDriftLevel === 'warning' ||
    snapshot.fps < 32 ||
    snapshot.rootDriftWarn
  ) {
    return 'CAUTION';
  }
  if (band === 'low') return 'CAUTION';
  return 'NORMAL';
}

function applyAdaptive(mode: StabilityMode, conf: number): void {
  if (mode === 'NORMAL') {
    gestureWeightMul += (ADAPTIVE_BOUNDS.gestureWeight.default - gestureWeightMul) * 0.1;
    smoothingMul += (ADAPTIVE_BOUNDS.smoothing.default - smoothingMul) * 0.1;
  } else {
    const targetGesture =
      mode === 'STABILIZATION'
        ? ADAPTIVE_BOUNDS.gestureWeight.min + (1 - conf) * 0.08
        : ADAPTIVE_BOUNDS.gestureWeight.default - 0.06 * conf;
    const targetSmooth =
      mode === 'STABILIZATION'
        ? ADAPTIVE_BOUNDS.smoothing.min +
          conf * (ADAPTIVE_BOUNDS.smoothing.max - ADAPTIVE_BOUNDS.smoothing.min) * 0.85
        : 1 + 0.06 * conf;

    gestureWeightMul += (targetGesture - gestureWeightMul) * 0.12;
    smoothingMul += (targetSmooth - smoothingMul) * 0.12;
  }

  gestureWeightMul = Math.max(
    ADAPTIVE_BOUNDS.gestureWeight.min,
    Math.min(ADAPTIVE_BOUNDS.gestureWeight.max, gestureWeightMul),
  );
  smoothingMul = Math.max(
    ADAPTIVE_BOUNDS.smoothing.min,
    Math.min(ADAPTIVE_BOUNDS.smoothing.max, smoothingMul),
  );
}

// ─── Predictions (examples for debug / overlay) ─────────────────────────────

function buildPredictions(
  lip: TrendPack,
  motion: TrendPack,
  fps: TrendPack,
  snapshot: ObservabilitySnapshot,
): PredictionExample[] {
  const out: PredictionExample[] = [];
  const lipMs = snapshot.lipDriftMs;
  if (lip.n >= MIN_SAMPLES_FOR_TREND && lip.slope > 0.35 && lipMs < LIP_WARN_MS) {
    const rateMsPerSec = lip.slope;
    const eta = rateMsPerSec > 0.08 ? (LIP_WARN_MS - lipMs) / rateMsPerSec : null;
    if (eta != null && eta > 0 && eta < 8) {
      out.push({
        id: 'lip_warn_eta',
        metric: 'lip_drift',
        message: `Lip drift trending up; ~${eta.toFixed(1)}s to warning band if trend holds`,
        etaSec: eta,
        confidence: Math.min(1, badnessLip(lip.slope) + lipMs / 100),
      });
    }
  }
  if (motion.n >= MIN_SAMPLES_FOR_TREND && motion.slope > 0.008) {
    out.push({
      id: 'root_drift_rise',
      metric: 'root_drift',
      message: 'Root translation trending away from baseline',
      etaSec: PREDICT_TIME_TO_WARN_SEC,
      confidence: badnessMotion(motion.slope),
    });
  }
  if (fps.n >= MIN_SAMPLES_FOR_TREND && (fps.slope < -1.5 || snapshot.fps < 36)) {
    out.push({
      id: 'fps_drop',
      metric: 'fps',
      message: 'FPS downward trend or sustained low frame rate',
      etaSec: 2,
      confidence: badnessFps(fps.slope) + (snapshot.fps < 32 ? 0.2 : 0),
    });
  }
  return out.slice(0, 6);
}

// ─── Pre-emptive actions ─────────────────────────────────────────────────────

function broadcastStabilityMode(mode: StabilityMode, now: number): void {
  const changed = mode !== stabilityMode;
  stabilityMode = mode;
  if (!changed && now - lastModeBroadcast < PREDICTIVE_COOLDOWN_MS.stability_broadcast) return;
  lastModeBroadcast = now;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:predictive:stability-mode', {
      detail: { mode, gestureWeightMul, smoothingMul },
    }),
  );
  pushEventStream('predict', 'stability_mode', { mode, gestureWeightMul, smoothingMul });
}

function preemptLip(snapshot: ObservabilitySnapshot, lip: TrendPack, conf: number, now: number): void {
  if (!canApplyRule('lip_preempt')) return;
  if (oscillationBlock('lip_preempt', -1)) return;
  if (!canCorrect(now)) return;
  const rate = lip.slope;
  if (rate <= 0.2 || snapshot.lipDriftMs < 16) return;
  if (snapshot.lipDriftMs > LIP_WARN_MS - 2) return;
  const etaSec = (LIP_WARN_MS - snapshot.lipDriftMs) / Math.max(0.15, rate);
  if (etaSec > PREDICT_TIME_TO_WARN_SEC * 1.35 || etaSec <= 0) return;

  const w = learningWeight('lip_preempt');
  const deltaSec = -0.0035 * w * (0.6 + conf);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:heal:lip-offset', {
      detail: { deltaSec, source: 'predictive' },
    }),
  );
  pushEventStream('predict', 'lip_preempt', { deltaSec, drift: snapshot.lipDriftMs, slope: lip.slope });
  markRule('lip_preempt');
  lipAtLastPreempt = snapshot.lipDriftMs;
  lipLearnPending = true;
  recordCorrection(now);
}

function preemptMotionDamp(snapshot: ObservabilitySnapshot, motion: TrendPack, mode: StabilityMode, now: number): void {
  if (!canApplyRule('motion_damp')) return;
  if (motion.slope < 0.006 && !snapshot.rootDriftWarn) return;
  if (mode === 'NORMAL') return;
  if (!canCorrect(now)) return;

  const factor = mode === 'STABILIZATION' ? 0.88 : 0.93;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:predictive:gesture-scale', {
      detail: { factor: factor * gestureWeightMul, source: 'predictive' },
    }),
  );
  pushEventStream('predict', 'gesture_damp', { factor });
  markRule('motion_damp');
  recordCorrection(now);
}

function preemptFpsDamp(snapshot: ObservabilitySnapshot, fps: TrendPack, now: number): void {
  if (!canApplyRule('fps_damp')) return;
  if (snapshot.fps >= 33 && fps.slope >= -0.8) return;
  if (!canCorrect(now)) return;

  const bonus = snapshot.fps < 30 || fps.spike ? Math.min(ADAPTIVE_BOUNDS.notifyStrideBonus.max, 6) : 3;
  setPredictiveNotifyStrideBonus(bonus);
  pushEventStream('predict', 'observability_stride', { bonus, fps: snapshot.fps });
  markRule('fps_damp');
  recordCorrection(now);
}

function preemptGestureVariation(snapshot: ObservabilitySnapshot, now: number): void {
  if (!canApplyRule('gesture_variation')) return;
  if (snapshot.gestureRepeatRatio < 0.48) return;
  if (!canCorrect(now)) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:predictive:variation-inject', {
      detail: { strength: 0.35, source: 'predictive' },
    }),
  );
  pushEventStream('predict', 'variation_inject', { repeat: snapshot.gestureRepeatRatio });
  markRule('gesture_variation');
  recordCorrection(now);
}

let lipAtLastPreempt = 0;
let lipLearnPending = false;

function tickLearning(snapshot: ObservabilitySnapshot): void {
  if (!lipLearnPending) return;
  const t = lastApplied['lip_preempt'];
  if (t == null) return;
  const elapsed = performance.now() - t;
  if (elapsed < 1200 || elapsed > 9000) return;
  if (lipAtLastPreempt <= 0) return;
  const improved = snapshot.lipDriftMs < lipAtLastPreempt - 0.8;
  updateLearning('lip_preempt', improved);
  lipLearnPending = false;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Single entry from observability notify — records history, updates mode, may pre-empt.
 * Call before reactive `tickSelfHealing` so pre-emptive nudges apply first.
 */
export function tickPredictiveEngine(snapshot: ObservabilitySnapshot): void {
  if (!isObservabilityEnabled()) return;

  const now = performance.now();
  pushSample({
    t: now,
    fps: snapshot.fps,
    lipMs: snapshot.lipDriftMs,
    rootM: snapshot.rootDriftM,
    gestureRepeat: snapshot.gestureRepeatRatio,
    frameMs: snapshot.frameTimeMs,
  });

  const lipTrend = buildTrendPack('lipMs');
  const motionTrend = buildTrendPack('rootM');
  const fpsTrend = buildTrendPack('fps');
  const gestureTrend = buildTrendPack('gestureRepeat');

  const { conf, parts, band } = computeConfidence(lipTrend, motionTrend, fpsTrend, gestureTrend, snapshot);
  lastConfidence = conf;
  lastConfidenceParts = parts;
  warningBand = band;

  const nextMode = resolveMode(conf, band, snapshot);
  applyAdaptive(nextMode, conf);

  lastPredictions = buildPredictions(lipTrend, motionTrend, fpsTrend, snapshot);

  broadcastStabilityMode(nextMode, now);

  tickLearning(snapshot);

  if (snapshot.fps > 40 && fpsTrend.slope > -0.3) {
    setPredictiveNotifyStrideBonus(0);
  }

  if (band === 'high' || nextMode === 'STABILIZATION') {
    preemptLip(snapshot, lipTrend, conf, now);
    preemptMotionDamp(snapshot, motionTrend, nextMode, now);
    preemptFpsDamp(snapshot, fpsTrend, now);
  } else if (band === 'medium' || nextMode === 'CAUTION') {
    if (lipTrend.slope > SLOPE_SIGNIFICANT * 2) preemptLip(snapshot, lipTrend, conf, now);
    if (snapshot.gestureRepeatRatio > 0.5) preemptGestureVariation(snapshot, now);
    if (snapshot.fps < 36 || fpsTrend.spike) preemptFpsDamp(snapshot, fpsTrend, now);
  } else {
    if (snapshot.gestureRepeatRatio > 0.58) preemptGestureVariation(snapshot, now);
  }
}

export function getPredictiveSnapshot(): PredictiveSnapshot {
  const lip = buildTrendPack('lipMs');
  const motion = buildTrendPack('rootM');
  const fps = buildTrendPack('fps');
  const gesture = buildTrendPack('gestureRepeat');
  pruneCorrections(performance.now());
  return {
    mode: stabilityMode,
    warningBand,
    confidence: lastConfidence,
    confidenceParts: lastConfidenceParts,
    lipTrend: lip,
    motionTrend: motion,
    fpsTrend: fps,
    gestureRepeatTrend: gesture,
    predictions: lastPredictions,
    adaptive: {
      gestureWeightMul,
      smoothingMul,
    },
    correctionsLastMinute: correctionTs.length,
  };
}

export function resetPredictiveEngineState(): void {
  samples.length = 0;
  stabilityMode = 'NORMAL';
  lastModeBroadcast = 0;
  warningBand = 'none';
  lastConfidence = 0;
  lastConfidenceParts = { severity: 0, trend: 0, duration: 0 };
  lastPredictions = [];
  gestureWeightMul = ADAPTIVE_BOUNDS.gestureWeight.default;
  smoothingMul = ADAPTIVE_BOUNDS.smoothing.default;
  correctionTs.length = 0;
  for (const k of Object.keys(lastApplied)) delete lastApplied[k];
  learning.clear();
  recentActionSign.length = 0;
  lipAtLastPreempt = 0;
  lipLearnPending = false;
}

/** Optional: gesture / animation systems read this to scale motion without new events */
export function getPredictiveAdaptiveParams(): Readonly<{ gestureWeightMul: number; smoothingMul: number }> {
  return { gestureWeightMul, smoothingMul };
}

export function getStabilityMode(): StabilityMode {
  return stabilityMode;
}
