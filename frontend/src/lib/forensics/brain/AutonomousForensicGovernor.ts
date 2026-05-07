'use client';

import type { ActiveFailure } from '../types';

import type { ExecutionChainValidationPayload } from './forensicBrainTypes';
import type { ForensicGovernorSnapshot } from './forensicBrainTypes';
import type { TelemetrySanityReportPayload } from './forensicBrainTypes';

const MIN_REPAIR_CONFIDENCE = 0.55;

/**
 * Gates autonomous repair recommendations — avoids reacting to weak/stale evidence.
 */
export function runForensicGovernor(params: {
  failures: ActiveFailure[];
  sanity: TelemetrySanityReportPayload;
  chainValidation: ExecutionChainValidationPayload;
}): ForensicGovernorSnapshot {
  const reasons: string[] = [];

  if (!params.sanity.fresh) {
    reasons.push('telemetry_not_fresh');
  }
  if (params.sanity.trustworthiness < 42) {
    reasons.push('telemetry_trustworthiness_below_floor');
  }

  const top = params.failures[0];
  const topOk = top != null && top.confidence >= MIN_REPAIR_CONFIDENCE;

  const chainOk =
    params.chainValidation.chains.some((c) => c.valid && c.adjustedConfidence >= MIN_REPAIR_CONFIDENCE);

  const validChains = params.chainValidation.chains.filter((c) => c.valid).length;
  const chainMajority = validChains >= 2;

  const repairRecommended =
    params.sanity.fresh &&
    params.sanity.trustworthiness >= 48 &&
    (topOk || (chainOk && chainMajority));

  if (!topOk && repairRecommended === false && params.failures.length > 0) {
    reasons.push(`top_failure_below_${MIN_REPAIR_CONFIDENCE}`);
  }
  if (!repairRecommended && params.failures.length === 0) {
    reasons.push('no_failures_remain_after_filters');
  }

  return {
    repairRecommended,
    minEvidenceConfidence: MIN_REPAIR_CONFIDENCE,
    reasons,
  };
}
