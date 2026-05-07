'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { ConversationalKinematicsReportPayload, SkeletalTelemetryReportPayload } from '@/lib/cognition/types';

import { buildBoneAuthorityTimeline } from './BoneAuthorityTimeline';
import { validateBoneDirections } from './BoneDirectionValidator';
import { analyzeCameraSpaceProjection } from './CameraSpaceProjectionAnalyzer';
import { buildFinalSpatialBoneForensics } from './FinalSpatialBoneForensics';
import { analyzeFingerBiomechanics } from './FingerBiomechanicsAnalyzer';
import { projectGestureVisibility } from './GestureVisibilityProjection';
import { inspectHumanoidPropagation } from './HumanoidPropagationInspector';
import { analyzeQuaternionIntegrity } from './QuaternionIntegrityAnalyzer';
import { scoreSpatialEmbodiment } from './SpatialEmbodimentScorer';
import { skeletalTelemetryFresh } from './boneSampleUtils';
import type {
  FinalSpatialBoneExecutionForensicsReportPayload,
  FinalSpatialBoneForensicsPayload,
  SpatialVerifiedFailure,
} from './types';

const REPORT_ARTIFACTS = [
  'final_spatial_bone_forensics.json',
  'bone_direction_validation.json',
  'camera_space_projection.json',
  'humanoid_propagation_forensics.json',
  'quaternion_integrity_report.json',
  'gesture_visibility_projection.json',
  'finger_biomechanics_report.json',
  'spatial_embodiment_score.json',
  'bone_authority_timeline.json',
  'FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT.json',
];

function gateFresh<T extends { verifiedFailures: SpatialVerifiedFailure[] }>(
  fresh: boolean,
  payload: T,
): T {
  if (fresh) return payload;
  return { ...payload, verifiedFailures: [] };
}

function spatialFailsFromForensics(
  forensics: FinalSpatialBoneForensicsPayload,
  fresh: boolean,
): SpatialVerifiedFailure[] {
  if (!fresh) return [];
  const out: SpatialVerifiedFailure[] = [];
  for (const b of forensics.bones) {
    if (!b.orientationValid && b.conversationalReadability > 0.18) {
      out.push({
        id: `final_pose_readable_but_invalid_${b.bone}`,
        bone: b.bone,
        subsystem: 'spatial',
        summary:
          'Rendered pose proxy shows conversational signal yet orientation/biomechanical gate failed — perceptible mismatch risk',
        confidence: 0.58,
        evidence: [
          `biomech=${b.biomechanicalStatus}`,
          `readability=${b.conversationalReadability.toFixed(3)}`,
          `camera=${b.cameraVisibility.toFixed(3)}`,
        ],
      });
    }
  }
  return out.filter((f) => f.confidence >= 0.55);
}

function pickDominant(failures: SpatialVerifiedFailure[]): { summary: string; fix: string } {
  if (!failures.length) {
    return {
      summary: 'No verified spatial execution failures above confidence gate in active telemetry window.',
      fix: 'Maintain current pipeline ordering and flush-fed skeletal proxies.',
    };
  }
  const sorted = [...failures].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0]!;
  const fixBySubsystem: Record<string, string> = {
    spatial: 'Reconcile final pose composition vs camera-facing proxies; inspect biomechanical clamp outputs.',
    motion_authority: 'Resolve idle vs gesture authority weights and VRMA layer ordering before applyFinalPose.',
    vrm_skeleton: 'Verify humanoid.update sequencing and bind propagation after biomechanical stage.',
    camera_room: 'Increase conversational projection (elevation/openness) relative to camera frustum.',
    social_projection: 'Reduce compressed torso posture during semantic gestures; widen shoulder envelope.',
  };
  return {
    summary: `${top.subsystem}: ${top.summary}`,
    fix: fixBySubsystem[top.subsystem] ?? 'Trace gesture → authority → final pose chain for late overwrites.',
  };
}

export type AssembledSpatialFinalBundle = {
  final_spatial_bone_forensics: FinalSpatialBoneForensicsPayload;
  bone_direction_validation: ReturnType<typeof validateBoneDirections>;
  camera_space_projection: ReturnType<typeof analyzeCameraSpaceProjection>;
  humanoid_propagation_forensics: ReturnType<typeof inspectHumanoidPropagation>;
  quaternion_integrity_report: ReturnType<typeof analyzeQuaternionIntegrity>;
  gesture_visibility_projection: ReturnType<typeof projectGestureVisibility>;
  finger_biomechanics_report: ReturnType<typeof analyzeFingerBiomechanics>;
  spatial_embodiment_score: ReturnType<typeof scoreSpatialEmbodiment>;
  bone_authority_timeline: ReturnType<typeof buildBoneAuthorityTimeline>;
  FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT: FinalSpatialBoneExecutionForensicsReportPayload;
};

export function assembleFinalSpatialBoneReports(params: {
  shell: DiagnosticsWindowSurface | null;
  skeletal: SkeletalTelemetryReportPayload;
  kinematics: ConversationalKinematicsReportPayload;
  conflictBones: string[];
}): AssembledSpatialFinalBundle {
  const fresh = skeletalTelemetryFresh(params.skeletal);

  const forensics = buildFinalSpatialBoneForensics({
    shell: params.shell,
    skeletal: params.skeletal,
  });

  const direction = gateFresh(fresh, validateBoneDirections({ shell: params.shell, skeletal: params.skeletal }));
  const camera = gateFresh(fresh, analyzeCameraSpaceProjection({ shell: params.shell, forensics }));
  const humanoid = gateFresh(fresh, inspectHumanoidPropagation(params.shell));
  const quaternion = gateFresh(fresh, analyzeQuaternionIntegrity({ shell: params.shell, skeletal: params.skeletal }));
  const gestureVis = gateFresh(
    fresh,
    projectGestureVisibility({
      shell: params.shell,
      kinematics: params.kinematics,
      forensics,
    }),
  );
  const fingers = gateFresh(fresh, analyzeFingerBiomechanics({ shell: params.shell, skeletal: params.skeletal }));
  const embodiment = gateFresh(fresh, scoreSpatialEmbodiment({ shell: params.shell, skeletal: params.skeletal }));
  const authority = gateFresh(
    fresh,
    buildBoneAuthorityTimeline({ shell: params.shell, conflictBones: params.conflictBones }),
  );

  const verifiedSpatialFailures = spatialFailsFromForensics(forensics, fresh);

  const verifiedDirectionFailures = direction.verifiedFailures;
  const verifiedQuaternionFailures = quaternion.verifiedFailures;
  const verifiedCameraProjectionFailures = camera.verifiedFailures;
  const verifiedGestureVisibilityFailures = gestureVis.verifiedFailures;
  const verifiedHumanoidPropagationFailures = humanoid.verifiedFailures;
  const verifiedFingerFailures = fingers.verifiedFailures;
  const verifiedGroundingFailures = embodiment.verifiedFailures;
  const verifiedAuthorityExecutionConflicts = authority.verifiedFailures;

  const allVerified = [
    ...verifiedSpatialFailures,
    ...verifiedDirectionFailures,
    ...verifiedQuaternionFailures,
    ...verifiedCameraProjectionFailures,
    ...verifiedGestureVisibilityFailures,
    ...verifiedHumanoidPropagationFailures,
    ...verifiedFingerFailures,
    ...verifiedGroundingFailures,
    ...verifiedAuthorityExecutionConflicts,
  ];

  const dominant = pickDominant(allVerified);

  let confidenceLevel: string;
  if (!fresh) confidenceLevel = 'stale_window';
  else if (!allVerified.length) confidenceLevel = 'nominal';
  else if (allVerified.some((f) => f.confidence >= 0.72)) confidenceLevel = 'high';
  else if (allVerified.some((f) => f.confidence >= 0.58)) confidenceLevel = 'moderate';
  else confidenceLevel = 'low';

  const humanReadabilityScore = Math.round(
    (params.kinematics.conversationalReadability + forensics.aggregatedReadability + gestureVis.socialProjectionScore) /
      3,
  );

  const FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT: FinalSpatialBoneExecutionForensicsReportPayload = {
    timestamp: new Date().toISOString(),
    telemetryFresh: fresh,
    analyzedRecentReports: REPORT_ARTIFACTS,
    analyzedBones: forensics.bones.map((b) => b.bone),
    verifiedSpatialFailures,
    verifiedDirectionFailures,
    verifiedQuaternionFailures,
    verifiedCameraProjectionFailures,
    verifiedGestureVisibilityFailures,
    verifiedHumanoidPropagationFailures,
    verifiedFingerFailures,
    verifiedGroundingFailures,
    verifiedAuthorityExecutionConflicts,
    repairedFiles: [],
    repairedFunctions: [],
    repairedExecutionChains: [],
    conversationalReadabilityScore: forensics.aggregatedReadability,
    gestureVisibilityScore: gestureVis.socialProjectionScore,
    torsoParticipationScore: params.kinematics.torsoParticipation,
    cameraPresenceScore: params.kinematics.cameraReadability,
    spatialEmbodimentScore: embodiment.spatialEmbodimentScore,
    humanReadabilityScore,
    confidenceLevel,
    dominantSpatialRootCause: dominant.summary,
    expectedBehaviorAfterFix: dominant.fix,
  };

  return {
    final_spatial_bone_forensics: forensics,
    bone_direction_validation: direction,
    camera_space_projection: camera,
    humanoid_propagation_forensics: humanoid,
    quaternion_integrity_report: quaternion,
    gesture_visibility_projection: gestureVis,
    finger_biomechanics_report: fingers,
    spatial_embodiment_score: embodiment,
    bone_authority_timeline: authority,
    FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT,
  };
}
