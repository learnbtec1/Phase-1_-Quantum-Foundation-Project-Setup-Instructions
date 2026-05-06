'use client';

import type { BoneTelemetrySample, SkeletalTelemetryReportPayload } from './types';

export type BiomechanicalFinding = {
  bone?: string;
  status: string;
  narrative: string;
  severity: 'info' | 'warn' | 'critical';
};

export function analyzeConversationalBiomechanics(skel: SkeletalTelemetryReportPayload): BiomechanicalFinding[] {
  const out: BiomechanicalFinding[] = [];
  const inspect = (bone: string, samples: BoneTelemetrySample[] | undefined) => {
    if (!samples?.length) return;
    const last = samples[samples.length - 1];
    if (last.biomechanicalStatus !== 'OK') {
      out.push({
        bone,
        status: last.biomechanicalStatus,
        narrative: `${bone}: ${last.biomechanicalStatus} — yaw=${last.localEulerDeg.yaw.toFixed(1)}°, readability=${last.conversationalReadability.toFixed(2)}`,
        severity:
          last.biomechanicalStatus.includes('BACKWARD') || last.biomechanicalStatus.includes('AUTHORITY')
            ? 'critical'
            : 'warn',
      });
    }
    if (last.conversationalReadability < 0.18 && last.forwardVector.z < 0.55) {
      out.push({
        bone,
        status: 'CONVERSATIONAL_UNREADABILITY',
        narrative: `Low conversational readability cone on ${bone}; forwardVector.z=${last.forwardVector.z.toFixed(2)}`,
        severity: 'warn',
      });
    }
  };

  inspect('rightUpperArm', skel.bones.rightUpperArm);
  inspect('leftUpperArm', skel.bones.leftUpperArm);
  inspect('chest', skel.bones.chest);
  inspect('rightShoulder', skel.bones.rightShoulder);

  return out.slice(0, 14);
}
