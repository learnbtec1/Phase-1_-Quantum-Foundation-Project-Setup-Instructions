import type { AlertSeverity, ObservabilityAlert } from './types';

const MAX = 40;
const alerts: ObservabilityAlert[] = [];
let seq = 0;
/** Dedupe repeated rule firings (same code within window). */
const lastEmitByCode = new Map<string, number>();
const DEDUPE_MS = 10_000;

export function resetAlerts(): void {
  alerts.length = 0;
  seq = 0;
  lastEmitByCode.clear();
}

export function pushAlert(a: Omit<ObservabilityAlert, 'id' | 'ts'> & { id?: string }): void {
  const now = performance.now();
  const last = lastEmitByCode.get(a.code);
  if (last !== undefined && now - last < DEDUPE_MS) return;
  lastEmitByCode.set(a.code, now);

  const id = a.id ?? `obs-${++seq}`;
  alerts.push({ ...a, id, ts: now });
  while (alerts.length > MAX) alerts.shift();

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    const fn = a.severity === 'CRITICAL' ? console.error : a.severity === 'WARNING' ? console.warn : console.info;
    fn(`[Observability] ${a.code}: ${a.message}`, a.meta ?? '');
  }
}

export function getRecentAlerts(): ObservabilityAlert[] {
  return [...alerts];
}

export function severityOrder(s: AlertSeverity): number {
  return s === 'CRITICAL' ? 3 : s === 'WARNING' ? 2 : 1;
}
