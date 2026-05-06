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
  const bump = Math.min(1, 0.08 + e.count * 0.06);
  e.confidenceEma = Math.min(0.97, e.confidenceEma * 0.88 + bump * 0.12);
  _map.set(signature, e);
  return e.confidenceEma;
}

export function embodiedRuntimeElevatedConfidence(signature: string): number {
  return _map.get(signature)?.confidenceEma ?? 0.35;
}

/** Optional hygiene — drop stale entries (>30m idle). */
export function embodiedRuntimePruneStale(nowMs = Date.now(), maxAgeMs = 30 * 60 * 1000): void {
  for (const [k, v] of _map) {
    if (nowMs - v.lastTs > maxAgeMs) _map.delete(k);
  }
}
