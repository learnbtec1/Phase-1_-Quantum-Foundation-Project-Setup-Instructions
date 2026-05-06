import { DM } from './diagnosticsMetrics';
import { diagInc, diagPushCriticalStrings, diagLastCritical, isDiagnosticsEnabled } from './diagnosticsStore';
import { DiagnosticsSeverity } from './diagnosticsSeverity';
import { SUBSYSTEM, resolveFile } from './diagnosticsRegistry';

const FN_IDS: Record<string, number> = {
  unknown: 0,
  useFrame: 1,
  schedulerTick: 2,
  blendPoseLayers: 3,
  applyFinalPoseToVrm: 4,
  applyBiomechanicalLayer: 5,
};

export type DiagnosticsFnName = keyof typeof FN_IDS;

type TraceCtx = {
  subsystemId: number;
  fileId: number;
  fnId?: number;
  fnName?: DiagnosticsFnName;
  lineHint?: number;
};

export function diagnosticsResolveFnId(name: DiagnosticsFnName): number {
  return FN_IDS[name] ?? 0;
}

/**
 * Safe invocation wrapper — allocates only on failure path (stack capture).
 */
export function diagnosticsSafeCall<T>(ctx: TraceCtx, op: () => T, fallback: T): T {
  if (!isDiagnosticsEnabled()) {
    try {
      return op();
    } catch {
      return fallback;
    }
  }
  try {
    return op();
  } catch (err) {
    diagInc(DM.SAFE_CALL_FAILURE);
    diagnosticsCaptureException(err, ctx);
    return fallback;
  }
}

export function diagnosticsCaptureException(err: unknown, ctx: TraceCtx): void {
  if (!isDiagnosticsEnabled()) return;
  diagInc(DM.EXCEPTION_CAPTURED);
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : '';
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  diagLastCritical.ts = now;
  diagLastCritical.severity = DiagnosticsSeverity.ERROR;
  diagLastCritical.subsystemId = ctx.subsystemId;
  diagLastCritical.fileId = ctx.fileId;
  diagLastCritical.fnId = ctx.fnId ?? diagnosticsResolveFnId(ctx.fnName ?? 'unknown');
  diagLastCritical.lineHint = ctx.lineHint ?? 0;
  diagLastCritical.stackPresent = stack.length > 0;
  diagPushCriticalStrings(msg, stack);

  if (typeof window !== 'undefined' && (window as Window & { __DIAGNOSTICS_VERBOSE?: boolean }).__DIAGNOSTICS_VERBOSE) {
    // eslint-disable-next-line no-console
    console.error('[DIAGNOSTICS]', resolveFile(ctx.fileId), msg, stack);
  }
}
