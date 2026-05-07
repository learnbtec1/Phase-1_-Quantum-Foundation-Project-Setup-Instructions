'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import type { ActiveFailure } from '../types';
import type { TelemetrySanityReportPayload } from './forensicBrainTypes';

export type FalsePositiveFilterResult = {
  kept: ActiveFailure[];
  suppressed: Array<{ failure: ActiveFailure; reason: string }>;
};

/**
 * Drops failure hypotheses contradicted by telemetry sanity / motion classification.
 */
export function filterFalsePositiveFailures(
  failures: ActiveFailure[],
  sanity: TelemetrySanityReportPayload,
  shell: DiagnosticsWindowSurface | null,
): FalsePositiveFilterResult {
  const suppressed: Array<{ failure: ActiveFailure; reason: string }> = [];
  const kept: ActiveFailure[] = [];

  const idleGestureMismatch = sanity.violations.some((v) => v.id === 'IDLE_SOURCE_HIGH_GESTURE_WEIGHT');
  const gestureLowMismatch = sanity.violations.some((v) => v.id === 'GESTURE_SOURCE_LOW_WEIGHT');

  for (const f of failures) {
    let drop: string | null = null;

    if (f.subsystem === 'scheduler' && shell) {
      if (idleGestureMismatch && shell.motion.motionSource === 'GESTURE') {
        drop = 'scheduler_blame_while_motionSource_GESTURE_under_classification_clash';
      }
      if ((shell.scheduler.blocksSinceFlush ?? 0) < 1 && f.confidence < 0.5) {
        drop = 'scheduler_weak_evidence_no_recent_blocks';
      }
    }

    if (f.subsystem === 'semantic_bridge' && idleGestureMismatch && shell) {
      if (shell.motion.gestureLayerW > 0.5 && /idle|mismatch/i.test(f.summary)) {
        drop = 'semantic_idle_mismatch_under_high_gesture_weight';
      }
    }

    if (f.subsystem === 'motion_authority' && gestureLowMismatch) {
      drop = 'authority_collapse_unlikely_while_gesture_source_underweighted';
    }

    if (!sanity.fresh && f.confidence < 0.5) {
      drop = 'stale_telemetry_low_confidence_failure';
    }

    if (drop) suppressed.push({ failure: f, reason: drop });
    else kept.push(f);
  }

  return { kept, suppressed };
}
