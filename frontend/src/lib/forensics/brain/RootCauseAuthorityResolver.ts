'use client';

import type { ActiveFailure } from '../types';

import type { ExecutionChainValidationPayload } from './forensicBrainTypes';
import type { RootCauseAuthorityReportPayload } from './forensicBrainTypes';
import type { TelemetrySanityReportPayload } from './forensicBrainTypes';

/**
 * Single dominant trusted root cause via weighted arbitration.
 */
export function resolveDominantRootCause(params: {
  failures: ActiveFailure[];
  chainValidation: ExecutionChainValidationPayload;
  autonomousDominant: string | null;
  sanity: TelemetrySanityReportPayload;
}): RootCauseAuthorityReportPayload {
  const ts = new Date().toISOString();
  const trace: string[] = [];

  if (!params.sanity.fresh) {
    trace.push('sanity_not_fresh:downweight_autonomous_and_chains');
  }

  const topFailure = params.failures[0];
  const topChain = params.chainValidation.chains
    .filter((c) => c.valid)
    .sort((a, b) => b.adjustedConfidence - a.adjustedConfidence)[0];

  let dominant = 'No trusted dominant root cause — telemetry nominal after arbitration';
  let confidence = 0.42;
  let autonomousAnalyzerAgreement = false;

  const auto = params.autonomousDominant?.trim();
  if (topFailure && topFailure.confidence >= 0.48) {
    dominant = `${topFailure.summary} (${topFailure.subsystem}; conf=${topFailure.confidence.toFixed(2)})`;
    confidence = topFailure.confidence;
    trace.push(`failure_primary:${topFailure.id}`);
    if (auto && dominant.includes(auto.slice(0, 24))) {
      autonomousAnalyzerAgreement = true;
      confidence = Math.min(0.97, confidence + 0.04);
      trace.push('autonomous_agreement_boost');
    }
  }

  if (topChain && topChain.adjustedConfidence >= confidence - 0.02 && params.sanity.fresh) {
    const chainLabel = `Validated chain: ${topChain.chainId} (conf=${topChain.adjustedConfidence.toFixed(2)})`;
    if (topChain.adjustedConfidence > confidence) {
      dominant = chainLabel;
      confidence = topChain.adjustedConfidence;
      trace.push(`chain_override:${topChain.chainId}`);
    }
  }

  if (auto && params.sanity.fresh && confidence < 0.52) {
    dominant = auto;
    confidence = 0.55;
    trace.push('autonomous_fallback_mid_confidence');
  }

  if (params.failures.length === 0 && (!topChain || !params.sanity.fresh)) {
    dominant = params.sanity.fresh
      ? 'No active embodied failures — fused stack nominal'
      : 'Insufficient fresh telemetry — defer dominant root cause';
    confidence = params.sanity.fresh ? 0.55 : 0.35;
  }

  confidence = Math.max(0.08, Math.min(0.97, confidence));

  return {
    timestamp: ts,
    dominantTrustedRootCause: dominant,
    confidence,
    arbitrationTrace: trace,
    autonomousAnalyzerAgreement,
  };
}
