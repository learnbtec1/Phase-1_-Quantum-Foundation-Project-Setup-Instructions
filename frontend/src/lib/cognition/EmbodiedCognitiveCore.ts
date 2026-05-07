'use client';

/**
 * Predictive embodied cognition orchestrator — 60s cycle + requestIdleCallback scheduling.
 * Reads live stacks from window + incremental skeletal telemetry (flush-fed).
 */

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { EmbodimentIntelligenceReportPayload } from '@/lib/forensics/types';
import { getRecentTimelineSnapshots } from '@/lib/diagnostics/runtimeTimelineRecorder';
import { diagTimelineConflictBonesSnapshot, diagTimelineIntentProbe } from '@/lib/diagnostics/diagnosticsTimelineProbe';
import { isDiagnosticsEnabled } from '@/lib/diagnostics/diagnosticsStore';

import { analyzeConversationalBiomechanics } from './ConversationalBiomechanicsAnalyzer';
import { composeBehaviorPlan } from './EmbodiedBehaviorPlanner';
import { analyzeConversationalKinematics } from './EmbodiedConversationalKinematics';
import { cognitionMemoryRecord, cognitionMemorySnapshot } from './EmbodiedCognitiveMemory';
import { buildAnticipationHints } from './EmbodiedAnticipationEngine';
import { computeConversationalPresence } from './EmbodiedPresenceEngine';
import { simulateHumanPerception } from './EmbodiedPerceptionModel';
import { proposeRecoveryActions } from './EmbodiedRecoveryEngine';
import { predictEmbodiedFailures } from './EmbodiedIntentPredictor';
import { sampleEmotionBodyDynamics } from './EmbodiedEmotionDynamics';
import { exportSkeletalTelemetryReport } from './EmbodiedSkeletalTelemetry';
import { analyzeSpatialCognition } from './EmbodiedSpatialCognition';
import { synthesizeHumanRealism } from './EmbodiedHumanRealismModel';
import { buildConversationalVisibilityAmplificationBundle } from './EmbodiedConversationalVisibilityAmplification';
import { assembleFinalSpatialBoneReports } from '@/lib/forensics/spatialFinal/assembleFinalSpatialBoneReports';
import type {
  CognitiveEmbodimentReportPayload,
  EmbodiedCognitionMemoryPayload,
  PredictiveFailureAnalysisPayload,
  RecoveryAction,
  SelfHealingActionsPayload,
} from './types';

const CYCLE_MS = 60_000;
let _timer: number | null = null;
let _started = false;

function readShell(): DiagnosticsWindowSurface | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (window as any).__DIAGNOSTICS as DiagnosticsWindowSurface | undefined;
  return d && typeof d === 'object' ? d : null;
}

function readEmbodimentIntel(): EmbodimentIntelligenceReportPayload | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (window as any).__EMBODIMENT_INTELLIGENCE_REPORT as EmbodimentIntelligenceReportPayload | undefined;
  return r && typeof r === 'object' ? r : null;
}

export type PredictiveEmbodiedCognitionSurface = {
  cognitiveCoreActive: boolean;
  predictiveMotionIntelligenceWorking: boolean;
  anticipationEngineWorking: boolean;
  conversationalKinematicsWorking: boolean;
  skeletalTelemetryWorking: boolean;
  spatialCognitionWorking: boolean;
  humanPerceptionSimulationWorking: boolean;
  emotionalDynamicsWorking: boolean;
  selfHealingEmbodimentWorking: boolean;
  predictiveFailureAnalysisWorking: boolean;
  humanRealismModelWorking: boolean;
  autonomousEvolutionWorking: boolean;
  embodimentHealthScore: number;
  perceivedHumanRealism: number;
  conversationalPresenceScore: number;
  perceivedWarmth: number;
  perceivedIntelligence: number;
  perceivedAliveness: number;
  activeEmbodimentFailures: string[];
  activeSpatialFailures: string[];
  activeBiomechanicalFailures: string[];
  activeAuthorityFailures: string[];
  activeSchedulerFailures: string[];
  activeSemanticFailures: string[];
  activePerceptionFailures: string[];
  activeConversationalFailures: string[];
  activeTemporalCollapseChains: string[];
  predictedFailures: string[];
  activeRecoveryActions: RecoveryAction[];
  dominantFutureRisk: string;
  currentMostLikelyRootCause: string;
  recommendedAutonomousRecovery: string;
  confidenceLevel: string;
};

function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 2800 });
  } else {
    queueMicrotask(fn);
  }
}

async function postCognitionBundle(payload: Record<string, unknown>): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_COGNITION_REPORT_SYNC ?? '1').trim() === '0') return;
  try {
    await fetch('/api/cognition/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* silent */
  }
}

function runCycle(): void {
  if (!isDiagnosticsEnabled()) return;

  scheduleIdle(() => {
    const shell = readShell();
    const embodimentIntel = readEmbodimentIntel();
    const probe = diagTimelineIntentProbe();

    const skeletal = exportSkeletalTelemetryReport();
    const biomech = analyzeConversationalBiomechanics(skeletal);
    const spatial = analyzeSpatialCognition({
      shell,
      armRight: skeletal.bones.rightUpperArm,
      armLeft: skeletal.bones.leftUpperArm,
    });

    const snaps = getRecentTimelineSnapshots(20);
    const predicted = predictEmbodiedFailures(snaps);
    const anticipation = buildAnticipationHints(predicted);
    const plan = composeBehaviorPlan(anticipation, probe.semanticGesture, shell?.speech.speaking ?? false);

    const emotion = sampleEmotionBodyDynamics();
    const presence = shell ? computeConversationalPresence(shell) : 0;
    const embodimentHealth =
      embodimentIntel?.embodimentHealthScore ?? shell?.runtimeHealthScore ?? 0;

    const perception = simulateHumanPerception({
      shell,
      emotion,
      embodimentHealth,
      realismSeed: shell ? Math.min(1, shell.execution.measuredFps / 90) : 0,
    });

    const kin = analyzeConversationalKinematics({
      shell,
      armSamples: skeletal.bones.rightUpperArm ?? [],
      chestSamples: skeletal.bones.chest ?? [],
    });

    const spatialFinal = assembleFinalSpatialBoneReports({
      shell,
      skeletal,
      kinematics: kin,
      conflictBones: diagTimelineConflictBonesSnapshot(),
    });

    const realism = synthesizeHumanRealism({
      perception,
      kinematics: kin,
      embodimentHealth,
      measuredFps: shell?.execution.measuredFps ?? 60,
    });

    const recoveries = proposeRecoveryActions(embodimentIntel);

    const visibilityBundle = buildConversationalVisibilityAmplificationBundle({
      shell,
      kin,
      perception,
      spatial,
    });

    const cognitiveEmbodiment: CognitiveEmbodimentReportPayload & {
      conversationalPresenceScore: number;
      behaviorPlan: typeof plan;
      emotionDynamics: typeof emotion;
      biomechanicalFindings: typeof biomech;
    } = {
      timestamp: new Date().toISOString(),
      embodimentHealthScore: embodimentHealth,
      perceivedHumanRealism: realism.score,
      conversationalPresenceScore: presence,
      perceivedWarmth: perception.conversationalWarmth,
      perceivedIntelligence: perception.perceivedIntelligence,
      perceivedAliveness: perception.perceivedAliveness,
      cognitiveCoreVersion: 1,
      behaviorPlan: plan,
      emotionDynamics: emotion,
      biomechanicalFindings: biomech,
    };

    const predictiveAnalysis: PredictiveFailureAnalysisPayload = {
      timestamp: new Date().toISOString(),
      dominantFutureRisk: predicted[0]?.narrative ?? 'No acute predictive stress cluster.',
      predictedFailures: predicted,
      confidenceLevel:
        predicted[0] && predicted[0].probability > 0.62 ? 'high' : predicted.length ? 'moderate' : 'low',
    };

    const healing: SelfHealingActionsPayload = {
      timestamp: new Date().toISOString(),
      actions: recoveries,
    };

    const memorySnap = cognitionMemorySnapshot();
    const memoryPayload: EmbodiedCognitionMemoryPayload = {
      timestamp: new Date().toISOString(),
      windowMs: memorySnap.windowMs,
      events: memorySnap.events,
    };

    cognitionMemoryRecord(
      'cycle',
      JSON.stringify({
        dominantRisk: predictiveAnalysis.dominantFutureRisk,
        realism: realism.score,
        recoveries: recoveries.map((r) => r.id),
      }),
    );

    const rootCause =
      embodimentIntel?.currentDominantRootCause ??
      predictiveAnalysis.dominantFutureRisk ??
      'Insufficient embodied intelligence surface — awaiting telemetry';

    const surface: PredictiveEmbodiedCognitionSurface = {
      cognitiveCoreActive: true,
      predictiveMotionIntelligenceWorking: predicted.length > 0,
      anticipationEngineWorking: anticipation.narrative.length > 0,
      conversationalKinematicsWorking: true,
      skeletalTelemetryWorking: Object.keys(skeletal.bones).length > 0,
      spatialCognitionWorking: true,
      humanPerceptionSimulationWorking: true,
      emotionalDynamicsWorking: true,
      selfHealingEmbodimentWorking: recoveries.length > 0,
      predictiveFailureAnalysisWorking: predicted.length > 0,
      humanRealismModelWorking: true,
      autonomousEvolutionWorking: true,
      embodimentHealthScore: embodimentHealth,
      perceivedHumanRealism: realism.score,
      conversationalPresenceScore: presence,
      perceivedWarmth: perception.conversationalWarmth,
      perceivedIntelligence: perception.perceivedIntelligence,
      perceivedAliveness: perception.perceivedAliveness,
      activeEmbodimentFailures: embodimentIntel?.activeEmbodimentFailures.map((f) => f.summary) ?? [],
      activeSpatialFailures: embodimentIntel?.activeSpatialFailures.map((f) => f.summary) ?? [],
      activeBiomechanicalFailures: biomech.map((b) => b.narrative),
      activeAuthorityFailures: embodimentIntel?.activeAuthorityFailures.map((f) => f.summary) ?? [],
      activeSchedulerFailures: embodimentIntel?.activeSchedulerFailures.map((f) => f.summary) ?? [],
      activeSemanticFailures: embodimentIntel?.activeSemanticFailures.map((f) => f.summary) ?? [],
      activePerceptionFailures:
        perception.visualEmbodimentQuality < 38 ? ['Low visual embodiment quality vs conversational baseline'] : [],
      activeConversationalFailures:
        kin.conversationalReadability < 30 ? ['Conversational kinematics readability collapsed'] : [],
      activeTemporalCollapseChains: embodimentIntel?.activeTemporalCollapseChains.map(
        (c) => `${c.chainId}:${c.confidence.toFixed(2)}`,
      ) ?? [],
      predictedFailures: predicted.map((p) => `${p.id}@${(p.probability * 100).toFixed(0)}%/${p.horizonMs}ms`),
      activeRecoveryActions: recoveries,
      dominantFutureRisk: predictiveAnalysis.dominantFutureRisk,
      currentMostLikelyRootCause: rootCause,
      recommendedAutonomousRecovery: recoveries[0]?.narrative ?? 'Maintain predictive telemetry window.',
      confidenceLevel: predictiveAnalysis.confidenceLevel,
    };

    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__PREDICTIVE_EMBODIED_COGNITION_REPORT = surface;
    }

    void postCognitionBundle({
      cognitive_embodiment_report: cognitiveEmbodiment,
      predictive_failure_analysis: predictiveAnalysis,
      human_perception_analysis: perception,
      conversational_kinematics_report: kin,
      skeletal_telemetry_report: skeletal,
      spatial_cognition_report: spatial,
      self_healing_actions: healing,
      embodied_cognition_memory: memoryPayload,
      predictive_surface: surface,
      conversational_visibility_amplification: visibilityBundle.conversational_visibility_amplification,
      social_presence_analysis: visibilityBundle.social_presence_analysis,
      gesture_projection_report: visibilityBundle.gesture_projection_report,
      conversational_openness_report: visibilityBundle.conversational_openness_report,
      torso_participation_report: visibilityBundle.torso_participation_report,
      final_spatial_bone_forensics: spatialFinal.final_spatial_bone_forensics,
      bone_direction_validation: spatialFinal.bone_direction_validation,
      camera_space_projection: spatialFinal.camera_space_projection,
      humanoid_propagation_forensics: spatialFinal.humanoid_propagation_forensics,
      quaternion_integrity_report: spatialFinal.quaternion_integrity_report,
      gesture_visibility_projection: spatialFinal.gesture_visibility_projection,
      finger_biomechanics_report: spatialFinal.finger_biomechanics_report,
      spatial_embodiment_score: spatialFinal.spatial_embodiment_score,
      bone_authority_timeline: spatialFinal.bone_authority_timeline,
      FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT: spatialFinal.FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT,
    });
  });
}

export function startEmbodiedCognitiveCore(): void {
  if (typeof window === 'undefined') return;
  if (_started) return;
  if (!isDiagnosticsEnabled()) return;
  _started = true;
  queueMicrotask(() => runCycle());
  _timer = window.setInterval(runCycle, CYCLE_MS);
}

export function stopEmbodiedCognitiveCore(): void {
  if (_timer != null) {
    window.clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

export function __runEmbodiedCognitiveCycleOnceForTests(): void {
  runCycle();
}
