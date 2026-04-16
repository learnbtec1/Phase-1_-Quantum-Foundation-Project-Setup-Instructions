/**
 * FPS, frame time, approximate CPU spikes (long frames), heap (Chrome).
 * Low overhead: rolling window, no allocations in hot path.
 */

const FRAME_HISTORY = 45;
const SPIKE_MULT = 2.8;
const BASELINE_FPS = 60;

let frameDeltas: number[] = [];
let lastTick = 0;

export function resetSystemHealthMonitor(): void {
  frameDeltas = [];
  lastTick = 0;
}

export function recordFrame(deltaSec: number, nowMs: number): void {
  if (lastTick <= 0) {
    lastTick = nowMs;
    return;
  }
  const dt = Math.max(0.0001, Math.min(deltaSec, 0.25));
  frameDeltas.push(dt);
  if (frameDeltas.length > FRAME_HISTORY) frameDeltas.shift();
  lastTick = nowMs;
}

export function getFrameTimeMs(): number {
  if (frameDeltas.length === 0) return 1000 / BASELINE_FPS;
  let s = 0;
  for (let i = 0; i < frameDeltas.length; i++) s += frameDeltas[i];
  return (s / frameDeltas.length) * 1000;
}

export function getSmoothedFps(): number {
  const ft = getFrameTimeMs();
  return ft > 0.0001 ? Math.min(240, 1000 / ft) : BASELINE_FPS;
}

/** True when current frame delta implies main-thread stall vs recent average */
export function isFrameSpike(deltaSec: number): boolean {
  if (frameDeltas.length < 8) return deltaSec > 0.045;
  const avg =
    frameDeltas.reduce((a, b) => a + b, 0) / Math.max(1, frameDeltas.length - 1);
  return deltaSec > avg * SPIKE_MULT && deltaSec > 0.028;
}

export function readHeapUsedMb(): number | null {
  if (typeof performance === 'undefined') return null;
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  if (!m?.usedJSHeapSize) return null;
  return m.usedJSHeapSize / (1024 * 1024);
}
