'use client';

import type { DiagnosticsWindowSurface } from '@/lib/diagnostics/diagnosticsTypes';
import type { AutonomousDiagnosticsReport } from '@/lib/diagnostics/diagnosticsTypes';
import { isDiagnosticsEnabled } from '@/lib/diagnostics/diagnosticsStore';
import { diagTimelineIntentProbe } from '@/lib/diagnostics/diagnosticsTimelineProbe';

import { buildEmbodiedCausalGraph } from './EmbodiedCausalGraph';
import { embodiedRuntimePruneStale, embodiedRuntimeRecordSignature } from './EmbodiedRuntimeMemory';
import { embodimentSignalEmitCycleComplete } from './EmbodimentSignalBus';
import { computeEmbodiedRuntimeHealth } from './EmbodiedRuntimeHealthEngine';
import { computeEmbodimentQualityScores } from './EmbodimentQualityScorer';
import { analyzeAuthorityCollapse } from './AuthorityCollapseAnalyzer';
import { analyzeFacialEmbodimentFailures, getFacialProbeSnapshot } from './FacialEmbodimentForensics';
import { analyzePersonalityEmbodiment } from './PersonalityEmbodimentAnalyzer';
import { analyzeSemanticEmbodiment } from './SemanticEmbodimentAnalyzer';
import { analyzeSpeechBodyCoupling } from './SpeechBodyEmbodimentAnalyzer';
import { analyzeVRMSpatialIntegrity } from './VRMSpatialForensics';
import {
  getBehavioralChainsEmbodied,
  getLastTimelineSnapshotEmbodied,
  getTemporalTransitionLabels,
} from './TemporalEmbodimentRecorder';
import type {
  ActiveFailure,
  EmbodimentIntelligenceReportPayload,
  EmbodimentSubsystemId,
  RootCauseGraphPayload,
} from './types';

const CYCLE_MS = 60_000;
let _timer: number | null = null;
let _started = false;

function readDiagnosticsShell(): DiagnosticsWindowSurface | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (window as any).__DIAGNOSTICS as DiagnosticsWindowSurface | undefined;
  return d && typeof d === 'object' ? d : null;
}

function readAutonomousReport(): AutonomousDiagnosticsReport | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (window as any).__DIAGNOSTICS_REPORT as AutonomousDiagnosticsReport | undefined;
  return r && typeof r === 'object' ? r : null;
}

function rankInspectTargets(failures: ActiveFailure[]): { file: string; score: number } {
  const map = new Map<string, number>();
  for (const f of failures) {
    for (const p of f.inspectTargets) {
      map.set(p, (map.get(p) ?? 0) + f.confidence);
    }
  }
  let best = '';
  let bestScore = 0;
  for (const [p, s] of map) {
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return { file: best || 'unknown', score: bestScore };
}

function elevateFailures(list: ActiveFailure[]): ActiveFailure[] {
  for (const f of list) {
    const ev = embodiedRuntimeRecordSignature(f.id);
    f.confidence = Math.min(0.98, Math.max(f.confidence, ev));
  }
  return list;
}

function buildSummary(r: EmbodimentIntelligenceReportPayload): string {
  const lines = [
    '[EMBODIMENT_INTELLIGENCE_SUMMARY]',
    `Health (embodied fuse): ${r.embodimentHealthScore}`,
    `Dominant cause: ${r.currentDominantRootCause}`,
    `Hot subsystem: ${r.mostProblematicSubsystem}`,
    `Hot file: ${r.mostProblematicFile}`,
    `Quality overall: ${r.quality.overallEmbodiment}`,
    '',
    'Active failures:',
    ...r.activeEmbodimentFailures.slice(0, 8).map((f) => `- [${f.severity}] ${f.summary}`),
    '',
    `Recommended fix: ${r.recommendedNextFix}`,
  ];
  return lines.join('\n');
}

export function buildEmbodimentIntelligenceReport(): EmbodimentIntelligenceReportPayload | null {
  const shell = readDiagnosticsShell();
  if (!shell) return null;

  const timelineSnap = getLastTimelineSnapshotEmbodied();
  const probe = diagTimelineIntentProbe();
  const facial = getFacialProbeSnapshot();

  const autonomous = readAutonomousReport();

  const spatialFails = analyzeVRMSpatialIntegrity({
    invalidQuatSamplesSinceFlush: shell.vrm.invalidQuatSamplesSinceFlush,
    nullBoneSamplesSinceFlush: shell.vrm.nullBoneSamplesSinceFlush,
    armDeviationLuaRad: shell.motion.armDeviationLuaRad,
    humanoidPresent: shell.vrm.humanoidPresent,
  });

  const facialFails = analyzeFacialEmbodimentFailures({
    speakingTelemetry: shell.speech.speaking,
    speakingZeroEnergy: shell.speech.speakingZeroEnergy,
    motionEnergyUnified: shell.speech.motionEnergyUnified,
  });

  const speechBody = analyzeSpeechBodyCoupling({
    speaking: shell.speech.speaking,
    motionEnergyUnified: shell.speech.motionEnergyUnified,
    stableMotionEnergy: shell.speech.stableMotionEnergy,
    gestureLayerW: shell.motion.gestureLayerW,
    idleLayerW: shell.motion.idleLayerW,
    armDeviationRad: shell.motion.armDeviationLuaRad,
    semanticGesture: probe.semanticGesture,
  });

  const personality = analyzePersonalityEmbodiment({
    gestureVarianceProxy: shell.motion.gestureLayerW * shell.embodiment.timelineEnvelope,
    idleLayerW: shell.motion.idleLayerW,
    motionFluidityProxy: Math.min(1.2, shell.execution.measuredFps / 90),
  });

  const semantic = analyzeSemanticEmbodiment({
    activeIntent: probe.activeIntent,
    semanticGesture: probe.semanticGesture,
    gestureState: shell.motion.gestureState,
    gestureLayerW: shell.motion.gestureLayerW,
    motionSource: shell.motion.motionSource,
  });

  const authorityFails = analyzeAuthorityCollapse({
    timelineSnapshot: timelineSnap,
    idleDominatesGestureFlag: shell.motion.idleDominatesGesture,
    schedulerBlocksSinceFlush: shell.scheduler.blocksSinceFlush,
    semanticCooldownHitsSinceFlush: shell.embodiment.semanticCooldownHitsSinceFlush,
  });

  const schedulerFails: ActiveFailure[] = [];
  if (shell.scheduler.blocksSinceFlush > 2 && shell.scheduler.lastBlockReasonLabel) {
    schedulerFails.push({
      id: `scheduler_block:${shell.scheduler.lastBlockReasonLabel}`,
      subsystem: 'scheduler',
      severity: 'warn',
      summary: `Scheduler blocking: ${shell.scheduler.lastBlockReasonLabel}`,
      evidence: [`blocksΔ=${shell.scheduler.blocksSinceFlush}`],
      inspectTargets: ['frontend/src/app/avatar-agent/motion/motionScheduler.ts'],
      confidence: 0.48,
    });
  }

  let failures: ActiveFailure[] = elevateFailures([
    ...spatialFails,
    ...facialFails,
    ...speechBody.failures,
    ...semantic.failures,
    ...authorityFails,
    ...schedulerFails,
  ]);

  failures.sort((a, b) => b.confidence - a.confidence);

  const behavioralChains = getBehavioralChainsEmbodied().map((c) => ({
    chainId: c.rootCause,
    steps: c.timeline,
    confidence: c.confidence,
  }));

  const spatialIntegrityProxy =
    shell.vrm.humanoidPresent && shell.vrm.invalidQuatSamplesSinceFlush === 0 ? 0.92 : 0.55;

  const gestureVisibilityProxy = Math.min(
    1,
    shell.motion.gestureLayerW * 1.15 + shell.embodiment.timelineEnvelope * 0.9 + (facial.mouthOpenApprox > 0.05 ? 0.08 : 0),
  );

  const personalityConsistencyProxy = personality.personalityMismatch ? 0.42 : 0.88;
  const behavioralCoherenceProxy =
    failures.filter((f) => f.severity === 'critical').length > 0 ? 0.38 : 0.82;

  const quality = computeEmbodimentQualityScores({
    diagnosticsHealth: shell.runtimeHealthScore,
    lipSyncDriftMs: facial.driftMs,
    gestureVisibilityProxy,
    personalityConsistencyProxy,
    behavioralCoherenceProxy,
    spatialIntegrityProxy,
    facialProxy: facial.mouthOpenApprox,
    fpsStableProxy: Math.min(1, shell.execution.measuredFps / 72),
    couplingScore: speechBody.speechBodyCouplingScore,
  });

  const embodimentHealthScore = computeEmbodiedRuntimeHealth(shell.runtimeHealthScore, quality);

  const top = failures[0];
  const hotTarget = rankInspectTargets(failures);
  const subsystemHist = new Map<EmbodimentSubsystemId, number>();
  for (const f of failures) {
    subsystemHist.set(f.subsystem, (subsystemHist.get(f.subsystem) ?? 0) + f.confidence);
  }
  let mostSub: EmbodimentSubsystemId | 'unknown' = 'unknown';
  let subScore = 0;
  for (const [k, v] of subsystemHist) {
    if (v > subScore) {
      mostSub = k;
      subScore = v;
    }
  }

  const diagFn = autonomous?.mostProblematicFunctions?.[0]?.function ?? 'unknown';

  let dominant = top
    ? `${top.summary} (${top.subsystem}; conf=${top.confidence.toFixed(2)})`
    : 'No dominant embodied failure — stack within nominal envelope';

  if (behavioralChains[0] && behavioralChains[0].confidence > (top?.confidence ?? 0)) {
    dominant = `Temporal chain: ${behavioralChains[0].chainId} (conf=${behavioralChains[0].confidence.toFixed(2)})`;
  }

  const evolutionNotes = [
    `personalityProfile=${personality.profileSummary}`,
    autonomous?.dominantRootCause
      ? `diagnosticsAnalyzer.hint=${autonomous.dominantRootCause}`
      : 'diagnosticsAnalyzer.hint=n/a',
  ];

  const recommendedNextFix = top
    ? `Inspect ${hotTarget.file} — ${top.summary}`
    : 'Maintain observability; no critical embodied regressions this window.';

  const temporalCollapseChains = behavioralChains.filter((c) =>
    /collapse|frozen|idle|starvation/i.test(c.chainId + c.steps.join(' ')),
  );

  return {
    timestamp: new Date().toISOString(),
    embodimentHealthScore,
    currentDominantRootCause: dominant,
    mostProblematicSubsystem: mostSub,
    mostProblematicFile: hotTarget.file.split('/').pop() ?? hotTarget.file,
    mostProblematicFunction: diagFn,
    activeEmbodimentFailures: failures,
    activeBehavioralContradictions: semantic.contradictions,
    activeLipsyncFailures: failures.filter((f) => f.subsystem === 'facial' || f.subsystem === 'phoneme_viseme'),
    activeAuthorityFailures: failures.filter((f) => f.subsystem === 'motion_authority'),
    activeSpatialFailures: failures.filter((f) => f.subsystem === 'spatial' || f.subsystem === 'vrm_skeleton'),
    activeSchedulerFailures: failures.filter((f) => f.subsystem === 'scheduler'),
    activeSemanticFailures: failures.filter((f) => f.subsystem === 'semantic_bridge'),
    activePersonalityContradictions: personality.contradictions,
    activeTemporalCollapseChains: temporalCollapseChains,
    currentAvatarEmbodimentState: {
      motionSource: shell.motion.motionSource,
      gestureState: shell.motion.gestureState,
      speaking: shell.speech.speaking,
      gestureEnvelope: shell.embodiment.timelineEnvelope,
      gestureLayerW: shell.motion.gestureLayerW,
      idleLayerW: shell.motion.idleLayerW,
      timelinePhaseTag: timelineSnap?.phaseTag ?? null,
      facialProbe: facial,
      intentProbe: probe,
    },
    confidenceLevel:
      failures.filter((f) => f.severity === 'critical').length > 0 ? 'high-alert' : 'moderate',
    recommendedNextFix,
    quality,
    evolutionNotes,
  };
}

async function syncEmbodimentReports(payload: {
  intelligenceReport: EmbodimentIntelligenceReportPayload;
  rootCauseGraph: RootCauseGraphPayload;
  temporalChains: Array<{ chainId: string; steps: string[]; confidence: number }>;
  activeFailures: ActiveFailure[];
  summaryText: string;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_FORENSICS_REPORT_SYNC ?? '1').trim() === '0') return;
  try {
    await fetch('/api/forensics/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* silent */
  }
}

function scheduleIdleMaintenance(): void {
  const run = (): void => embodiedRuntimePruneStale();
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    queueMicrotask(run);
  }
}

function runEmbodiedCycle(): void {
  if (!isDiagnosticsEnabled()) return;
  const intelligenceReport = buildEmbodimentIntelligenceReport();
  if (!intelligenceReport) return;

  const transitions = getTemporalTransitionLabels();
  const causalGraph = buildEmbodiedCausalGraph({
    failures: intelligenceReport.activeEmbodimentFailures,
    timelineTransitions: transitions,
  });

  const temporalChains = getBehavioralChainsEmbodied().map((c) => ({
    chainId: c.rootCause,
    steps: c.timeline,
    confidence: c.confidence,
  }));

  const summaryText = buildSummary(intelligenceReport);

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__EMBODIMENT_INTELLIGENCE_REPORT = intelligenceReport;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ROOT_CAUSE_GRAPH_EMBODIED = causalGraph;
  }

  void syncEmbodimentReports({
    intelligenceReport,
    rootCauseGraph: causalGraph,
    temporalChains,
    activeFailures: intelligenceReport.activeEmbodimentFailures,
    summaryText,
  });

  embodimentSignalEmitCycleComplete();
  scheduleIdleMaintenance();
}

export function startEmbodiedRuntimeNervousSystem(): void {
  if (typeof window === 'undefined') return;
  if (_started) return;
  if (!isDiagnosticsEnabled()) return;
  _started = true;
  queueMicrotask(() => runEmbodiedCycle());
  _timer = window.setInterval(runEmbodiedCycle, CYCLE_MS);
}

export function stopEmbodiedRuntimeNervousSystem(): void {
  if (_timer != null) {
    window.clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

export function __runEmbodiedForensicsCycleOnceForTests(): void {
  runEmbodiedCycle();
}
