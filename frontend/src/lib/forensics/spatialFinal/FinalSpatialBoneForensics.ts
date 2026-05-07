'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { SkeletalTelemetryReportPayload } from '@/lib/cognition/types';
import { TRACKED_BONES } from '@/lib/cognition/EmbodiedSkeletalTelemetry';

import type { FinalSpatialBoneForensicsPayload, SpatialBoneRecord } from './types';
import { latestBoneSample } from './boneSampleUtils';

const PIPELINE_NOTE =
  'Final spatial records derive from flush-fed skeletal telemetry proxies (see skeletal_telemetry_report notes); world Euler proxies mirror local until FK/world bridge lands.';

function buildRecord(
  bone: string,
  s: ReturnType<typeof latestBoneSample>,
  shoulderSpreadProxyDeg: number,
): SpatialBoneRecord | null {
  if (!s) return null;
  const { pitch, yaw, roll } = s.localEulerDeg;
  const fv = s.forwardVector;
  const fwd: [number, number, number] = [fv.x, fv.y, fv.z];

  let opennessAngleProxyDeg = Math.abs(roll) + Math.abs(yaw) * 0.35;
  let elbowBendProxyDeg = bone.includes('LowerArm') ? Math.abs(roll) : Math.abs(roll) * 0.4;
  let wristAngleProxyDeg = bone.includes('Hand') ? Math.abs(pitch) + Math.abs(roll) * 0.5 : Math.abs(roll) * 0.25;
  const fingerCurlProxy =
    bone.includes('Hand') ? Math.min(1, Math.max(0, (Math.abs(roll) + Math.abs(pitch)) / 95)) : 0;

  if (bone.includes('Shoulder')) {
    opennessAngleProxyDeg = Math.abs(roll) + Math.abs(yaw) * 0.2;
  }
  if (bone === 'chest') {
    opennessAngleProxyDeg = Math.abs(yaw) * 0.55 + Math.abs(pitch) * 0.35;
  }

  const chestFacingProxyDeg = bone === 'chest' ? yaw : yaw * 0.15;

  const gestureReadable = s.conversationalReadability >= 0.32 && s.cameraFacingScore >= 0.28;
  const orientationValid =
    !/BACKWARD|CORRUPTION|MISMATCH/i.test(s.biomechanicalStatus) && s.biomechanicalStatus !== 'AUTHORITY_STRADDLE';

  return {
    bone,
    localPitchDeg: pitch,
    localYawDeg: yaw,
    localRollDeg: roll,
    worldPitchProxyDeg: pitch,
    worldYawProxyDeg: yaw,
    forwardVector: fwd,
    opennessAngleProxyDeg,
    shoulderSpreadProxyDeg,
    elbowBendProxyDeg,
    wristAngleProxyDeg,
    fingerCurlProxy,
    chestFacingProxyDeg,
    cameraVisibility: s.cameraFacingScore,
    conversationalReadability: s.conversationalReadability,
    gestureReadable,
    orientationValid,
    biomechanicalStatus: s.biomechanicalStatus,
  };
}

export function buildFinalSpatialBoneForensics(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
}): FinalSpatialBoneForensicsPayload {
  const ts = new Date().toISOString();
  const { skeletal } = params;
  const bones: SpatialBoneRecord[] = [];

  const ls = latestBoneSample(skeletal.bones.leftShoulder);
  const rs = latestBoneSample(skeletal.bones.rightShoulder);
  const shoulderSpreadProxyDeg =
    ls && rs ? Math.abs(rs.localEulerDeg.roll - ls.localEulerDeg.roll) : 0;

  for (const bone of TRACKED_BONES) {
    const rec = buildRecord(bone, latestBoneSample(skeletal.bones[bone]), shoulderSpreadProxyDeg);
    if (rec) bones.push(rec);
  }

  let sumRead = 0;
  let sumCam = 0;
  let n = 0;
  for (const b of bones) {
    sumRead += b.conversationalReadability;
    sumCam += b.cameraVisibility;
    n += 1;
  }
  const aggregatedReadability = n === 0 ? 0 : Math.round((sumRead / n) * 100);
  const aggregatedCameraVisibility = n === 0 ? 0 : Math.round((sumCam / n) * 100);

  return {
    timestamp: ts,
    pipelineNote: PIPELINE_NOTE,
    bones,
    aggregatedReadability,
    aggregatedCameraVisibility,
  };
}
