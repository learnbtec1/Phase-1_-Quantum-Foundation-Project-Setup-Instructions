'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';

import { ingestDiagnosticsFlushProxy } from './EmbodiedSkeletalTelemetry';

/** Single hook from diagnostics flush — throttled by reporter. */
export function cognitionOnDiagnosticsFlush(shell: DiagnosticsWindowSurface): void {
  ingestDiagnosticsFlushProxy(shell);
}
