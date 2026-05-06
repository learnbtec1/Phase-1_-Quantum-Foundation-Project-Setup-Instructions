import { DM, METRIC_COUNT } from './diagnosticsMetrics';
import type { DiagnosticsSeverityId } from './diagnosticsSeverity';
import type {
  DiagnosticsAuthoritySnapshot,
  DiagnosticsEmbodimentSnapshot,
  DiagnosticsExecutionSnapshot,
  DiagnosticsMotionSnapshot,
  DiagnosticsRootCauseNode,
  DiagnosticsSchedulerSnapshot,
  DiagnosticsSpeechSnapshot,
  DiagnosticsVrmSnapshot,
  DiagnosticsWindowSurface,
  DiagnosticsCriticalEvent,
  ProjectDiagnosticsReport,
} from './diagnosticsTypes';
import {
  ROOT_GRAPH,
  resolveFile,
  resolveStage,
  resolveSubsystem,
} from './diagnosticsRegistry';
import {
  diagCounters,
  diagLastCritical,
  diagPeekLastCritical,
  diagLastConflictBone,
  diagScalars,
  isDiagnosticsEnabled,
} from './diagnosticsStore';
import { diagnosticsSchedulerConsumeFlush } from './diagnosticsScheduler';
import { getTimelineVisualHealthPenalty } from './runtimeTimelineRecorder';
import { cognitionOnDiagnosticsFlush } from '@/lib/cognition/cognitionDiagnosticsBridge';

const FLUSH_MS = 280;
let _lastFlushMs = 0;
let _flushSeq = 0;

const _delta = new Uint32Array(METRIC_COUNT);
const _prev = new Uint32Array(METRIC_COUNT);
let _deltaPrimed = false;

/** Lazily attached shell — expanded on first flush (infrequent alloc). */
let _shell: DiagnosticsWindowSurface | null = null;

function ensureShell(): DiagnosticsWindowSurface {
  if (_shell) return _shell;
  const execution: DiagnosticsExecutionSnapshot = {
    frameCount: 0,
    measuredFps: 0,
    earlyReturnReason: null,
    stages: {
      motion: false,
      applyFinalPose: false,
      humanoidUpdate1: false,
      biomechanical: false,
      humanoidUpdate2: false,
    },
    timingsMs: { motionToFinalPose: 0, totalFrameMs: 0 },
    orderCorrect: false,
    overrideDetected: false,
  };
  const motion: DiagnosticsMotionSnapshot = {
    motionSource: '',
    gestureState: '',
    gestureLayerW: 0,
    idleLayerW: 0,
    vrmaLayerW: 0,
    generativeLayerW: 0,
    idleDominatesGesture: false,
    armDeviationLuaRad: null,
    finalPoseBoneCount: 0,
  };
  const scheduler: DiagnosticsSchedulerSnapshot = {
    lastBlockReasonId: 0,
    lastBlockReasonLabel: '',
    blocksSinceFlush: 0,
  };
  const vrm: DiagnosticsVrmSnapshot = {
    humanoidPresent: false,
    autoUpdateHumanBones: null,
    invalidQuatSamplesSinceFlush: 0,
    nullBoneSamplesSinceFlush: 0,
  };
  const speech: DiagnosticsSpeechSnapshot = {
    speaking: false,
    motionEnergyUnified: 0,
    stableMotionEnergy: 0,
    speakingZeroEnergy: false,
  };
  const authority: DiagnosticsAuthoritySnapshot = {
    conflictsSinceFlush: 0,
    lastConflictBone: '',
  };
  const embodiment: DiagnosticsEmbodimentSnapshot = {
    behaviorQueueDepth: 0,
    timelineEnvelope: 0,
    semanticCooldownHitsSinceFlush: 0,
    lowIntentConfidenceSinceFlush: 0,
  };
  _shell = {
    execution,
    motion,
    scheduler,
    vrm,
    speech,
    authority,
    embodiment,
    rootCauses: [],
    activeFailures: [],
    lastCriticalEvent: null,
    runtimeHealthScore: 100,
    updatedAt: 0,
    flushCount: 0,
  };
  return _shell;
}

function computeHealthFromDelta(d: Uint32Array): number {
  let score = 100;
  score -= Math.min(25, (d[DM.INVALID_QUAT_SAMPLE] + d[DM.NAN_ROTATION_SAMPLE]) * 6);
  score -= Math.min(20, d[DM.EXCEPTION_CAPTURED] * 15);
  score -= Math.min(15, d[DM.GESTURE_WEIGHT_COLLAPSE] * 5);
  score -= Math.min(15, d[DM.ENERGY_SPEAKING_ZERO_RAW] * 8);
  score -= Math.min(10, d[DM.MISSING_HUMANOID] * 10);
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

function buildRootCauses(d: Uint32Array): DiagnosticsRootCauseNode[] {
  const out: DiagnosticsRootCauseNode[] = [];
  for (const node of ROOT_GRAPH) {
    let hit = false;
    const evidence: string[] = [];
    for (const idx of node.whenMetricAboveZero) {
      const v = d[idx];
      if (v > 0) {
        hit = true;
        evidence.push(`metric[${idx}]=${v}`);
      }
    }
    if (hit) {
      out.push({
        id: node.id,
        severity: node.severity as DiagnosticsSeverityId,
        summary: node.summary,
        evidence,
        children: [...node.children],
      });
    }
  }
  return out;
}

let _lastPostAt = 0;
const POST_INTERVAL_MS = 12_000;

async function maybePostReport(report: ProjectDiagnosticsReport): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_DIAGNOSTICS_SYNC_FILE ?? '') !== '1') return;
  const now = performance.now();
  if (now - _lastPostAt < POST_INTERVAL_MS) return;
  _lastPostAt = now;
  try {
    await fetch('/api/diagnostics/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    });
  } catch {
    /* non-blocking */
  }
}

export interface DiagnosticsFlushMotionCtx {
  motionSource: string;
  gestureState: string;
  gestureLayerW: number;
  idleLayerW: number;
  vrmaLayerW: number;
  generativeLayerW: number;
  idleDominatesGesture: boolean;
  armDeviationLuaRad: number | null;
  finalPoseBoneCount: number;
}

export interface DiagnosticsFlushExecCtx {
  frameCount: number;
  measuredFps: number;
  earlyReturnReason: string | null;
  s_motionExecuted: boolean;
  s_finalPoseExecuted: boolean;
  s_humanoid1Executed: boolean;
  s_biomechExecuted: boolean;
  s_humanoid2Executed: boolean;
  s_motionEnd: number;
  s_finalPoseEnd: number;
  s_frameEnd: number;
  orderCorrect: boolean;
  overrideDetected: boolean;
}

export interface DiagnosticsFlushSpeechCtx {
  speaking: boolean;
  motionEnergyUnified: number;
  stableMotionEnergy: number;
}

export interface DiagnosticsFlushVrmCtx {
  humanoidPresent: boolean;
  autoUpdateHumanBones: boolean | null;
}

export interface DiagnosticsFlushEmbodimentCtx {
  behaviorQueueDepth: number;
  timelineEnvelope: number;
}

/**
 * Throttled flush — builds arrays here only (not per frame).
 */
export function diagnosticsReporterFlush(
  nowMs: number,
  parts: {
    execution: DiagnosticsFlushExecCtx;
    motion: DiagnosticsFlushMotionCtx;
    speech: DiagnosticsFlushSpeechCtx;
    vrm: DiagnosticsFlushVrmCtx;
    embodiment: DiagnosticsFlushEmbodimentCtx;
  },
): void {
  if (!isDiagnosticsEnabled()) return;
  if (nowMs - _lastFlushMs < FLUSH_MS) return;
  _lastFlushMs = nowMs;
  _flushSeq++;

  const cur = diagCounters();
  if (!_deltaPrimed) {
    for (let i = 0; i < METRIC_COUNT; i++) _prev[i] = cur[i];
    _deltaPrimed = true;
    _delta.fill(0);
  } else {
    for (let i = 0; i < METRIC_COUNT; i++) {
      _delta[i] = cur[i] - _prev[i];
      _prev[i] = cur[i];
    }
  }

  const schedSnap = diagnosticsSchedulerConsumeFlush();

  const shell = ensureShell();
  const { execution: ex, motion: mo, scheduler: sc, vrm: vr, speech: sp, authority: au, embodiment: em } =
    shell;

  const ectx = parts.execution;
  ex.frameCount = ectx.frameCount;
  ex.measuredFps = ectx.measuredFps;
  ex.earlyReturnReason = ectx.earlyReturnReason;
  ex.stages.motion = ectx.s_motionExecuted;
  ex.stages.applyFinalPose = ectx.s_finalPoseExecuted;
  ex.stages.humanoidUpdate1 = ectx.s_humanoid1Executed;
  ex.stages.biomechanical = ectx.s_biomechExecuted;
  ex.stages.humanoidUpdate2 = ectx.s_humanoid2Executed;
  ex.timingsMs.motionToFinalPose = Math.max(0, ectx.s_finalPoseEnd - ectx.s_motionEnd);
  ex.timingsMs.totalFrameMs = Math.max(0, ectx.s_frameEnd - ectx.s_motionEnd);
  ex.orderCorrect = ectx.orderCorrect;
  ex.overrideDetected = ectx.overrideDetected;

  mo.motionSource = parts.motion.motionSource;
  mo.gestureState = parts.motion.gestureState;
  mo.gestureLayerW = parts.motion.gestureLayerW;
  mo.idleLayerW = parts.motion.idleLayerW;
  mo.vrmaLayerW = parts.motion.vrmaLayerW;
  mo.generativeLayerW = parts.motion.generativeLayerW;
  mo.idleDominatesGesture = parts.motion.idleDominatesGesture;
  mo.armDeviationLuaRad = parts.motion.armDeviationLuaRad;
  mo.finalPoseBoneCount = parts.motion.finalPoseBoneCount;

  sc.blocksSinceFlush = schedSnap.blocksSinceFlush;
  sc.lastBlockReasonLabel = schedSnap.lastBlockReasonLabel;
  sc.lastBlockReasonId = 0;

  vr.humanoidPresent = parts.vrm.humanoidPresent;
  vr.autoUpdateHumanBones = parts.vrm.autoUpdateHumanBones;
  vr.invalidQuatSamplesSinceFlush = _delta[DM.INVALID_QUAT_SAMPLE];
  vr.nullBoneSamplesSinceFlush = _delta[DM.NULL_BONE_WRITE_SKIP];

  sp.speaking = parts.speech.speaking;
  sp.motionEnergyUnified = parts.speech.motionEnergyUnified;
  sp.stableMotionEnergy = parts.speech.stableMotionEnergy;
  sp.speakingZeroEnergy = parts.speech.speaking && parts.speech.motionEnergyUnified < 1e-4;

  au.conflictsSinceFlush = _delta[DM.AUTHORITY_CONFLICT];
  au.lastConflictBone = diagLastConflictBone;

  em.behaviorQueueDepth = parts.embodiment.behaviorQueueDepth;
  em.timelineEnvelope = parts.embodiment.timelineEnvelope;
  em.semanticCooldownHitsSinceFlush = _delta[DM.SEMANTIC_COOLDOWN_STARVE];
  em.lowIntentConfidenceSinceFlush = _delta[DM.INTENT_NO_RULE_MATCH] + _delta[DM.INTENT_EMPTY_INPUT];

  shell.rootCauses = buildRootCauses(_delta);
  shell.activeFailures = shell.rootCauses.map((r) => r.id);
  const baseHealth = computeHealthFromDelta(_delta);
  const visualPen = getTimelineVisualHealthPenalty();
  shell.runtimeHealthScore = Math.max(0, Math.min(100, baseHealth - visualPen));
  shell.updatedAt = nowMs;
  shell.flushCount = _flushSeq;

  const { msg: critMsg, stack: critStack } = diagPeekLastCritical();
  if (critMsg.length > 0) {
    const ev: DiagnosticsCriticalEvent = {
      ts: diagLastCritical.ts,
      severity: diagLastCritical.severity as DiagnosticsSeverityId,
      subsystem: resolveSubsystem(diagLastCritical.subsystemId),
      message: critMsg,
      file: resolveFile(diagLastCritical.fileId),
      fn: `fnId:${diagLastCritical.fnId}`,
      lineHint: diagLastCritical.lineHint,
      stack: critStack,
    };
    shell.lastCriticalEvent = ev;
  } else {
    shell.lastCriticalEvent = null;
  }

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__DIAGNOSTICS = shell;
    cognitionOnDiagnosticsFlush(shell);
  }

  const affectedFiles = new Set<string>();
  affectedFiles.add(resolveFile(diagLastCritical.fileId));
  affectedFiles.add(resolveFile(diagScalars.lastFileId));

  const report: ProjectDiagnosticsReport = {
    version: 1,
    timestamp: new Date().toISOString(),
    runtimeHealthScore: shell.runtimeHealthScore,
    failures: shell.activeFailures,
    rootCauses: shell.rootCauses,
    lastCriticalEvent: shell.lastCriticalEvent,
    subsystemState: {
      execution: { ...shell.execution },
      motion: { ...shell.motion },
      scheduler: { ...shell.scheduler },
      vrm: { ...shell.vrm },
      speech: { ...shell.speech },
      authority: { ...shell.authority },
      embodiment: { ...shell.embodiment },
    },
    affectedFiles: [...affectedFiles],
    affectedFunctions: [resolveStage(diagScalars.lastStageId)],
    confidenceScore: shell.runtimeHealthScore / 100,
  };

  void maybePostReport(report);
}
