'use client';

import type { EmbodimentIntelligenceReportPayload } from '@/lib/forensics/types';

import type { RecoveryAction } from './types';

export function proposeRecoveryActions(report: EmbodimentIntelligenceReportPayload | null): RecoveryAction[] {
  if (!report) return [];
  const actions: RecoveryAction[] = [];

  const crit = report.activeEmbodimentFailures.filter((f) => f.severity === 'critical');
  if (crit.some((c) => c.id.includes('idle_overwriting') || c.summary.includes('idle'))) {
    actions.push({
      id: 'raise_gesture_authority',
      priority: 96,
      narrative: 'Raise gesture authority vs idle reclaim during speech envelope peaks.',
      hints: { gestureLayerBias: 1.12, idleSuppress: 0.88 },
    });
  }
  if (crit.some((c) => c.id.includes('arm_frozen'))) {
    actions.push({
      id: 'open_arm_forward_vectors',
      priority: 93,
      narrative: 'Increase arm openness / conversational forward projection — relax idle chest coupling.',
      hints: { armOpennessMul: 1.18, chestCoupling: 1.09 },
    });
  }
  if (report.activeSemanticFailures.length > 0) {
    actions.push({
      id: 'semantic_bridge_prime',
      priority: 82,
      narrative: 'Prime semantic bridge cadence — shorten cooldown starvation windows.',
      hints: { semanticCooldownRelax: 1.08 },
    });
  }
  if (report.activeSchedulerFailures.length > 0) {
    actions.push({
      id: 'scheduler_starvation_relief',
      priority: 78,
      narrative: 'Relax min-between gates briefly while conversational emphasis active.',
      hints: { schedulerMinBetweenRelaxMs: 120 },
    });
  }

  actions.sort((a, b) => b.priority - a.priority);
  return actions.slice(0, 8);
}
