'use client';

import type { ActiveFailure } from '../types';
import { embodiedRuntimePeekRepeatCount } from '../EmbodiedRuntimeMemory';

import type { ForensicConfidenceStabilityPayload } from './forensicBrainTypes';
import type { TelemetrySanityReportPayload } from './forensicBrainTypes';

/**
 * Dampens unstable confidence and requires repeated signatures before high scores.
 */
export function stabilizeFailureConfidences(
  failures: ActiveFailure[],
  sanity: TelemetrySanityReportPayload,
): { failures: ActiveFailure[]; stability: ForensicConfidenceStabilityPayload } {
  const ts = new Date().toISOString();
  const perFailureAdjusted: ForensicConfidenceStabilityPayload['perFailureAdjusted'] = [];
  const out: ActiveFailure[] = [];

  for (const f of failures) {
    const before = f.confidence;
    let c = before;

    const prevRepeats = embodiedRuntimePeekRepeatCount(f.id);
    if (prevRepeats < 1) {
      c = Math.min(c, 0.52);
    }
    if (!sanity.fresh) {
      c *= 0.88;
    }
    // Pull extreme spikes toward Bayesian midpoint.
    c = 0.34 + (c - 0.34) * 0.82;

    c = Math.min(0.96, Math.max(0.06, c));

    perFailureAdjusted.push({ id: f.id, before, after: c });
    out.push({ ...f, confidence: c });
  }

  const drift =
    perFailureAdjusted.length === 0
      ? 1
      : perFailureAdjusted.reduce((s, x) => s + Math.abs(x.after - x.before), 0) /
        perFailureAdjusted.length;

  const stabilityScore = Math.round(Math.max(0, Math.min(100, 100 - drift * 220)));

  return {
    failures: out,
    stability: {
      timestamp: ts,
      perFailureAdjusted,
      stabilityScore,
    },
  };
}
