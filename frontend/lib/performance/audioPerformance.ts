/**
 * Lightweight frame budget + lip-sync timing helpers (extends existing pipeline — no rewires).
 */
'use client';

import { cogniMetricsMergePerfTelemetry } from '@/lib/observability/cogniMetrics';

/** Extra playhead damping window (~ ±30 ms) per master prompt §3 */
export const LIPSYNC_TIMING_SMOOTH_WINDOW_SEC = 0.03;

let fpsEwma = 62;
let perfLogAt = 0;
let wired = false;

export function recordFrameTickForPerf(deltaSec: number): void {
  const dt = Math.max(1 / 960, Math.min(deltaSec, 0.25));
  const inst = 1 / dt;
  fpsEwma = fpsEwma * 0.91 + inst * 0.09;

  const stride = computeMorphStride();
  cogniMetricsMergePerfTelemetry({
    perfEngineFpsEwma: Math.round(fpsEwma * 10) / 10,
    perfMorphStride: stride,
  });

  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  if (now - perfLogAt > 4200 && typeof console !== 'undefined') {
    perfLogAt = now;
    // eslint-disable-next-line no-console -- throttled perf telemetry
    console.log('[PERF METRICS]', {
      fpsEwma: Math.round(fpsEwma * 10) / 10,
      morphStride: stride,
    });
  }
}

/** 1 = every frame; throttle expensive morph/aux paths when FPS sags */
export function computeMorphStride(): number {
  if (fpsEwma >= 53) return 1;
  if (fpsEwma >= 43) return 2;
  return 3;
}

/** Idempotent hooks — latency already lives in cogniMetrics from tts.ts */
export function installAudioPerfWindowBridge(): void {
  if (typeof window === 'undefined' || wired) return;
  wired = true;
}
