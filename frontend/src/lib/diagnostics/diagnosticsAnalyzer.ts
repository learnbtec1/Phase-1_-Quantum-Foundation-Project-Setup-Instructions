'use client';

/**
 * Autonomous forensic analyzer — runs on a 60s timer only (never inside useFrame).
 * Aggregates store counters, live window.__DIAGNOSTICS, correlation chains, and optional disk sync.
 */

import { DM, METRIC_COUNT } from './diagnosticsMetrics';
import {
  diagCounters,
  diagCountersCopy,
  diagLastConflictBone,
  diagPeekLastCritical,
  diagScalars,
  isDiagnosticsEnabled,
} from './diagnosticsStore';
import { resolveFile, resolveStage, resolveSubsystem } from './diagnosticsRegistry';
import { DiagnosticsSeverity } from './diagnosticsSeverity';
import type {
  AutonomousDiagnosticsReport,
  DiagnosticsRootCauseGraph,
  DiagnosticsWindowSurface,
} from './diagnosticsTypes';
import {
  getBehavioralForensicsChains,
  getTimelineVisualHealthPenalty,
} from './runtimeTimelineRecorder';

const INTERVAL_MS = 60_000;
const FILE_HIST_SIZE = 16;
const STAGE_HIST_SIZE = 16;

/** Reusable buffers — no per-tick allocation on hot paths; analyzer touches these once per minute. */
const _prev = new Uint32Array(METRIC_COUNT);
const _delta = new Uint32Array(METRIC_COUNT);
const _ema = new Float64Array(METRIC_COUNT);
const _fileHist = new Uint32Array(FILE_HIST_SIZE);
const _stageHist = new Uint32Array(STAGE_HIST_SIZE);
let _counterPrimed = false;
let _healthEma = 100;
/** Browser interval id (numeric); avoid NodeJS.Timeout vs DOM mismatch under mixed typings. */
let _timer: number | null = null;
let _started = false;

const METRIC_LABELS: string[] = (() => {
  const a: string[] = new Array(METRIC_COUNT).fill('unused');
  a[DM.INVALID_QUAT_SAMPLE] = 'INVALID_QUAT_SAMPLE';
  a[DM.NAN_ROTATION_SAMPLE] = 'NAN_ROTATION_SAMPLE';
  a[DM.ZERO_LENGTH_QUAT] = 'ZERO_LENGTH_QUAT';
  a[DM.NORMALIZE_FAILURE] = 'NORMALIZE_FAILURE';
  a[DM.NULL_BONE_WRITE_SKIP] = 'NULL_BONE_WRITE_SKIP';
  a[DM.MISSING_HUMANOID] = 'MISSING_HUMANOID';
  a[DM.IDLE_OVERWRITE_GESTURE] = 'IDLE_OVERWRITE_GESTURE';
  a[DM.GESTURE_WEIGHT_COLLAPSE] = 'GESTURE_WEIGHT_COLLAPSE';
  a[DM.AUTHORITY_CONFLICT] = 'AUTHORITY_CONFLICT';
  a[DM.SCHED_BLOCKED_MIN_BETWEEN] = 'SCHED_BLOCKED_MIN_BETWEEN';
  a[DM.SCHED_BLOCKED_RECENT_ACTION] = 'SCHED_BLOCKED_RECENT_ACTION';
  a[DM.SCHED_BLOCKED_VRMA] = 'SCHED_BLOCKED_VRMA';
  a[DM.SCHED_BLOCKED_THINKING] = 'SCHED_BLOCKED_THINKING';
  a[DM.SCHED_BLOCKED_IDLE_RANDOM] = 'SCHED_BLOCKED_IDLE_RANDOM';
  a[DM.SCHED_DISPATCH_OK] = 'SCHED_DISPATCH_OK';
  a[DM.SEMANTIC_COOLDOWN_STARVE] = 'SEMANTIC_COOLDOWN_STARVE';
  a[DM.SEMANTIC_IDLE_FALLBACK] = 'SEMANTIC_IDLE_FALLBACK';
  a[DM.TIMELINE_QUEUE_BACKLOG] = 'TIMELINE_QUEUE_BACKLOG';
  a[DM.TIMELINE_SNAP_SHORT_EVENT] = 'TIMELINE_SNAP_SHORT_EVENT';
  a[DM.ENERGY_SPEAKING_ZERO_RAW] = 'ENERGY_SPEAKING_ZERO_RAW';
  a[DM.ENERGY_STABLE_NAN_GUARD] = 'ENERGY_STABLE_NAN_GUARD';
  a[DM.INTENT_EMPTY_INPUT] = 'INTENT_EMPTY_INPUT';
  a[DM.INTENT_NO_RULE_MATCH] = 'INTENT_NO_RULE_MATCH';
  a[DM.EXCEPTION_CAPTURED] = 'EXCEPTION_CAPTURED';
  a[DM.SAFE_CALL_FAILURE] = 'SAFE_CALL_FAILURE';
  return a;
})();

/** Causal templates — edges implied step[i]→step[i+1]; confidence from trigger metric deltas. */
const CORRELATION_CHAINS: ReadonlyArray<{
  id: string;
  steps: readonly string[];
  triggers: readonly number[];
}> = [
  {
    id: 'gestureEmbodimentCollapse',
    steps: [
      'gestureInvisible',
      'idleOverwrite',
      'weakGestureEnvelope',
      'schedulerCooldown',
      'intentNeutralCollapse',
    ],
    triggers: [
      DM.GESTURE_WEIGHT_COLLAPSE,
      DM.IDLE_OVERWRITE_GESTURE,
      DM.SCHED_BLOCKED_MIN_BETWEEN,
      DM.INTENT_NO_RULE_MATCH,
      DM.SEMANTIC_COOLDOWN_STARVE,
    ],
  },
  {
    id: 'poseIntegrityFailure',
    steps: ['invalidQuaternion', 'normalizeFailure', 'bindFallbackRisk'],
    triggers: [
      DM.INVALID_QUAT_SAMPLE,
      DM.NAN_ROTATION_SAMPLE,
      DM.ZERO_LENGTH_QUAT,
      DM.NORMALIZE_FAILURE,
    ],
  },
  {
    id: 'speechMotionDesync',
    steps: ['ttsActive', 'zeroMotionEnergy', 'weakEmbodiment'],
    triggers: [DM.ENERGY_SPEAKING_ZERO_RAW],
  },
  {
    id: 'authorityOverwriteWar',
    steps: ['layerConflict', 'boneOverride', 'visiblePop'],
    triggers: [DM.AUTHORITY_CONFLICT, DM.IDLE_OVERWRITE_GESTURE],
  },
];

function metricSeverity(idx: number): number {
  if (idx === DM.EXCEPTION_CAPTURED || idx === DM.SAFE_CALL_FAILURE) return DiagnosticsSeverity.CRITICAL;
  if (
    idx === DM.INVALID_QUAT_SAMPLE ||
    idx === DM.NAN_ROTATION_SAMPLE ||
    idx === DM.MISSING_HUMANOID
  ) {
    return DiagnosticsSeverity.ERROR;
  }
  if (
    idx === DM.GESTURE_WEIGHT_COLLAPSE ||
    idx === DM.IDLE_OVERWRITE_GESTURE ||
    idx === DM.AUTHORITY_CONFLICT ||
    idx === DM.ENERGY_SPEAKING_ZERO_RAW
  ) {
    return DiagnosticsSeverity.WARN;
  }
  return DiagnosticsSeverity.INFO;
}

function sumDelta(): number {
  let s = 0;
  for (let i = 0; i < METRIC_COUNT; i++) s += _delta[i];
  return s;
}

function updateCounterDelta(): void {
  const cur = diagCounters();
  if (!_counterPrimed) {
    diagCountersCopy(_prev);
    _counterPrimed = true;
    _delta.fill(0);
    return;
  }
  let totalDelta = 0;
  for (let i = 0; i < METRIC_COUNT; i++) {
    const d = cur[i] - _prev[i];
    _delta[i] = d;
    _prev[i] = cur[i];
    totalDelta += d;
    _ema[i] = _ema[i] * 0.72 + d * 0.28;
  }
  if (totalDelta === 0) {
    for (let i = 0; i < METRIC_COUNT; i++) {
      _ema[i] *= 0.92;
    }
  }
}

function readLiveDiagnostics(): DiagnosticsWindowSurface | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (window as any).__DIAGNOSTICS as DiagnosticsWindowSurface | undefined;
  return d && typeof d === 'object' ? d : null;
}

function buildCorrelationChains(): AutonomousDiagnosticsReport['correlationChains'] {
  const total = sumDelta() + 1;
  const out: AutonomousDiagnosticsReport['correlationChains'] = [];
  for (const c of CORRELATION_CHAINS) {
    let trig = 0;
    const evidence: string[] = [];
    for (const t of c.triggers) {
      const v = _delta[t];
      if (v > 0) evidence.push(`${METRIC_LABELS[t] ?? `m${t}`}=${v}`);
      trig += v;
    }
    const confidence = Math.min(1, trig / total);
    if (confidence > 0.02 || evidence.length > 0) {
      out.push({ chainId: c.id, steps: [...c.steps], confidence: +confidence.toFixed(4), evidenceMetrics: evidence });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

function buildRootCauseGraph(chains: AutonomousDiagnosticsReport['correlationChains']): DiagnosticsRootCauseGraph {
  const nodes = new Map<string, number>();
  const edges: DiagnosticsRootCauseGraph['edges'] = [];
  const top = chains[0];
  if (!top) {
    return { nodes: [], edges: [], dominantChain: [], chainConfidence: 0 };
  }
  for (const step of top.steps) {
    nodes.set(step, (nodes.get(step) ?? 0) + top.confidence);
  }
  for (let i = 0; i < top.steps.length - 1; i++) {
    edges.push({
      from: top.steps[i],
      to: top.steps[i + 1],
      weight: +top.confidence.toFixed(4),
    });
  }
  for (let i = 0; i < METRIC_COUNT; i++) {
    if (_ema[i] < 0.5) continue;
    const label = METRIC_LABELS[i];
    if (label === 'unused') continue;
    nodes.set(label, (nodes.get(label) ?? 0) + _ema[i] * 0.01);
  }
  const nodeArr = [...nodes.entries()]
    .map(([id, weight]) => ({ id, weight: +weight.toFixed(4) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);
  return {
    nodes: nodeArr,
    edges,
    dominantChain: [...top.steps],
    chainConfidence: top.confidence,
  };
}

function pickDominantRootCause(
  chains: AutonomousDiagnosticsReport['correlationChains'],
  live: DiagnosticsWindowSurface | null,
): string {
  if (chains.length > 0 && chains[0].confidence >= 0.08) {
    return `${chains[0].chainId} (${(chains[0].confidence * 100).toFixed(0)}% confidence)`;
  }
  let bestI = -1;
  let bestV = 0;
  for (let i = 0; i < METRIC_COUNT; i++) {
    if (_ema[i] > bestV) {
      bestV = _ema[i];
      bestI = i;
    }
  }
  if (bestI >= 0 && bestV > 0.25) return METRIC_LABELS[bestI] ?? `metric:${bestI}`;
  if (live?.activeFailures?.length) return live.activeFailures[0];
  return 'none_observed';
}

function recurringFailuresTop(): string[] {
  const ranked: { idx: number; v: number }[] = [];
  for (let i = 0; i < METRIC_COUNT; i++) {
    if (_ema[i] > 0.35) ranked.push({ idx: i, v: _ema[i] });
  }
  ranked.sort((a, b) => b.v - a.v);
  return ranked.slice(0, 12).map((r) => `${METRIC_LABELS[r.idx] ?? `m${r.idx}`} (ema=${r.v.toFixed(2)})`);
}

function criticalConflictsList(live: DiagnosticsWindowSurface | null): string[] {
  const out: string[] = [];
  if (_delta[DM.AUTHORITY_CONFLICT] > 0) {
    out.push(`authority_conflict count=${_delta[DM.AUTHORITY_CONFLICT]} bone=${diagLastConflictBone || '?'}`);
  }
  if (_delta[DM.IDLE_OVERWRITE_GESTURE] > 0 || _delta[DM.GESTURE_WEIGHT_COLLAPSE] > 0) {
    out.push(
      `motion_blend_idle_vs_gesture idleOverwriteΔ=${_delta[DM.IDLE_OVERWRITE_GESTURE]} gestureCollapseΔ=${_delta[DM.GESTURE_WEIGHT_COLLAPSE]}`,
    );
  }
  if (_delta[DM.SCHED_BLOCKED_MIN_BETWEEN] > 0) {
    out.push(`scheduler_min_between_blocked Δ=${_delta[DM.SCHED_BLOCKED_MIN_BETWEEN]}`);
  }
  if (live?.execution?.overrideDetected) {
    out.push('execution_override_detected_on_lua_raw_z');
  }
  if (!live?.execution?.orderCorrect && live?.execution?.frameCount) {
    out.push('execution_stage_order_inconsistent');
  }
  return out;
}

function recommendedFixes(dominant: string): string[] {
  const r: string[] = [];
  const d = dominant.toLowerCase();
  if (d.includes('gestureembodiment') || d.includes('idle_overwrite') || d.includes('gesture_weight')) {
    r.push('Raise gesture blend authority during active timeline events / speaking (PoseComposer weights).');
    r.push('Review idleLayerW vs gestureLayerW contract in VRMSkeletonManager when motionSource=GESTURE.');
  }
  if (d.includes('poseintegrity') || d.includes('invalid_quat')) {
    r.push('Trace quaternion sources in PoseComposer / bind-relative arm composition.');
  }
  if (d.includes('speechmotion') || d.includes('energy_speaking_zero')) {
    r.push('Verify viseme/RMS → unified energy bridge and LipSync timing vs motion tick.');
  }
  if (d.includes('authority')) {
    r.push('Audit BoneAuthority priorities for conflicting layers on the same bone.');
  }
  if (d.includes('scheduler')) {
    r.push('Tune motionScheduler min_between / coupling while speaking if gestures starve.');
  }
  if (r.length === 0) r.push('Collect one full 60s window under reproduction; attach window.__DIAGNOSTICS snapshot.');
  return r.slice(0, 8);
}

function subsystemHintForFile(fid: number): string {
  switch (fid) {
    case 1:
      return 'motion';
    case 2:
      return 'pose';
    case 3:
      return 'biomech';
    case 4:
      return 'scheduler';
    case 5:
      return 'semantic';
    case 6:
      return 'timeline';
    case 7:
      return 'speech_energy';
    case 8:
      return 'intent';
    default:
      return resolveSubsystem(diagScalars.lastSubsystemId);
  }
}

function rankFiles(): AutonomousDiagnosticsReport['mostProblematicFiles'] {
  const fid = diagScalars.lastFileId;
  if (fid >= 0 && fid < FILE_HIST_SIZE) _fileHist[fid]++;
  const out: AutonomousDiagnosticsReport['mostProblematicFiles'] = [];
  for (let i = 0; i < FILE_HIST_SIZE; i++) {
    if (_fileHist[i] === 0) continue;
    out.push({
      file: resolveFile(i),
      occurrences: _fileHist[i],
      subsystem: subsystemHintForFile(i),
      severity: DiagnosticsSeverity.WARN,
    });
  }
  out.sort((a, b) => b.occurrences - a.occurrences);
  return out.slice(0, 8);
}

function rankStages(): AutonomousDiagnosticsReport['mostProblematicFunctions'] {
  const sid = diagScalars.lastStageId;
  if (sid >= 0 && sid < STAGE_HIST_SIZE) _stageHist[sid]++;
  const out: AutonomousDiagnosticsReport['mostProblematicFunctions'] = [];
  for (let i = 0; i < STAGE_HIST_SIZE; i++) {
    if (_stageHist[i] === 0) continue;
    out.push({
      function: resolveStage(i),
      occurrences: _stageHist[i],
      subsystem: resolveSubsystem(diagScalars.lastSubsystemId),
      severity:
        _delta[DM.EXCEPTION_CAPTURED] > 0 || _delta[DM.SAFE_CALL_FAILURE] > 0
          ? DiagnosticsSeverity.ERROR
          : DiagnosticsSeverity.INFO,
    });
  }
  out.sort((a, b) => b.occurrences - a.occurrences);
  return out.slice(0, 8);
}

function embodimentFailuresList(): string[] {
  const o: string[] = [];
  if (_delta[DM.TIMELINE_SNAP_SHORT_EVENT] > 0) {
    o.push(`timeline_snap_short Δ=${_delta[DM.TIMELINE_SNAP_SHORT_EVENT]}`);
  }
  if (_delta[DM.TIMELINE_QUEUE_BACKLOG] > 0) {
    o.push(`timeline_queue_backlog Δ=${_delta[DM.TIMELINE_QUEUE_BACKLOG]}`);
  }
  return o;
}

function unresolvedCriticalsList(): string[] {
  const { msg, stack } = diagPeekLastCritical();
  if (!msg) return [];
  const tail = stack ? stack.split('\n').slice(0, 2).join(' | ') : '';
  return [`${msg}${tail ? ` :: ${tail}` : ''}`];
}

export function buildRuntimeSummaryTxt(report: AutonomousDiagnosticsReport): string {
  const lines: string[] = [];
  const degraded = report.runtimeHealthScore < 72;
  lines.push('[SUMMARY]');
  lines.push(degraded ? 'Runtime health degraded.' : 'Runtime health acceptable.');
  lines.push('');
  lines.push('Primary failure:');
  lines.push(report.dominantRootCause || 'none');
  lines.push('');
  const topFile = report.mostProblematicFiles[0];
  lines.push('Most affected file:');
  lines.push(topFile ? topFile.file : '—');
  lines.push('');
  lines.push('Most affected subsystem:');
  lines.push(topFile ? topFile.subsystem : resolveSubsystem(diagScalars.lastSubsystemId));
  lines.push('');
  lines.push('Evidence:');
  const m = report.motionState as { gestureLayerW?: number; idleLayerW?: number };
  if (m?.gestureLayerW !== undefined && m?.idleLayerW !== undefined) {
    lines.push(`gestureWeight=${Number(m.gestureLayerW).toFixed(2)}`);
    lines.push(`idleWeight=${Number(m.idleLayerW).toFixed(2)}`);
  }
  if (report.recurringFailures.length) {
    lines.push(`recurring (ema window): ${report.recurringFailures.slice(0, 4).join('; ')}`);
  }
  lines.push('');
  lines.push('Recommended fix:');
  lines.push(report.recommendedNextFixes[0] ?? 'Monitor next 60s window.');
  lines.push('');
  if (report.correlationChains[0]) {
    lines.push('Dominant correlation chain:');
    lines.push(report.correlationChains[0].steps.join(' → '));
    lines.push(`confidence=${(report.correlationChains[0].confidence * 100).toFixed(1)}%`);
  }
  return lines.join('\n');
}

async function syncReportsToServer(report: AutonomousDiagnosticsReport, summaryText: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_DIAGNOSTICS_ANALYZER_SYNC ?? '1').trim() === '0') return;
  try {
    await fetch('/api/diagnostics/analyzer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report, summaryText }),
      keepalive: true,
    });
  } catch {
    /* silent — disk sync is best-effort */
  }
}

function runAnalysisCycle(): void {
  if (!isDiagnosticsEnabled()) return;

  updateCounterDelta();

  const live = readLiveDiagnostics();
  const chains = buildCorrelationChains();
  const dominant = pickDominantRootCause(chains, live);
  const graph = buildRootCauseGraph(chains);

  const liveHealth = live?.runtimeHealthScore ?? _healthEma;
  _healthEma = _healthEma * 0.45 + liveHealth * 0.55;
  const runtimeHealthScore = Math.max(0, Math.min(100, Math.round(_healthEma)));

  const behavioralForensicsChains = getBehavioralForensicsChains();
  const visualEmbodimentPenalty = getTimelineVisualHealthPenalty();

  const report: AutonomousDiagnosticsReport = {
    timestamp: new Date().toISOString(),
    runtimeHealthScore,
    dominantRootCause: dominant,
    recurringFailures: recurringFailuresTop(),
    criticalConflicts: criticalConflictsList(live),
    mostProblematicFiles: rankFiles(),
    mostProblematicFunctions: rankStages(),
    motionState: live?.motion ? { ...live.motion } : {},
    schedulerState: live?.scheduler ? { ...live.scheduler } : {},
    vrmState: live?.vrm ? { ...live.vrm } : {},
    speechState: live?.speech ? { ...live.speech } : {},
    authorityConflicts:
      live?.authority?.lastConflictBone && live.authority.conflictsSinceFlush
        ? [`${live.authority.lastConflictBone}:${live.authority.conflictsSinceFlush}`]
        : diagLastConflictBone
          ? [diagLastConflictBone]
          : [],
    embodimentFailures: embodimentFailuresList(),
    unresolvedCriticals: unresolvedCriticalsList(),
    recommendedNextFixes: recommendedFixes(dominant),
    correlationChains: chains,
    behavioralForensicsChains,
    visualEmbodimentPenalty,
  };

  const summaryText = buildRuntimeSummaryTxt(report);

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__DIAGNOSTICS_REPORT = report;
    w.__RUNTIME_HEALTH = runtimeHealthScore;
    w.__ROOT_CAUSE_GRAPH = graph;
  }

  void syncReportsToServer(report, summaryText);
}

export function startDiagnosticsAnalyzer(): void {
  if (typeof window === 'undefined') return;
  if (_started) return;
  if (!isDiagnosticsEnabled()) return;
  _started = true;
  _timer = window.setInterval(runAnalysisCycle, INTERVAL_MS);
}

export function stopDiagnosticsAnalyzer(): void {
  if (_timer != null) {
    window.clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}

export function __runDiagnosticsAnalyzerOnceForTests(): void {
  runAnalysisCycle();
}
