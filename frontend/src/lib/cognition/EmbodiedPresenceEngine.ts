'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

export function computeConversationalPresence(shell: DiagnosticsWindowSurface): number {
  const en = shell.embodiment.timelineEnvelope;
  const g = shell.motion.gestureLayerW;
  const idle = shell.motion.idleLayerW;
  const sp = shell.speech.speaking ? 1 : 0;
  const raw =
    en * 28 +
    g * 34 +
    (1 - idle) * 18 +
    shell.speech.motionEnergyUnified * 14 +
    sp * 8 -
    (shell.motion.idleDominatesGesture ? 22 : 0);
  return Math.max(3, Math.min(100, Math.round(raw)));
}
