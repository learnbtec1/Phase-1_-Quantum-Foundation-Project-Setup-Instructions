/**
 * Serialization-safe cognition payloads (browser + API disk writes).
 */

export type BoneTelemetrySample = {
  bone: string;
  timestamp: number;
  localEulerDeg: { pitch: number; yaw: number; roll: number };
  /** Synthetic forward — full FK requires bone matrices (extended later). */
  forwardVector: { x: number; y: number; z: number };
  angularVelocityRadS: number;
  angularAccelRadS2: number;
  cameraFacingScore: number;
  conversationalReadability: number;
  biomechanicalStatus: string;
};

export type PredictedFailure = {
  id: string;
  probability: number;
  horizonMs: number;
  narrative: string;
};

export type RecoveryAction = {
  id: string;
  priority: number;
  narrative: string;
  /** Soft hints for optional consumers — does not mutate skeleton automatically */
  hints: Record<string, number>;
};

export type CognitiveMemoryEvent = {
  ts: number;
  kind: string;
  payload: string;
};

export type CognitiveEmbodimentReportPayload = {
  timestamp: string;
  embodimentHealthScore: number;
  perceivedHumanRealism: number;
  conversationalPresenceScore: number;
  perceivedWarmth: number;
  perceivedIntelligence: number;
  perceivedAliveness: number;
  cognitiveCoreVersion: number;
};

export type PredictiveFailureAnalysisPayload = {
  timestamp: string;
  dominantFutureRisk: string;
  predictedFailures: PredictedFailure[];
  confidenceLevel: string;
};

export type HumanPerceptionAnalysisPayload = {
  timestamp: string;
  conversationalWarmth: number;
  visualReadability: number;
  perceivedIntelligence: number;
  perceivedRealism: number;
  perceivedConfidence: number;
  perceivedAliveness: number;
  emotionalClarity: number;
  engagementQuality: number;
  socialComfort: number;
  visualEmbodimentQuality: number;
};

export type ConversationalKinematicsReportPayload = {
  timestamp: string;
  armOpenness: number;
  elbowFlexionProxy: number;
  shoulderSpreadProxy: number;
  torsoTwistProxy: number;
  handElevationProxy: number;
  chestParticipation: number;
  conversationalReadability: number;
  gestureVisibilityCone: number;
};

export type SkeletalTelemetryReportPayload = {
  timestamp: string;
  bones: Record<string, BoneTelemetrySample[]>;
  notes: string[];
};

export type SpatialCognitionReportPayload = {
  timestamp: string;
  hiddenGestureRisk: number;
  avatarCameraMisalignmentRisk: number;
  backwardGestureRisk: number;
  framingCollapseRisk: number;
  narratives: string[];
};

export type SelfHealingActionsPayload = {
  timestamp: string;
  actions: RecoveryAction[];
};

export type EmbodiedCognitionMemoryPayload = {
  timestamp: string;
  windowMs: number;
  events: CognitiveMemoryEvent[];
};
