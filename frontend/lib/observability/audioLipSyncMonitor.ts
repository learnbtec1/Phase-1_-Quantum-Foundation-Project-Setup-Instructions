/**
 * Lip-sync: playhead vs cue error in milliseconds (fed from LipSyncManager).
 */

const WARN_MS = 40;
const CRITICAL_MS = 80;

let lastAbsDriftMs = 0;
let emaMs = 0;

export function resetAudioLipSyncMonitor(): void {
  lastAbsDriftMs = 0;
  emaMs = 0;
}

export function reportLipSyncDriftMs(absMs: number): void {
  if (!Number.isFinite(absMs)) return;
  lastAbsDriftMs = absMs;
  /* Slower EMA for monitoring only — avoids UI/rule jitter from sparse samples */
  emaMs = emaMs * 0.92 + absMs * 0.08;
}

export function getLipDriftMs(): number {
  return emaMs > 0 ? emaMs : lastAbsDriftMs;
}

export type LipLevel = 'ok' | 'warning' | 'critical';

export function getLipDriftLevel(): LipLevel {
  const v = getLipDriftMs();
  if (v >= CRITICAL_MS) return 'critical';
  if (v >= WARN_MS) return 'warning';
  return 'ok';
}
