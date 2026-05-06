/**
 * Shared shapes for autonomous embodiment forensics (serialization-safe).
 */

export type EmbodimentSubsystemId =
  | 'speech'
  | 'phoneme_viseme'
  | 'facial'
  | 'gesture_intent'
  | 'motion_authority'
  | 'vrm_skeleton'
  | 'scheduler'
  | 'semantic_bridge'
  | 'personality'
  | 'spatial'
  | 'camera_room'
  | 'visual_realism';

export type ActiveFailure = {
  id: string;
  subsystem: EmbodimentSubsystemId;
  severity: 'info' | 'warn' | 'critical';
  summary: string;
  evidence: string[];
  /** Static graph targets for tooling — not runtime file reads */
  inspectTargets: string[];
  confidence: number;
};

export type Contradiction = {
  id: string;
  a: string;
  b: string;
  confidence: number;
};

export type EmbodimentQualityBreakdown = {
  speechEmbodiment: number;
  gestureVisibility: number;
  lipSyncAccuracy: number;
  personalityConsistency: number;
  behavioralCoherence: number;
  motionFluidity: number;
  cameraPresence: number;
  spatialEmbodiment: number;
  facialEmbodiment: number;
  overallEmbodiment: number;
};

export type RootCauseGraphPayload = {
  timestamp: string;
  nodes: Array<{ id: string; subsystem: EmbodimentSubsystemId; weight: number }>;
  edges: Array<{ from: string; to: string; weight: number; label?: string }>;
  dominantPath: string[];
};

export type EmbodimentIntelligenceReportPayload = {
  timestamp: string;
  embodimentHealthScore: number;
  currentDominantRootCause: string;
  mostProblematicSubsystem: EmbodimentSubsystemId | 'unknown';
  mostProblematicFile: string;
  mostProblematicFunction: string;
  activeEmbodimentFailures: ActiveFailure[];
  activeBehavioralContradictions: Contradiction[];
  activeLipsyncFailures: ActiveFailure[];
  activeAuthorityFailures: ActiveFailure[];
  activeSpatialFailures: ActiveFailure[];
  activeSchedulerFailures: ActiveFailure[];
  activeSemanticFailures: ActiveFailure[];
  activePersonalityContradictions: Contradiction[];
  activeTemporalCollapseChains: Array<{ chainId: string; steps: string[]; confidence: number }>;
  currentAvatarEmbodimentState: Record<string, unknown>;
  confidenceLevel: string;
  recommendedNextFix: string;
  quality: EmbodimentQualityBreakdown;
  evolutionNotes: string[];
};
