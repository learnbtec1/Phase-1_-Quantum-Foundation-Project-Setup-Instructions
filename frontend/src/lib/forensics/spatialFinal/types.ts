/**
 * Disk-serializable payloads for final spatial bone execution forensics.
 */

export type SpatialBoneRecord = {
  bone: string;
  localPitchDeg: number;
  localYawDeg: number;
  localRollDeg: number;
  /** Until full FK/world bridge — mirrors normalized local convention used by skeletal telemetry. */
  worldPitchProxyDeg: number;
  worldYawProxyDeg: number;
  forwardVector: [number, number, number];
  opennessAngleProxyDeg: number;
  shoulderSpreadProxyDeg: number;
  elbowBendProxyDeg: number;
  wristAngleProxyDeg: number;
  fingerCurlProxy: number;
  chestFacingProxyDeg: number;
  cameraVisibility: number;
  conversationalReadability: number;
  gestureReadable: boolean;
  orientationValid: boolean;
  biomechanicalStatus: string;
};

export type SpatialVerifiedFailure = {
  id: string;
  bone?: string;
  subsystem: string;
  summary: string;
  confidence: number;
  evidence: string[];
};

export type FinalSpatialBoneForensicsPayload = {
  timestamp: string;
  pipelineNote: string;
  bones: SpatialBoneRecord[];
  aggregatedReadability: number;
  aggregatedCameraVisibility: number;
};

export type BoneDirectionValidationPayload = {
  timestamp: string;
  verifiedFailures: SpatialVerifiedFailure[];
  perBoneFlags: Array<{ bone: string; flags: string[] }>;
};

export type CameraSpaceProjectionPayload = {
  timestamp: string;
  meanCameraVisibility: number;
  hiddenGestureRisk: number;
  verifiedFailures: SpatialVerifiedFailure[];
};

export type HumanoidPropagationForensicsPayload = {
  timestamp: string;
  executionOrderCorrect: boolean;
  stages: Record<string, boolean>;
  invalidQuatSinceFlush: number;
  nullBoneSinceFlush: number;
  verifiedFailures: SpatialVerifiedFailure[];
  narrative: string;
};

export type QuaternionIntegrityPayload = {
  timestamp: string;
  discontinuityEvents: Array<{ bone: string; deltaYawDeg: number; confidence: number }>;
  normalizedIntegrityScore: number;
  verifiedFailures: SpatialVerifiedFailure[];
};

export type GestureVisibilityProjectionPayload = {
  timestamp: string;
  opennessScore: number;
  shoulderSpreadScore: number;
  torsoEngagementScore: number;
  gestureElevationScore: number;
  conversationalReachScore: number;
  chestParticipationScore: number;
  framingScore: number;
  emotionalProjectionScore: number;
  socialProjectionScore: number;
  verifiedFailures: SpatialVerifiedFailure[];
};

export type FingerBiomechanicsPayload = {
  timestamp: string;
  leftHand: { curlProxy: number; wristFlexProxy: number; palmOpennessProxy: number };
  rightHand: { curlProxy: number; wristFlexProxy: number; palmOpennessProxy: number };
  verifiedFailures: SpatialVerifiedFailure[];
};

export type SpatialEmbodimentScorePayload = {
  timestamp: string;
  balanceProxy: number;
  groundingProxy: number;
  upperLowerCoherence: number;
  leaningProxy: number;
  spatialEmbodimentScore: number;
  verifiedFailures: SpatialVerifiedFailure[];
};

export type BoneAuthorityTimelinePayload = {
  timestamp: string;
  motionSource: string;
  gestureState: string;
  gestureLayerW: number;
  idleLayerW: number;
  timelineEnvelope: number;
  conflictBonesRecent: string[];
  orderedLayers: Array<{ phase: string; active: boolean; detail?: string }>;
  verifiedFailures: SpatialVerifiedFailure[];
};

/** Consolidated narrative artifact for cognition disk sync / dashboards. */
export type FinalSpatialBoneExecutionForensicsReportPayload = {
  timestamp: string;
  telemetryFresh: boolean;
  analyzedRecentReports: string[];
  analyzedBones: string[];
  verifiedSpatialFailures: SpatialVerifiedFailure[];
  verifiedDirectionFailures: SpatialVerifiedFailure[];
  verifiedQuaternionFailures: SpatialVerifiedFailure[];
  verifiedCameraProjectionFailures: SpatialVerifiedFailure[];
  verifiedGestureVisibilityFailures: SpatialVerifiedFailure[];
  verifiedHumanoidPropagationFailures: SpatialVerifiedFailure[];
  verifiedFingerFailures: SpatialVerifiedFailure[];
  verifiedGroundingFailures: SpatialVerifiedFailure[];
  verifiedAuthorityExecutionConflicts: SpatialVerifiedFailure[];
  repairedFiles: string[];
  repairedFunctions: string[];
  repairedExecutionChains: string[];
  conversationalReadabilityScore: number;
  gestureVisibilityScore: number;
  torsoParticipationScore: number;
  cameraPresenceScore: number;
  spatialEmbodimentScore: number;
  humanReadabilityScore: number;
  confidenceLevel: string;
  dominantSpatialRootCause: string;
  expectedBehaviorAfterFix: string;
};
