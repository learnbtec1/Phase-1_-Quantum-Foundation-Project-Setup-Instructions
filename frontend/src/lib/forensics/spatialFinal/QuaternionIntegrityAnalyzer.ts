'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { SkeletalTelemetryReportPayload } from '@/lib/cognition/types';
import { TRACKED_BONES } from '@/lib/cognition/EmbodiedSkeletalTelemetry';

import type { QuaternionIntegrityPayload, SpatialVerifiedFailure } from './types';
import { yawDeltaDeg } from './boneSampleUtils';

const CONF = 0.55;

export function analyzeQuaternionIntegrity(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
}): QuaternionIntegrityPayload {
  const ts = new Date().toISOString();
  const discontinuityEvents: QuaternionIntegrityPayload['discontinuityEvents'] = [];
  const verifiedFailures: SpatialVerifiedFailure[] = [];

  const invalid = params.shell?.vrm.invalidQuatSamplesSinceFlush ?? 0;
  if (invalid > 0) {
    verifiedFailures.push({
      id: 'quat_invalid_flush_counter',
      subsystem: 'spatial',
      summary: 'Quaternion integrity compromised per diagnostics counters',
      confidence: 0.67,
      evidence: [`invalidQuatSamplesSinceFlush=${invalid}`],
    });
  }

  for (const bone of TRACKED_BONES) {
    const arr = params.skeletal.bones[bone];
    if (!arr || arr.length < 2) continue;
    const last = arr[arr.length - 1]!;
    const prev = arr[arr.length - 2]!;
    const deltaYaw = yawDeltaDeg(last, prev);
    if (deltaYaw > 48) {
      const conf = Math.min(0.9, 0.52 + deltaYaw / 200);
      discontinuityEvents.push({ bone, deltaYawDeg: deltaYaw, confidence: conf });
      if (conf >= CONF) {
        verifiedFailures.push({
          id: `quat_discontinuity_${bone}`,
          bone,
          subsystem: 'spatial',
          summary: 'Large yaw discontinuity between consecutive skeletal proxies — snap/interpolation risk',
          confidence: conf,
          evidence: [`deltaYawDeg=${deltaYaw.toFixed(1)}`, `window=skeletal_ring`],
        });
      }
    }
  }

  const uniq = new Map<string, SpatialVerifiedFailure>();
  for (const f of verifiedFailures) {
    if (f.confidence >= CONF) uniq.set(f.id, f);
  }

  const normalizedIntegrityScore = Math.max(
    0,
    Math.min(
      100,
      100 - invalid * 14 - discontinuityEvents.filter((e) => e.confidence >= CONF).length * 12,
    ),
  );

  return {
    timestamp: ts,
    discontinuityEvents,
    normalizedIntegrityScore,
    verifiedFailures: [...uniq.values()],
  };
}
