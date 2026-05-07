'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { AutonomousDiagnosticsReport } from '@/lib/diagnostics/diagnosticsTypes';
import type { RuntimeTimelineSnapshot } from '@/lib/diagnostics/diagnosticsTypes';

import type { ActiveFailure } from '../types';

import { filterFalsePositiveFailures } from './FalsePositiveFilter';
import { stabilizeFailureConfidences } from './ConfidenceStabilizer';
import { validateExecutionChains } from './ExecutionChainValidator';
import { scoreForensicIntegrity } from './ForensicIntegrityScorer';
import { resolveDominantRootCause } from './RootCauseAuthorityResolver';
import { runForensicGovernor } from './AutonomousForensicGovernor';
import { validateTelemetrySanity } from './TelemetrySanityValidator';
import { embodiedRuntimeRecordSignature } from '../EmbodiedRuntimeMemory';

export type ForensicStabilizationBundle = {
  telemetry_sanity_report: ReturnType<typeof validateTelemetrySanity>;
  execution_chain_validation: ReturnType<typeof validateExecutionChains>;
  false_positive_analysis: import('./forensicBrainTypes').FalsePositiveAnalysisPayload;
  root_cause_authority_report: ReturnType<typeof resolveDominantRootCause>;
  forensic_confidence_stability: ReturnType<typeof stabilizeFailureConfidences>['stability'];
  forensic_integrity_report: ReturnType<typeof scoreForensicIntegrity>;
  governor: ReturnType<typeof runForensicGovernor>;
  stabilizedFailures: ActiveFailure[];
};

export function assembleForensicStabilizationBundle(params: {
  shell: DiagnosticsWindowSurface | null;
  timelineSnapshots: RuntimeTimelineSnapshot[];
  rawFailures: ActiveFailure[];
  behavioralChains: Array<{ chainId: string; steps: string[]; confidence: number }>;
  autonomous: AutonomousDiagnosticsReport | null;
  nowMs: number;
}): ForensicStabilizationBundle {
  const sanity = validateTelemetrySanity({
    shell: params.shell,
    timelineSnapshots: params.timelineSnapshots,
    nowMs: params.nowMs,
  });

  const filtered = params.shell
    ? filterFalsePositiveFailures(params.rawFailures, sanity, params.shell)
    : { kept: params.rawFailures, suppressed: [] };

  const { failures: stabilizedFailures, stability } = stabilizeFailureConfidences(filtered.kept, sanity);

  for (const f of stabilizedFailures) {
    embodiedRuntimeRecordSignature(f.id);
  }

  const chainValidation = validateExecutionChains({
    behavioralChains: params.behavioralChains,
    autonomousChains: params.autonomous?.correlationChains ?? [],
    shell: params.shell,
    sanity,
  });

  const sorted = [...stabilizedFailures].sort((a, b) => b.confidence - a.confidence);

  const authority = resolveDominantRootCause({
    failures: sorted,
    chainValidation,
    autonomousDominant: params.autonomous?.dominantRootCause ?? null,
    sanity,
  });

  const governor = runForensicGovernor({
    failures: sorted,
    sanity,
    chainValidation,
  });

  const originalFailureCount = params.rawFailures.length;
  const suppressedCount = filtered.suppressed.length;
  const false_positive_analysis: import('./forensicBrainTypes').FalsePositiveAnalysisPayload = {
    timestamp: new Date().toISOString(),
    originalFailureCount,
    suppressedCount,
    suppressedIds: filtered.suppressed.map((s) => s.failure.id),
    reasons: filtered.suppressed.map((s) => `${s.failure.id}:${s.reason}`),
    estimatedFalsePositiveRate:
      originalFailureCount === 0 ? 0 : Math.min(1, suppressedCount / originalFailureCount),
  };

  const forensic_integrity_report = scoreForensicIntegrity({
    sanity,
    failures: sorted,
    chainValidation,
    stability,
    falsePositive: false_positive_analysis,
    authority,
  });

  return {
    telemetry_sanity_report: sanity,
    execution_chain_validation: chainValidation,
    false_positive_analysis,
    root_cause_authority_report: authority,
    forensic_confidence_stability: stability,
    forensic_integrity_report,
    governor,
    stabilizedFailures: sorted,
  };
}
