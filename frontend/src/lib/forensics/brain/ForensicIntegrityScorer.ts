'use client';

import type { ActiveFailure } from '../types';

import type { ExecutionChainValidationPayload } from './forensicBrainTypes';
import type { FalsePositiveAnalysisPayload } from './forensicBrainTypes';
import type { ForensicConfidenceStabilityPayload } from './forensicBrainTypes';
import type { ForensicIntegrityReportPayload } from './forensicBrainTypes';
import type { RootCauseAuthorityReportPayload } from './forensicBrainTypes';
import type { TelemetrySanityReportPayload } from './forensicBrainTypes';

export function scoreForensicIntegrity(params: {
  sanity: TelemetrySanityReportPayload;
  failures: ActiveFailure[];
  chainValidation: ExecutionChainValidationPayload;
  stability: ForensicConfidenceStabilityPayload;
  falsePositive: FalsePositiveAnalysisPayload;
  authority: RootCauseAuthorityReportPayload;
}): ForensicIntegrityReportPayload {
  const ts = new Date().toISOString();

  const telemetryTrustworthiness = params.sanity.trustworthiness;

  const analyzerAgreementProxy = Math.round(
    params.authority.autonomousAnalyzerAgreement ? 78 : 52 + params.authority.confidence * 26,
  );

  const rootCauseConsistency = Math.round(
    Math.max(0, 100 - params.authority.arbitrationTrace.filter((t) => /downweight|defer/i.test(t)).length * 14),
  );

  const confidenceStability = params.stability.stabilityScore;

  const executionChainReliability = params.chainValidation.reliability;

  const fpRate = params.falsePositive.estimatedFalsePositiveRate;
  const forensicIntegrityScore = Math.round(
    telemetryTrustworthiness * 0.26 +
      analyzerAgreementProxy * 0.14 +
      rootCauseConsistency * 0.12 +
      confidenceStability * 0.16 +
      executionChainReliability * 0.18 +
      (100 - fpRate * 100) * 0.14,
  );

  return {
    timestamp: ts,
    forensicIntegrityScore: Math.max(0, Math.min(100, forensicIntegrityScore)),
    telemetryTrustworthiness,
    analyzerAgreementProxy,
    rootCauseConsistency,
    confidenceStability,
    executionChainReliability,
    estimatedFalsePositiveRate: fpRate,
    dominantTrustedRootCause: params.authority.dominantTrustedRootCause,
  };
}
