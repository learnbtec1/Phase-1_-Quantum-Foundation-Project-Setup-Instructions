'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

export function computeConversationalPresence(shell: DiagnosticsWindowSurface): number {
  const en = shell.embodiment.timelineEnvelope;
  const g = shell.motion.gestureLayerW;
  const idle = shell.motion.idleLayerW;
  const sp = shell.speech.speaking ? 1 : 0;
  const raw =
    en * 30 +
    g * 38 +
    (1 - idle) * 20 +
    shell.speech.motionEnergyUnified * 16 +
    sp * 10 -
    (shell.motion.idleDominatesGesture ? 20 : 0);
  return Math.max(3, Math.min(100, Math.round(raw)));
}
