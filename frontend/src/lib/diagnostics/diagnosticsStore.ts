import { METRIC_COUNT } from './diagnosticsMetrics';

let _enabled =
  typeof process !== 'undefined' &&
  (process.env.NEXT_PUBLIC_DIAGNOSTICS ?? '1').trim() !== '0';

/** Toggle diagnostics collection (e.g. tests). */
export function setDiagnosticsEnabled(v: boolean): void {
  _enabled = v;
}

export function isDiagnosticsEnabled(): boolean {
  return _enabled;
}

const _counters = new Uint32Array(METRIC_COUNT);

/** Zero-allocation hot path: increment metric bucket. */
export function diagInc(metricIndex: number, delta = 1): void {
  if (!_enabled || metricIndex < 0 || metricIndex >= METRIC_COUNT) return;
  _counters[metricIndex] += delta >>> 0;
}

export function diagCounters(): Uint32Array {
  return _counters;
}

/** Copy counters for delta reporting (flush path only). */
export function diagCountersCopy(out: Uint32Array): void {
  out.set(_counters);
}

export function diagCountersReset(): void {
  _counters.fill(0);
}

// ─── Scalar telemetry (hot path: assign primitives only) ─────────────────────

export const diagScalars = {
  lastSubsystemId: 0,
  lastStageId: 0,
  lastFileId: 0,
  motionSourceTag: 0,
  gestureTag: 0,
  frameTick: 0,
};

/** Updated only when authority conflict hooks fire (flush reads string). */
export let diagLastConflictBone = '';

export function diagSetLastConflictBone(name: string): void {
  diagLastConflictBone = name;
}

/** Preallocated critical-event slot (reuse on each CRITICAL). */
export const diagLastCritical = {
  ts: 0,
  severity: 0,
  subsystemId: 0,
  messageChars: 0,
  fileId: 0,
  fnId: 0,
  lineHint: 0,
  /** Filled only on flush stringification — exception path may set stackLen */
  stackPresent: false,
};

/** Ring buffer indices for exception strings — populated only on error paths. */
const CRIT_RING = 8;
const _critMsg = new Array<string>(CRIT_RING);
const _critStack = new Array<string>(CRIT_RING);
let _critIdx = 0;

export function diagPushCriticalStrings(message: string, stack: string): void {
  _critMsg[_critIdx] = message;
  _critStack[_critIdx] = stack;
  _critIdx = (_critIdx + 1) % CRIT_RING;
}

export function diagCriticalRing(): { messages: string[]; stacks: string[] } {
  return { messages: [..._critMsg], stacks: [..._critStack] };
}

/** Latest non-empty critical message (newest ring slot wins). */
export function diagPeekLastCritical(): { msg: string; stack: string } {
  for (let i = CRIT_RING - 1; i >= 0; i--) {
    const m = _critMsg[i];
    if (m) return { msg: m, stack: _critStack[i] ?? '' };
  }
  return { msg: '', stack: '' };
}
