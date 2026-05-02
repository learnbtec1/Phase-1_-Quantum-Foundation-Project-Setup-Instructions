/**
 * Heap trend from performance.memory (Chromium). No polyfill overhead on Safari/Firefox.
 */

const SAMPLES_MAX = 12;
const samplesMb: number[] = [];

export function resetMemoryWatcher(): void {
  samplesMb.length = 0;
}

export function sampleMemory(heapUsedMb: number | null): void {
  if (heapUsedMb == null || !Number.isFinite(heapUsedMb)) return;
  samplesMb.push(heapUsedMb);
  if (samplesMb.length > SAMPLES_MAX) samplesMb.shift();
}

export type HeapTrend = 'stable' | 'rising' | 'unknown';

export function getHeapTrend(): HeapTrend {
  if (samplesMb.length < 4) return 'unknown';
  const n = samplesMb.length;
  const first = samplesMb[0]!;
  const last = samplesMb[n - 1]!;
  const rise = last - first;
  if (rise > 8) return 'rising';
  if (rise < -2) return 'stable';
  return 'stable';
}
