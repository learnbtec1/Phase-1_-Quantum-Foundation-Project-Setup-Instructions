import type { DiagnosticsSeverityId } from './diagnosticsSeverity';

/** Execution pipeline snapshot (mutable shell updated in-place). */
export interface DiagnosticsExecutionSnapshot {
  frameCount: number;
  measuredFps: number;
  earlyReturnReason: string | null;
  stages: {
    motion: boolean;
    applyFinalPose: boolean;
    humanoidUpdate1: boolean;
    biomechanical: boolean;
    humanoidUpdate2: boolean;
  };
  timingsMs: {
    motionToFinalPose: number;
    totalFrameMs: number;
  };
  orderCorrect: boolean;
  overrideDetected: boolean;
}

export interface DiagnosticsMotionSnapshot {
  motionSource: string;
  gestureState: string;
  gestureLayerW: number;
  idleLayerW: number;
  vrmaLayerW: number;
  generativeLayerW: number;
  /** Heuristic: gesture event active but gesture weight crushed by idle. */
  idleDominatesGesture: boolean;
  /** Delta radians lua vs bind (when sampled). */
  armDeviationLuaRad: number | null;
  finalPoseBoneCount: number;
}

export interface DiagnosticsSchedulerSnapshot {
  lastBlockReasonId: number;
  lastBlockReasonLabel: string;
  blocksSinceFlush: number;
}

export interface DiagnosticsVrmSnapshot {
  humanoidPresent: boolean;
  autoUpdateHumanBones: boolean | null;
  invalidQuatSamplesSinceFlush: number;
  nullBoneSamplesSinceFlush: number;
}

export interface DiagnosticsSpeechSnapshot {
  speaking: boolean;
  motionEnergyUnified: number;
  stableMotionEnergy: number;
  /** Speaking but composite energy ~0 — lip/motion desync risk. */
  speakingZeroEnergy: boolean;
}

export interface DiagnosticsAuthoritySnapshot {
  conflictsSinceFlush: number;
  lastConflictBone: string;
}

export interface DiagnosticsEmbodimentSnapshot {
  behaviorQueueDepth: number;
  timelineEnvelope: number;
  semanticCooldownHitsSinceFlush: number;
  lowIntentConfidenceSinceFlush: number;
}

export interface DiagnosticsRootCauseNode {
  id: string;
  severity: DiagnosticsSeverityId;
  summary: string;
  evidence: string[];
  children?: string[];
}

export interface DiagnosticsCriticalEvent {
  ts: number;
  severity: DiagnosticsSeverityId;
  subsystem: string;
  message: string;
  file?: string;
  fn?: string;
  lineHint?: number;
  stack?: string;
}

/** Full DevTools surface — single object reused; arrays refreshed on flush only. */
export interface DiagnosticsWindowSurface {
  execution: DiagnosticsExecutionSnapshot;
  motion: DiagnosticsMotionSnapshot;
  scheduler: DiagnosticsSchedulerSnapshot;
  vrm: DiagnosticsVrmSnapshot;
  speech: DiagnosticsSpeechSnapshot;
  authority: DiagnosticsAuthoritySnapshot;
  embodiment: DiagnosticsEmbodimentSnapshot;
  rootCauses: DiagnosticsRootCauseNode[];
  activeFailures: string[];
  lastCriticalEvent: DiagnosticsCriticalEvent | null;
  runtimeHealthScore: number;
  updatedAt: number;
  flushCount: number;
}

/** Serialized forensic report (API / JSON file). */
export interface ProjectDiagnosticsReport {
  version: number;
  timestamp: string;
  runtimeHealthScore: number;
  failures: string[];
  rootCauses: DiagnosticsRootCauseNode[];
  lastCriticalEvent: DiagnosticsCriticalEvent | null;
  subsystemState: {
    execution: DiagnosticsExecutionSnapshot;
    motion: DiagnosticsMotionSnapshot;
    scheduler: DiagnosticsSchedulerSnapshot;
    vrm: DiagnosticsVrmSnapshot;
    speech: DiagnosticsSpeechSnapshot;
    authority: DiagnosticsAuthoritySnapshot;
    embodiment: DiagnosticsEmbodimentSnapshot;
  };
  affectedFiles: string[];
  affectedFunctions: string[];
  confidenceScore: number;
}

/** 60s autonomous analyzer output (+ persisted JSON). */
export interface AutonomousDiagnosticsReport {
  timestamp: string;
  runtimeHealthScore: number;
  dominantRootCause: string;
  recurringFailures: string[];
  criticalConflicts: string[];
  mostProblematicFiles: Array<{
    file: string;
    occurrences: number;
    subsystem: string;
    severity: DiagnosticsSeverityId;
  }>;
  mostProblematicFunctions: Array<{
    function: string;
    occurrences: number;
    subsystem: string;
    severity: DiagnosticsSeverityId;
  }>;
  motionState: Record<string, unknown>;
  schedulerState: Record<string, unknown>;
  vrmState: Record<string, unknown>;
  speechState: Record<string, unknown>;
  authorityConflicts: string[];
  embodimentFailures: string[];
  unresolvedCriticals: string[];
  recommendedNextFixes: string[];
  /** Correlation layer — causal chains with confidence 0..1. */
  correlationChains: Array<{
    chainId: string;
    steps: string[];
    confidence: number;
    evidenceMetrics: string[];
  }>;
  /** Inferred from rolling timeline memory (not raw counters). */
  behavioralForensicsChains?: BehavioralForensicsChain[];
  visualEmbodimentPenalty?: number;
}

/** Directed graph for DevTools — nodes are failure ids, edges weighted by co-occurrence. */
export interface DiagnosticsRootCauseGraph {
  nodes: Array<{ id: string; weight: number }>;
  edges: Array<{ from: string; to: string; weight: number }>;
  dominantChain: string[];
  chainConfidence: number;
}

/** Single 2s timeline snapshot (writes to logs/runtime_timelines/*.json). */
export interface RuntimeTimelineSnapshot {
  timestamp: string;
  speaking: boolean;
  motionSource: string;
  gestureState: string;
  gestureEnvelope: number;
  gestureLayerW: number;
  idleLayerW: number;
  /** Arm deviation magnitude proxy (radians) — same source as motion diagnostics. */
  finalArmMagnitude: number;
  /** Reserved until torso/head blend telemetry exists; null = unknown. */
  torsoContribution: number | null;
  headContribution: number | null;
  schedulerState: Record<string, unknown>;
  schedulerBlocked: boolean;
  activeIntent: string;
  llmIntent: string;
  semanticGesture: string;
  authorityWinner: string;
  overwrittenBones: string[];
  vrmState: Record<string, unknown>;
  embodimentState: {
    visuallyAlive: boolean;
    gestureVisible: boolean;
    conversationalEmbodiment: boolean;
    idleDominating: boolean;
    armFrozen: boolean;
    gestureCollapseRisk: boolean;
  };
  transitionEdge: string;
  phaseTag: string;
}

/** Temporal chain inferred from rolling snapshots (behavioral forensics). */
export interface BehavioralForensicsChain {
  rootCause: string;
  timeline: string[];
  confidence: number;
  fileHint?: string;
  fnHint?: string;
  lineHint?: number;
}
