import type { BoneTelemetrySample, SkeletalTelemetryReportPayload } from '@/lib/cognition/types';

export function latestBoneSample(samples: BoneTelemetrySample[] | undefined): BoneTelemetrySample | null {
  if (!samples?.length) return null;
  return samples[samples.length - 1]!;
}

/** Uses bone sample `timestamp` (epoch ms) — aligns with {@link ingestDiagnosticsFlushProxy}. */
export function skeletalTelemetryFresh(
  skeletal: SkeletalTelemetryReportPayload,
  windowMs = 300_000,
): boolean {
  let latest = 0;
  for (const arr of Object.values(skeletal.bones)) {
    const last = arr?.[arr.length - 1];
    if (last && last.timestamp > latest) latest = last.timestamp;
  }
  if (!latest) return false;
  return Date.now() - latest <= windowMs;
}

export function yawDeltaDeg(a: BoneTelemetrySample | null, b: BoneTelemetrySample | null): number {
  if (!a || !b) return 0;
  return Math.abs(a.localEulerDeg.yaw - b.localEulerDeg.yaw);
}
