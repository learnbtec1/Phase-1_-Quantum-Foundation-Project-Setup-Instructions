/**
 * Production runtime avatar/TTS telemetry — `window.__cogniMetrics` (flat snapshot + `.snapshot()` + `.reset()`).
 */

import { peekSharedAudioContext } from '@/lib/audio/avatarAudioContext';

export type CogniMetricsErrorRecord = {
  ts: number;
  channel: 'tts' | 'ws' | 'lipsync' | 'audio' | 'failsafe' | string;
  message: string;
};

export type CogniMetricsSnapshot = {
  updatedAtMs: number;
  ttsRequestLatencyMsLast: number | null;
  ttsRoundTripLatencyMsEwma: number;
  /** Avatar performance engine EWMA FPS (lip/morph budgeting), optional */
  perfEngineFpsEwma: number;
  perfMorphStride: number;
  audioDurationSecLast: number | null;
  visemeCountLast: number | null;
  morphActivityRateEwma: number;
  morphSamplesLastWindow: number;
  audioContextState: string | null;
  wsRttMsLast: number | null;
  wsRttMsEwma: number;
  wsConnectedHint: boolean;
  burstStrictPassRateLast: number | null;
  /** Monotonic recovery runs started (foreground self-healing). */
  recoveryCyclesStarted: number;
  /** Completed recovery sequences (success or fail terminal). */
  recoveryCyclesCompleted: number;
  /** Sub-steps executed (logged for observability). */
  recoveryAttempts: number;
  /** recoveryCyclesSucceeded / max(1, recoveryCyclesCompleted) */
  recoverySuccessRate: number;
  recoveryTriggersSession: number;
  lastRecoveryReason: string | null;
  lastRecoveryOutcome: string | null;
  errors: CogniMetricsErrorRecord[];
  lastBurstOk: boolean | null;
};

const MAX_ERRORS = 32;
const EWMA_TTS_ALPHA = 0.22;
const EWMA_WS_ALPHA = 0.35;
const EWMA_MORPH_ALPHA = 0.18;

const state = {
  updatedAtMs: 0,
  ttsReqStartMs: null as number | null,
  ttsRequestLatencyMsLast: null as number | null,
  ttsRoundTripLatencyMsEwma: 0,
  perfEngineFpsEwma: 0,
  perfMorphStride: 1,
  audioDurationSecLast: null as number | null,
  visemeCountLast: null as number | null,
  morphLastTickMs: 0,
  morphActivityRateEwma: 0,
  morphSamplesLastWindow: 0,
  wsRttMsLast: null as number | null,
  wsRttMsEwma: 0,
  wsConnectedHint: false,
  burstStrictPassRateLast: null as number | null,
  lastBurstOk: null as boolean | null,
  errors: [] as CogniMetricsErrorRecord[],
  recoveryCyclesStarted: 0,
  recoveryCyclesCompleted: 0,
  recoveryCyclesSucceeded: 0,
  recoveryAttempts: 0,
  recoveryTriggersSession: 0,
  lastRecoveryReason: null as string | null,
  lastRecoveryOutcome: null as string | null,
};

/** DOM dock object mutated by periodic refresh — keep methods stable */
let metricsDock: (CogniMetricsSnapshot & {
  snapshot: () => CogniMetricsSnapshot;
  reset: () => void;
}) | null = null;

function touch(): void {
  state.updatedAtMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
}

function pushError(channel: string, message: string): void {
  touch();
  state.errors.push({ ts: state.updatedAtMs, channel, message });
  if (state.errors.length > MAX_ERRORS) state.errors.shift();
}

/** Public channel for failsafe layer */
export function cogniMetricsPushFailsafe(reason: string): void {
  pushError('failsafe', reason);
}

export function cogniMetricsMergePerfTelemetry(patch: {
  perfEngineFpsEwma?: number;
  perfMorphStride?: number;
}): void {
  touch();
  if (patch.perfEngineFpsEwma != null && Number.isFinite(patch.perfEngineFpsEwma)) {
    state.perfEngineFpsEwma = patch.perfEngineFpsEwma;
  }
  if (patch.perfMorphStride != null && Number.isFinite(patch.perfMorphStride)) {
    state.perfMorphStride = Math.max(
      1,
      Math.min(8, Math.round(patch.perfMorphStride)),
    );
  }
  syncDock();
}

export function cogniMetricsMarkTtsRequestStart(): void {
  if (typeof performance === 'undefined') return;
  touch();
  state.ttsReqStartMs = performance.now();
}

export function cogniMetricsMarkTtsPlayStarted(args: {
  visemeCount: number;
  audioDurationSec: number | null;
}): void {
  if (typeof performance === 'undefined') return;
  touch();
  const now = performance.now();
  if (state.ttsReqStartMs != null) {
    const lat = now - state.ttsReqStartMs;
    state.ttsRequestLatencyMsLast = lat;
    state.ttsRoundTripLatencyMsEwma =
      state.ttsRoundTripLatencyMsEwma === 0
        ? lat
        : state.ttsRoundTripLatencyMsEwma * (1 - EWMA_TTS_ALPHA) + lat * EWMA_TTS_ALPHA;
  }
  state.ttsReqStartMs = null;
  state.visemeCountLast = args.visemeCount;
  state.audioDurationSecLast =
    args.audioDurationSec != null && Number.isFinite(args.audioDurationSec)
      ? args.audioDurationSec
      : null;
}

export function cogniMetricsMarkTtsFailure(reason: string): void {
  touch();
  state.ttsReqStartMs = null;
  pushError('tts', reason);
}

export function cogniMetricsRecordMorphDelta(deltaAbs: number): void {
  if (typeof performance === 'undefined') return;
  touch();
  const now = performance.now();
  if (state.morphLastTickMs > 0) {
    const dtSec = Math.max(1e-3, (now - state.morphLastTickMs) / 1000);
    const instRate = deltaAbs / dtSec;
    state.morphActivityRateEwma =
      state.morphActivityRateEwma === 0
        ? instRate
        : state.morphActivityRateEwma * (1 - EWMA_MORPH_ALPHA) +
          instRate * EWMA_MORPH_ALPHA;
    state.morphSamplesLastWindow += 1;
  }
  state.morphLastTickMs = now;
}

export function cogniMetricsResetMorphWindow(): void {
  state.morphSamplesLastWindow = 0;
  state.morphLastTickMs = 0;
}

export function cogniMetricsRecordWsRtt(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) return;
  touch();
  state.wsRttMsLast = ms;
  state.wsRttMsEwma =
    state.wsRttMsEwma === 0
      ? ms
      : state.wsRttMsEwma * (1 - EWMA_WS_ALPHA) + ms * EWMA_WS_ALPHA;
}

export function cogniMetricsSetWsConnected(connected: boolean, logDrop?: boolean): void {
  touch();
  const was = state.wsConnectedHint;
  state.wsConnectedHint = connected;
  if (logDrop && was && !connected) pushError('ws', 'WebSocket disconnected');
}

export function cogniMetricsMergeBurstResult(burst: {
  ok: boolean;
  activeSampleCount: number;
  strictFramePassCount: number;
}): void {
  touch();
  state.lastBurstOk = burst.ok;
  if (burst.activeSampleCount > 0) {
    state.burstStrictPassRateLast =
      burst.strictFramePassCount / burst.activeSampleCount;
  }
  syncDock();

  /** Soft hook — optional avoid static import cycles */
  if (typeof window !== 'undefined') {
    const notify = (
      window as Window & {
        __cogniNotifyBurstStrict?: (rate: number | null) => void;
      }
    ).__cogniNotifyBurstStrict;
    const rate =
      burst.activeSampleCount > 0
        ? burst.strictFramePassCount / burst.activeSampleCount
        : null;
    notify?.(rate);
  }
}

/** Called when the autonomous recovery engine begins a remediation sequence */
export function cogniMetricsRecordRecoveryCycleStart(reason: string): void {
  touch();
  state.lastRecoveryReason = reason;
  state.lastRecoveryOutcome = 'in_progress';
  state.recoveryCyclesStarted += 1;
  syncDock();
}

/** Per-step bookkeeping + console breadcrumbs */
export function cogniMetricsRecordRecoveryStep(step: string): void {
  touch();
  state.recoveryAttempts += 1;
  // eslint-disable-next-line no-console
  console.warn('[cogni:recovery]', step);
  syncDock();
}

export function cogniMetricsRecordRecoveryCycleEnd(
  ok: boolean,
  reason: string,
): void {
  touch();
  if (state.lastRecoveryOutcome !== 'in_progress') return;
  state.recoveryCyclesCompleted += 1;
  if (ok) state.recoveryCyclesSucceeded += 1;
  state.lastRecoveryOutcome = ok ? 'success' : 'fail';
  state.lastRecoveryReason = reason;
  syncDock();
}

/** Critical path after max retries — surfaced to observability */
export function cogniMetricsRecordRecoveryEscalation(reason: string): void {
  touch();
  state.lastRecoveryOutcome = 'escalated';
  state.lastRecoveryReason = reason;
  pushError('recovery', `CRITICAL_ESCALATION:${reason}`);
  syncDock();
}

/** Session-scoped triggers (surfaced on window + dock for CI) */
export function cogniMetricsBumpRecoveryTrigger(): void {
  touch();
  state.recoveryTriggersSession += 1;
  if (typeof window !== 'undefined') {
    (window as Window & { __cogniRecoveryTriggersSession?: number }).__cogniRecoveryTriggersSession =
      state.recoveryTriggersSession;
  }
  syncDock();
}

export function cogniMetricsSnapshot(): CogniMetricsSnapshot {
  touch();
  let audioContextState: string | null = null;
  try {
    audioContextState = peekSharedAudioContext()?.state ?? null;
  } catch {
    audioContextState = null;
  }
  const denom = Math.max(1, state.recoveryCyclesCompleted);
  const recoverySuccessRate =
    Math.round((state.recoveryCyclesSucceeded / denom) * 1000) / 1000;
  return {
    updatedAtMs: state.updatedAtMs,
    ttsRequestLatencyMsLast: state.ttsRequestLatencyMsLast,
    ttsRoundTripLatencyMsEwma:
      Math.round(state.ttsRoundTripLatencyMsEwma * 100) / 100,
    perfEngineFpsEwma: state.perfEngineFpsEwma,
    perfMorphStride: state.perfMorphStride,
    audioDurationSecLast: state.audioDurationSecLast,
    visemeCountLast: state.visemeCountLast,
    morphActivityRateEwma: Math.round(state.morphActivityRateEwma * 1000) / 1000,
    morphSamplesLastWindow: state.morphSamplesLastWindow,
    audioContextState,
    wsRttMsLast: state.wsRttMsLast,
    wsRttMsEwma: Math.round(state.wsRttMsEwma * 100) / 100,
    wsConnectedHint: state.wsConnectedHint,
    burstStrictPassRateLast: state.burstStrictPassRateLast,
    recoveryCyclesStarted: state.recoveryCyclesStarted,
    recoveryCyclesCompleted: state.recoveryCyclesCompleted,
    recoveryAttempts: state.recoveryAttempts,
    recoverySuccessRate,
    recoveryTriggersSession: state.recoveryTriggersSession,
    lastRecoveryReason: state.lastRecoveryReason,
    lastRecoveryOutcome: state.lastRecoveryOutcome,
    errors: [...state.errors],
    lastBurstOk: state.lastBurstOk,
  };
}

function syncDock(): void {
  if (!metricsDock) return;
  const snap = cogniMetricsSnapshot();
  (Object.keys(snap) as (keyof CogniMetricsSnapshot)[]).forEach((k) => {
    (metricsDock as Record<string, unknown>)[k as string] = snap[k] as unknown;
  });
}

export function cogniMetricsReset(): void {
  state.ttsReqStartMs = null;
  state.ttsRequestLatencyMsLast = null;
  state.ttsRoundTripLatencyMsEwma = 0;
  state.perfEngineFpsEwma = 0;
  state.perfMorphStride = 1;
  state.audioDurationSecLast = null;
  state.visemeCountLast = null;
  state.morphLastTickMs = 0;
  state.morphActivityRateEwma = 0;
  state.morphSamplesLastWindow = 0;
  state.wsRttMsLast = null;
  state.wsRttMsEwma = 0;
  state.errors.length = 0;
  state.burstStrictPassRateLast = null;
  state.lastBurstOk = null;
  state.recoveryCyclesStarted = 0;
  state.recoveryCyclesCompleted = 0;
  state.recoveryCyclesSucceeded = 0;
  state.recoveryAttempts = 0;
  state.recoveryTriggersSession = 0;
  state.lastRecoveryReason = null;
  state.lastRecoveryOutcome = null;
  touch();
  if (typeof window !== 'undefined') {
    (window as Window & { __cogniRecoveryTriggersSession?: number }).__cogniRecoveryTriggersSession =
      0;
  }
  syncDock();
}

export function installCogniMetricsWindow(): void {
  if (typeof window === 'undefined') return;
  const dock = Object.assign({}, cogniMetricsSnapshot()) as CogniMetricsSnapshot & {
    snapshot: typeof cogniMetricsSnapshot;
    reset: typeof cogniMetricsReset;
  };
  Object.defineProperty(dock, 'snapshot', {
    value: cogniMetricsSnapshot,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(dock, 'reset', {
    value: cogniMetricsReset,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  metricsDock = dock;
  (window as unknown as Window & Record<string, unknown>).__cogniMetrics =
    dock;
}

/** Flatten dock every ~0.5s so DevTools expands current scalars without calling .snapshot() */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startCogniMetricsWindowRefresh(intervalMs = 480): void {
  if (typeof window === 'undefined' || refreshTimer) return;
  refreshTimer = setInterval(syncDock, intervalMs);
}
