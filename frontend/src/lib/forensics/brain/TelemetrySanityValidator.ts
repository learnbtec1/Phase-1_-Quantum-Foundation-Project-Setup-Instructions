'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';

import type { TelemetrySanityReportPayload, TelemetrySanityViolation } from './forensicBrainTypes';

const MAX_SHELL_STALE_MS = 5000;
const DUPLICATE_TS_TOLERANCE = 3;

/**
 * Validates diagnostics shell + recent timeline snapshots before analyzers
 * treat telemetry as ground truth.
 */
export function validateTelemetrySanity(params: {
  shell: DiagnosticsWindowSurface | null;
  timelineSnapshots: RuntimeTimelineSnapshot[];
  nowMs: number;
}): TelemetrySanityReportPayload {
  const ts = new Date().toISOString();
  const violations: TelemetrySanityViolation[] = [];
  let duplicateTimelineSnapshots = 0;

  if (!params.shell) {
    return {
      timestamp: ts,
      fresh: false,
      staleAgeMs: Number.POSITIVE_INFINITY,
      violations: [{ id: 'NO_DIAGNOSTICS_SHELL', detail: '__DIAGNOSTICS surface missing', severity: 'error' }],
      trustworthiness: 0,
      duplicateTimelineSnapshots: 0,
    };
  }

  const sh = params.shell;
  const staleAgeMs = Math.max(0, params.nowMs - (sh.updatedAt ?? 0));
  const fresh = staleAgeMs <= MAX_SHELL_STALE_MS;

  if (!fresh) {
    violations.push({
      id: 'STALE_DIAGNOSTICS_SHELL',
      detail: `updatedAt lag ${Math.round(staleAgeMs)}ms > ${MAX_SHELL_STALE_MS}ms`,
      severity: 'warn',
    });
  }

  const ms = sh.motion.motionSource;
  const g = sh.motion.gestureLayerW;
  const env = sh.embodiment.timelineEnvelope;
  const gState = sh.motion.gestureState;

  // INVALID: nominal IDLE motion source with strong gesture weights + active envelope (classification clash).
  if (
    ms === 'IDLE' &&
    g > 0.55 &&
    (env > 0.14 || (gState !== 'idle' && gState !== ''))
  ) {
    violations.push({
      id: 'IDLE_SOURCE_HIGH_GESTURE_WEIGHT',
      detail: `motionSource=IDLE but gestureLayerW=${g.toFixed(2)} envelope=${env.toFixed(2)} gestureState=${gState}`,
      severity: 'error',
    });
  }

  // INVALID: strong gesture channel claims without timeline participation (possible stale motionSource).
  if (ms === 'GESTURE' && g < 0.08 && env < 0.06 && gState === 'idle') {
    violations.push({
      id: 'GESTURE_SOURCE_LOW_WEIGHT',
      detail: `motionSource=GESTURE but gestureLayerW=${g.toFixed(2)} envelope=${env.toFixed(2)}`,
      severity: 'warn',
    });
  }

  if (sh.speech.speaking && sh.speech.speakingZeroEnergy) {
    violations.push({
      id: 'SPEAKING_ZERO_ENERGY',
      detail: 'speaking=true with speakingZeroEnergy flag (RMS / motion energy mismatch risk)',
      severity: 'warn',
    });
  }

  const snaps = params.timelineSnapshots;
  const tsCounts = new Map<string, number>();
  for (const s of snaps) {
    const key = s.timestamp;
    tsCounts.set(key, (tsCounts.get(key) ?? 0) + 1);
  }
  for (const [, c] of tsCounts) {
    if (c > DUPLICATE_TS_TOLERANCE) duplicateTimelineSnapshots += c - DUPLICATE_TS_TOLERANCE;
  }
  if (duplicateTimelineSnapshots > 0) {
    violations.push({
      id: 'DUPLICATE_TIMELINE_SNAPSHOTS',
      detail: `Excess duplicate timeline timestamps (~${duplicateTimelineSnapshots})`,
      severity: 'warn',
    });
  }

  let trust = 100;
  for (const v of violations) {
    if (v.severity === 'error') trust -= 22;
    else trust -= 12;
  }
  trust -= Math.min(24, duplicateTimelineSnapshots * 4);
  if (!fresh) trust -= 18;
  trust = Math.max(0, Math.min(100, trust));

  return {
    timestamp: ts,
    fresh,
    staleAgeMs,
    violations,
    trustworthiness: Math.round(trust),
    duplicateTimelineSnapshots,
  };
}
