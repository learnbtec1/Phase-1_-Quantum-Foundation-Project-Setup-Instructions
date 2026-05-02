/**
 * Gesture name repetition and simple "too still" hints from event stream.
 */

const RING = 24;
const ring: string[] = [];

export function resetBehaviorAnalyzer(): void {
  ring.length = 0;
}

export function recordGestureName(name: string): void {
  const n = (name || '').trim() || 'unknown';
  ring.push(n);
  if (ring.length > RING) ring.shift();
}

export function getGestureRepeatRatio(): number {
  if (ring.length < 8) return 0;
  const counts = new Map<string, number>();
  for (const g of ring) counts.set(g, (counts.get(g) ?? 0) + 1);
  let max = 0;
  for (const v of counts.values()) if (v > max) max = v;
  return max / ring.length;
}

export function isGestureOveruseWarn(): boolean {
  return getGestureRepeatRatio() > 0.55;
}
