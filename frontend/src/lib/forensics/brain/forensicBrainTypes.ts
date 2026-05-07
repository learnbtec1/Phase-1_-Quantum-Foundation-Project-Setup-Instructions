/**
 * Serialization-safe payloads for autonomous forensic stabilization (disk + API).
 */

export type TelemetrySanityViolation = {
  id: string;
  detail: string;
  severity: 'warn' | 'error';
};

export type TelemetrySanityReportPayload = {
  timestamp: string;
  fresh: boolean;
  staleAgeMs: number;
  violations: TelemetrySanityViolation[];
  trustworthiness: number;
  duplicateTimelineSnapshots: number;
};

export type ExecutionChainValidationEntry = {
  chainId: string;
  steps: string[];
  valid: boolean;
  adjustedConfidence: number;
  invalidationReason: string | null;
};

export type ExecutionChainValidationPayload = {
  timestamp: string;
  chains: ExecutionChainValidationEntry[];
  reliability: number;
};

export type FalsePositiveAnalysisPayload = {
  timestamp: string;
  originalFailureCount: number;
  suppressedCount: number;
  suppressedIds: string[];
  reasons: string[];
  estimatedFalsePositiveRate: number;
};

export type RootCauseAuthorityReportPayload = {
  timestamp: string;
  dominantTrustedRootCause: string;
  confidence: number;
  arbitrationTrace: string[];
  autonomousAnalyzerAgreement: boolean;
};

export type ForensicConfidenceStabilityPayload = {
  timestamp: string;
  perFailureAdjusted: Array<{ id: string; before: number; after: number }>;
  stabilityScore: number;
};

export type ForensicIntegrityReportPayload = {
  timestamp: string;
  forensicIntegrityScore: number;
  telemetryTrustworthiness: number;
  analyzerAgreementProxy: number;
  rootCauseConsistency: number;
  confidenceStability: number;
  executionChainReliability: number;
  estimatedFalsePositiveRate: number;
  dominantTrustedRootCause: string;
};

export type ForensicGovernorSnapshot = {
  repairRecommended: boolean;
  minEvidenceConfidence: number;
  reasons: string[];
};
