'use client';

/**
 * Rolling recurrence memory — elevates confidence when identical signatures repeat (self-evolution).
 */

type Entry = { count: number; lastTs: number; confidenceEma: number };

const _map = new Map<string, Entry>();

export function embodiedRuntimeRecordSignature(signature: string): number {
  if (!signature) return 0.35;
  const now = Date.now();
  const e = _map.get(signature) ?? { count: 0, lastTs: 0, confidenceEma: 0.35 };
  e.count += 1;
  e.lastTs = now;
  const bump = Math.min(1, 0.05 + e.count * 0.04);
  e.confidenceEma = Math.min(0.92, e.confidenceEma * 0.9 + bump * 0.1);
  _map.set(signature, e);
  return e.confidenceEma;
}

/** Repeat observations before current cycle increment (for stabilization gates). */
export function embodiedRuntimePeekRepeatCount(signature: string): number {
  if (!signature) return 0;
  return _map.get(signature)?.count ?? 0;
}

export function embodiedRuntimeElevatedConfidence(signature: string): number {
  return _map.get(signature)?.confidenceEma ?? 0.35;
}

/** Optional hygiene — drop stale entries (>15m idle). */
export function embodiedRuntimePruneStale(nowMs = Date.now(), maxAgeMs = 15 * 60 * 1000): void {
  for (const [k, v] of _map) {
    if (nowMs - v.lastTs > maxAgeMs) _map.delete(k);
  }
}
