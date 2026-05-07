/**
 * Pure helpers for autonomous repair governor — parse disk-backed JSON shapes only.
 */

export type RepairGovernorFailureRef = {
  id: string;
  subsystem?: string;
  summary?: string;
  severity?: string;
  confidence: number;
  sources: string[];
  evidence?: string[];
};

const VERIFIED_SPATIAL_BUCKETS = [
  'verifiedSpatialFailures',
  'verifiedDirectionFailures',
  'verifiedQuaternionFailures',
  'verifiedCameraProjectionFailures',
  'verifiedGestureVisibilityFailures',
  'verifiedHumanoidPropagationFailures',
  'verifiedFingerFailures',
  'verifiedGroundingFailures',
  'verifiedAuthorityExecutionConflicts',
] as const;

export function parseDominantRootPct(text: string): number | null {
  const m = /\((\d+(?:\.\d+)?)%\s*confidence\)/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** True when project diagnostics report a dominant cause at or above verification threshold. */
export function dominantVerifiedRootCauseActive(
  proj: unknown,
  forensic: unknown,
  minPct = 55,
): boolean {
  const dom =
    proj && typeof proj === 'object' ? String((proj as Record<string, unknown>).dominantRootCause ?? '').trim() : '';
  const pct = parseDominantRootPct(dom);
  if (pct != null) return pct >= minPct;
  if (!dom || /defer|insufficient|none|n\/a|unknown\b/i.test(dom)) return false;

  const ftxt =
    forensic && typeof forensic === 'object'
      ? String((forensic as Record<string, unknown>).dominantTrustedRootCause ?? '').trim()
      : '';
  if (ftxt && !/defer|insufficient fresh telemetry/i.test(ftxt) && ftxt.length > 14) return true;

  return dom.length > 24;
}

export function extractSpatialFinalVerifiedFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const o = j as Record<string, unknown>;
  if (o.telemetryFresh === false) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const bucket of VERIFIED_SPATIAL_BUCKETS) {
    const arr = o[bucket];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      const id = String(f.id ?? '');
      const conf = Number(f.confidence);
      if (!id || !Number.isFinite(conf)) continue;
      out.push({
        id: `spatial:${bucket}:${id}`,
        subsystem: f.subsystem != null ? String(f.subsystem) : 'spatial',
        summary: f.summary != null ? String(f.summary) : undefined,
        confidence: conf,
        sources: [source],
        evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : undefined,
      });
    }
  }
  return out;
}

export function extractPredictiveFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
  minConf: number,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const arr = (j as Record<string, unknown>).predictedFailures;
  if (!Array.isArray(arr)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const id = String(f.id ?? '');
    const prob = Number(f.probability);
    if (!id || !Number.isFinite(prob) || prob < minConf) continue;
    out.push({
      id: `predictive:${id}`,
      subsystem: 'predictive_motion',
      summary: f.narrative != null ? String(f.narrative) : id,
      confidence: prob,
      sources: [source],
      evidence: [
        `horizonMs=${f.horizonMs != null ? String(f.horizonMs) : ''}`,
        `p=${prob.toFixed(3)}`,
      ].filter(Boolean),
    });
  }
  return out;
}

export function extractExecutionChainFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
  minConf: number,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const chains = (j as Record<string, unknown>).chains;
  if (!Array.isArray(chains)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const c of chains) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const chainId = String(o.chainId ?? 'chain');
    const adj = Number(o.adjustedConfidence);
    const valid = o.valid === true;
    const conf = Number.isFinite(adj) ? adj : Number(o.confidence ?? 0);
    if (!Number.isFinite(conf) || conf < minConf) continue;
    if (valid) continue;
    out.push({
      id: `exec_chain_invalid:${chainId}`,
      subsystem: 'execution_chain',
      summary: `Invalidated execution chain ${chainId}`,
      confidence: conf,
      sources: [source],
      evidence: [
        o.invalidationReason != null ? String(o.invalidationReason) : '',
        `adjustedConfidence=${conf.toFixed(3)}`,
      ].filter(Boolean),
    });
  }
  return out;
}

export function extractProjectConflictFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const o = j as Record<string, unknown>;
  const out: RepairGovernorFailureRef[] = [];
  const crit = o.criticalConflicts;
  const auth = o.authorityConflicts;
  if (Array.isArray(crit) && crit.length > 0) {
    out.push({
      id: 'project:critical_conflicts',
      subsystem: 'scheduler',
      summary: `Project diagnostics critical conflicts (${crit.length})`,
      confidence: 0.72,
      sources: [source],
      evidence: crit.map(String).slice(0, 12),
    });
  }
  if (Array.isArray(auth) && auth.length > 0) {
    out.push({
      id: 'project:authority_conflicts',
      subsystem: 'motion_authority',
      summary: `Authority conflicts recorded (${auth.length})`,
      confidence: 0.68,
      sources: [source],
      evidence: auth.map(String).slice(0, 12),
    });
  }
  return out;
}

export function extractCorrelationFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
  minConf: number,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const chains = (j as Record<string, unknown>).correlationChains;
  if (!Array.isArray(chains)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const c of chains) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const chainId = String(o.chainId ?? 'correlation');
    const conf = Number(o.confidence);
    if (!Number.isFinite(conf) || conf < minConf) continue;
    out.push({
      id: `correlation:${chainId}`,
      subsystem: 'gesture_intent',
      summary: `Correlation chain ${chainId}`,
      confidence: conf,
      sources: [source],
      evidence: Array.isArray(o.evidenceMetrics) ? o.evidenceMetrics.map(String) : undefined,
    });
  }
  return out;
}

export function extractEmbodimentIntelFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const o = j as Record<string, unknown>;
  const buckets = [
    'activeEmbodimentFailures',
    'activeLipsyncFailures',
    'activeAuthorityFailures',
    'activeSpatialFailures',
    'activeSchedulerFailures',
    'activeSemanticFailures',
  ] as const;
  const out: RepairGovernorFailureRef[] = [];
  for (const b of buckets) {
    const arr = o[b];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      const id = String(f.id ?? '');
      const conf = Number(f.confidence);
      if (!id || !Number.isFinite(conf)) continue;
      out.push({
        id,
        subsystem: f.subsystem != null ? String(f.subsystem) : undefined,
        summary: f.summary != null ? String(f.summary) : undefined,
        severity: f.severity != null ? String(f.severity) : undefined,
        confidence: conf,
        sources: [source],
        evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : undefined,
      });
    }
  }
  return out;
}

export function extractActiveEmbodimentArray(
  j: unknown,
  source: string,
  inWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!inWindow || !Array.isArray(j)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const item of j) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const id = String(f.id ?? '');
    const conf = Number(f.confidence);
    if (!id || !Number.isFinite(conf)) continue;
    out.push({
      id,
      subsystem: f.subsystem != null ? String(f.subsystem) : undefined,
      summary: f.summary != null ? String(f.summary) : undefined,
      severity: f.severity != null ? String(f.severity) : undefined,
      confidence: conf,
      sources: [source],
      evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : undefined,
    });
  }
  return out;
}

export function hasEmbodimentCollapseDiag(diag: unknown, minConf: number): boolean {
  if (!diag || typeof diag !== 'object') return false;
  const chains = (diag as Record<string, unknown>).correlationChains;
  if (!Array.isArray(chains)) return false;
  return chains.some((c) => {
    if (!c || typeof c !== 'object') return false;
    const o = c as Record<string, unknown>;
    const id = String(o.chainId ?? '');
    const conf = Number(o.confidence);
    return /gestureEmbodiment|collapse/i.test(id) && Number.isFinite(conf) && conf >= minConf;
  });
}

export function hasExecutionConflictsDiag(diag: unknown): boolean {
  if (!diag || typeof diag !== 'object') return false;
  const o = diag as Record<string, unknown>;
  const crit = o.criticalConflicts;
  const auth = o.authorityConflicts;
  return (Array.isArray(crit) && crit.length > 0) || (Array.isArray(auth) && auth.length > 0);
}

function normChainKey(chainId: string): string {
  return chainId.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Normalized keys from execution_chain_validation.json — corroborates project correlation chains. */
export function executionValidationChainKeys(execJson: unknown): Set<string> {
  const set = new Set<string>();
  if (!execJson || typeof execJson !== 'object') return set;
  const chains = (execJson as Record<string, unknown>).chains;
  if (!Array.isArray(chains)) return set;
  for (const c of chains) {
    if (!c || typeof c !== 'object') continue;
    const id = String((c as Record<string, unknown>).chainId ?? '').trim();
    if (!id) continue;
    set.add(id);
    set.add(normChainKey(id));
  }
  return set;
}

/** Multi-report gate: project correlation chain must appear in execution-chain validation artifact. */
export function correlationExecChainCorroborated(correlationChainId: string, execJson: unknown): boolean {
  const keys = executionValidationChainKeys(execJson);
  const raw = correlationChainId.trim();
  return keys.has(raw) || keys.has(normChainKey(raw));
}

export function extractBoneAuthorityVerifiedFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const arr = (j as Record<string, unknown>).verifiedFailures;
  if (!Array.isArray(arr)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const id = String(f.id ?? '');
    const conf = Number(f.confidence);
    if (!id || !Number.isFinite(conf)) continue;
    out.push({
      id: `bone_authority:${id}`,
      subsystem: f.subsystem != null ? String(f.subsystem) : 'motion_authority',
      summary: f.summary != null ? String(f.summary) : undefined,
      confidence: conf,
      sources: [source],
      evidence: Array.isArray(f.evidence) ? f.evidence.map(String) : undefined,
    });
  }
  return out;
}

/**
 * Third-priority forensic: newest runtime_timelines/*.json snapshot (mtime-windowed by inspect route).
 */
export function extractRuntimeTimelineFailures(
  snapshot: unknown,
  timelineSourceLabel: string,
  timelineInWindow: boolean,
): RepairGovernorFailureRef[] {
  if (!timelineInWindow || !snapshot || typeof snapshot !== 'object') return [];
  const s = snapshot as Record<string, unknown>;
  const emb = (s.embodimentState ?? {}) as Record<string, unknown>;
  const speaking = s.speaking === true;
  const gestureLayerW = Number(s.gestureLayerW ?? 0);
  const semanticGesture = String(s.semanticGesture ?? '');
  const gestureEnvelope = Number(s.gestureEnvelope ?? 0);
  const finalArm = Number(s.finalArmMagnitude ?? 0);
  const vrm = (s.vrmState ?? {}) as Record<string, unknown>;
  const invalidQuat = Number(vrm.invalidQuatSamplesSinceFlush ?? 0);
  const out: RepairGovernorFailureRef[] = [];

  if (emb.armFrozen === true) {
    out.push({
      id: 'timeline:arm_frozen',
      subsystem: 'spatial',
      summary:
        'Rolling timeline indicates frozen arms vs envelope — T-pose / invisible conversational motion risk',
      confidence: 0.62,
      sources: [timelineSourceLabel],
      evidence: [
        `gestureEnvelope=${gestureEnvelope.toFixed(3)}`,
        `finalArmMagnitude=${finalArm.toFixed(4)}`,
        `phaseTag=${String(s.phaseTag ?? '')}`,
      ],
    });
  }
  if (emb.idleDominating === true && speaking) {
    out.push({
      id: 'timeline:idle_authority_during_speech',
      subsystem: 'motion_authority',
      summary: 'Rolling timeline: idle authority dominating during speech (gesture starvation)',
      confidence: 0.58,
      sources: [timelineSourceLabel],
      evidence: [`motionSource=${String(s.motionSource ?? '')}`, `idleLayerW=${Number(s.idleLayerW ?? 0).toFixed(2)}`],
    });
  }
  if (emb.gestureCollapseRisk === true) {
    out.push({
      id: 'timeline:gesture_collapse_risk',
      subsystem: 'gesture_intent',
      summary: 'Rolling timeline sustained gesture collapse risk (speech + semantic gesture vs IDLE blend)',
      confidence: 0.61,
      sources: [timelineSourceLabel],
      evidence: [`semanticGesture=${semanticGesture}`, `gestureLayerW=${gestureLayerW.toFixed(2)}`],
    });
  }
  if (speaking && emb.gestureVisible === false && (gestureLayerW > 0.06 || semanticGesture !== 'idle')) {
    out.push({
      id: 'timeline:invisible_gesture_while_speaking',
      subsystem: 'camera_room',
      summary: 'Rolling timeline: gesture marked invisible during speech while semantic channel expects motion',
      confidence: 0.59,
      sources: [timelineSourceLabel],
      evidence: [`semanticGesture=${semanticGesture}`, `gestureLayerW=${gestureLayerW.toFixed(2)}`],
    });
  }
  if (invalidQuat > 0) {
    out.push({
      id: 'timeline:vrm_invalid_quaternion_proxy',
      subsystem: 'vrm_skeleton',
      summary: 'Rolling timeline snapshot carries non-zero invalid quaternion counter since flush',
      confidence: 0.66,
      sources: [timelineSourceLabel],
      evidence: [`invalidQuatSamplesSinceFlush=${invalidQuat}`],
    });
  }

  return out;
}

const GRAPH_STRESS_SUBSYSTEMS = new Set([
  'motion_authority',
  'vrm_skeleton',
  'scheduler',
  'spatial',
  'semantic_bridge',
]);

/** First-priority temporal_behavior_chains.json — array of { chainId, steps, confidence }. */
export function extractTemporalBehaviorChainsFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
  minConf: number,
): RepairGovernorFailureRef[] {
  if (!inWindow || !Array.isArray(j)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const item of j) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const chainId = String(o.chainId ?? 'temporal');
    const conf = Number(o.confidence);
    if (!Number.isFinite(conf) || conf < minConf) continue;
    out.push({
      id: `temporal_chain:${chainId}`,
      subsystem: 'timeline',
      summary: `Temporal behavior chain ${chainId}`,
      confidence: conf,
      sources: [source],
      evidence: Array.isArray(o.steps) ? o.steps.map(String).slice(0, 14) : undefined,
    });
  }
  return out;
}

/** First-priority root_cause_graph.json — elevated subsystem weights from embodied causal graph. */
export function extractRootCauseGraphStressFailures(
  j: unknown,
  source: string,
  inWindow: boolean,
  minConf: number,
): RepairGovernorFailureRef[] {
  if (!inWindow || !j || typeof j !== 'object') return [];
  const o = j as Record<string, unknown>;
  const nodes = o.nodes;
  const dominantPath = o.dominantPath;
  const pathStr =
    Array.isArray(dominantPath) ? dominantPath.map(String).slice(0, 8).join('→') : '';
  if (!Array.isArray(nodes)) return [];
  const out: RepairGovernorFailureRef[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    const id = String(node.id ?? '');
    const subsystem = String(node.subsystem ?? '');
    const w = Number(node.weight);
    if (!id || !GRAPH_STRESS_SUBSYSTEMS.has(subsystem) || !Number.isFinite(w) || w < 1.55) continue;
    const conf = Math.min(0.9, 0.55 + Math.min(w / 6, 0.34));
    if (conf < minConf) continue;
    out.push({
      id: `root_graph:node:${id}`,
      subsystem,
      summary: `Root-cause graph subsystem stress (${subsystem}) at ${id} weight=${w.toFixed(2)}`,
      confidence: conf,
      sources: [source],
      evidence: [`dominantPath=${pathStr}`, `weight=${w.toFixed(3)}`],
    });
  }
  return out;
}

export const REPAIR_GOVERNOR_MIN_CONFIDENCE = 0.55;

/**
 * Strict ACTIVE lane — requires corroboration rules from mission (multi-report / execution validation).
 */
export function passesStrictRepairEvidence(
  f: RepairGovernorFailureRef,
  execJson: unknown,
  projInWindow: boolean,
  timelineInWindow: boolean,
  rootCauseGraphInWindow: boolean,
): boolean {
  if (f.sources.length >= 2) return true;
  if (f.id.startsWith('spatial:')) return true;
  if (f.id.startsWith('bone_authority:')) return true;
  if (f.id.startsWith('project:')) return true;
  if (f.id.startsWith('exec_chain_invalid:')) return true;
  if (f.id.startsWith('correlation:')) {
    const chainId = f.id.slice('correlation:'.length);
    return correlationExecChainCorroborated(chainId, execJson);
  }
  if (f.id.startsWith('temporal_chain:')) {
    const chainId = f.id.slice('temporal_chain:'.length);
    return correlationExecChainCorroborated(chainId, execJson);
  }
  if (f.id.startsWith('timeline:')) {
    return projInWindow && timelineInWindow;
  }
  if (f.id.startsWith('root_graph:')) {
    return projInWindow && rootCauseGraphInWindow;
  }
  return false;
}

export type InspectFilesMap = Record<string, { inWindow?: boolean; json?: unknown | null }>;

export type LatestTimelineInspect = {
  name?: string;
  inWindow?: boolean;
  json?: unknown | null;
} | null;

/** Single pass: aggregate all parser outputs (caller re-invokes after surgical hook for disk Step 7–8). */
export function collectRepairGovernorFailuresFromDiskPayload(args: {
  files: InspectFilesMap;
  latestTimeline: LatestTimelineInspect;
  minConfidence: number;
}): RepairGovernorFailureRef[] {
  const { files: F, latestTimeline: tl, minConfidence } = args;
  const inWin = (name: string): boolean => F[name]?.inWindow ?? false;
  const tlName = tl?.name?.length ? tl.name : 'runtime_timelines/latest.json';
  const tlWin = tl?.inWindow ?? false;

  let merged: RepairGovernorFailureRef[] = [];

  merged.push(
    ...extractEmbodimentIntelFailures(
      F['embodiment_intelligence_report.json']?.json,
      'embodiment_intelligence_report.json',
      inWin('embodiment_intelligence_report.json'),
    ),
  );
  merged.push(
    ...extractActiveEmbodimentArray(
      F['active_embodiment_failures.json']?.json,
      'active_embodiment_failures.json',
      inWin('active_embodiment_failures.json'),
    ),
  );
  merged.push(
    ...extractTemporalBehaviorChainsFailures(
      F['temporal_behavior_chains.json']?.json,
      'temporal_behavior_chains.json',
      inWin('temporal_behavior_chains.json'),
      minConfidence,
    ),
  );
  merged.push(
    ...extractRootCauseGraphStressFailures(
      F['root_cause_graph.json']?.json,
      'root_cause_graph.json',
      inWin('root_cause_graph.json'),
      minConfidence,
    ),
  );
  merged.push(
    ...extractCorrelationFailures(
      F['project_diagnostics_report.json']?.json,
      'project_diagnostics_report.json',
      inWin('project_diagnostics_report.json'),
      minConfidence,
    ),
  );
  merged.push(
    ...extractProjectConflictFailures(
      F['project_diagnostics_report.json']?.json,
      'project_diagnostics_report.json',
      inWin('project_diagnostics_report.json'),
    ),
  );
  merged.push(
    ...extractSpatialFinalVerifiedFailures(
      F['FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT.json']?.json,
      'FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT.json',
      inWin('FINAL_SPATIAL_BONE_EXECUTION_FORENSICS_REPORT.json'),
    ),
  );
  merged.push(
    ...extractBoneAuthorityVerifiedFailures(
      F['bone_authority_timeline.json']?.json,
      'bone_authority_timeline.json',
      inWin('bone_authority_timeline.json'),
    ),
  );
  merged.push(
    ...extractPredictiveFailures(
      F['predictive_failure_analysis.json']?.json,
      'predictive_failure_analysis.json',
      inWin('predictive_failure_analysis.json'),
      minConfidence,
    ),
  );
  merged.push(
    ...extractExecutionChainFailures(
      F['execution_chain_validation.json']?.json,
      'execution_chain_validation.json',
      inWin('execution_chain_validation.json'),
      minConfidence,
    ),
  );
  merged.push(...extractRuntimeTimelineFailures(tl?.json ?? null, tlName, tlWin));

  return mergeFailures(merged);
}

export function mergeFailures(rows: RepairGovernorFailureRef[]): RepairGovernorFailureRef[] {
  const map = new Map<string, RepairGovernorFailureRef>();
  for (const r of rows) {
    const prev = map.get(r.id);
    if (!prev) {
      map.set(r.id, { ...r, sources: [...r.sources] });
    } else {
      prev.confidence = Math.max(prev.confidence, r.confidence);
      prev.sources = Array.from(new Set([...prev.sources, ...r.sources]));
      if (!prev.summary && r.summary) prev.summary = r.summary;
      if (!prev.subsystem && r.subsystem) prev.subsystem = r.subsystem;
      if (!prev.evidence?.length && r.evidence?.length) prev.evidence = r.evidence;
    }
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}
