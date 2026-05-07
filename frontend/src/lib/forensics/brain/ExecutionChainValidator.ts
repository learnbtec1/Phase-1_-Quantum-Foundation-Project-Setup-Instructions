'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { AutonomousDiagnosticsReport } from '@/lib/diagnostics/diagnosticsTypes';

import type { TelemetrySanityReportPayload } from './forensicBrainTypes';
import type { ExecutionChainValidationEntry, ExecutionChainValidationPayload } from './forensicBrainTypes';

export function validateExecutionChains(params: {
  behavioralChains: Array<{ chainId: string; steps: string[]; confidence: number }>;
  autonomousChains: AutonomousDiagnosticsReport['correlationChains'];
  shell: DiagnosticsWindowSurface | null;
  sanity: TelemetrySanityReportPayload;
}): ExecutionChainValidationPayload {
  const ts = new Date().toISOString();
  const chains: ExecutionChainValidationEntry[] = [];
  const sh = params.shell;

  for (const c of params.behavioralChains) {
    let valid = true;
    let reason: string | null = null;
    let adj = c.confidence;

    if (!params.sanity.fresh) {
      adj *= 0.72;
      reason = 'telemetry_stale';
    }
    if (params.sanity.violations.some((v) => v.id === 'IDLE_SOURCE_HIGH_GESTURE_WEIGHT')) {
      if (/idle|overwrite|GESTURE_LOST/i.test(c.chainId + c.steps.join(' '))) {
        adj *= 0.65;
        if (sh && sh.motion.motionSource === 'GESTURE') {
          valid = false;
          reason = 'chain_assumes_idle_overwrite_but_motionSource_is_GESTURE';
        }
      }
    }

    if (params.sanity.violations.some((v) => v.id === 'SPEAKING_ZERO_ENERGY')) {
      if (/speech|lip|rms/i.test(c.chainId)) {
        adj *= 0.8;
      }
    }

    adj = Math.max(0.05, Math.min(0.98, adj));

    chains.push({
      chainId: c.chainId,
      steps: c.steps,
      valid,
      adjustedConfidence: adj,
      invalidationReason: valid ? null : reason,
    });
  }

  for (const c of params.autonomousChains ?? []) {
    const exists = chains.some((x) => x.chainId === c.chainId);
    if (exists) continue;

    let valid = true;
    let adj = c.confidence;
    let reason: string | null = null;

    if (!params.sanity.fresh) {
      adj *= 0.72;
      reason = 'telemetry_stale';
    }

    // Scheduler-heavy chains need scheduler blocks to be plausible.
    if (/scheduler|min_between/i.test(c.chainId + (c.evidenceMetrics?.join?.(',') ?? ''))) {
      const blocks = sh?.scheduler.blocksSinceFlush ?? 0;
      if (blocks < 1 && (sh?.motion.gestureLayerW ?? 0) > 0.35) {
        adj *= 0.55;
      }
    }

    adj = Math.max(0.05, Math.min(0.98, adj));

    chains.push({
      chainId: c.chainId,
      steps: c.steps ?? [],
      valid,
      adjustedConfidence: adj,
      invalidationReason: valid ? null : reason,
    });
  }

  const rated = chains.filter((c) => c.valid);
  const reliability =
    chains.length === 0
      ? 72
      : Math.round(
          (rated.reduce((s, c) => s + c.adjustedConfidence, 0) / Math.max(1, chains.length)) * 100,
        );

  return { timestamp: ts, chains, reliability: Math.max(0, Math.min(100, reliability)) };
}
