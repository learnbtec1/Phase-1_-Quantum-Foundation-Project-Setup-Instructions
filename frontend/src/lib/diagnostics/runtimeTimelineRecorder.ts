'use client';

/**
 * Temporal behavioral forensics — snapshots every 2s only (never useFrame).
 * Rolling memory ~10 minutes in-process + timestamped JSON on disk via BFF.
 */

import { isDiagnosticsEnabled } from './diagnosticsStore';
import { diagTimelineConflictBonesSnapshot, diagTimelineIntentProbe } from './diagnosticsTimelineProbe';
import type {
  BehavioralForensicsChain,
  DiagnosticsWindowSurface,
  RuntimeTimelineSnapshot,
} from './diagnosticsTypes';

const SNAPSHOT_MS = 2000;
const ROLLING_MS = 10 * 60 * 1000;
const ARM_VISIBLE_MIN_RAD = 0.1;
const ARM_FROZEN_MAX_RAD = 0.09;
const ARM_FROZEN_MIN_ENVELOPE = 0.3;
const FROZEN_HOLD_MS = 2000;
const COLLAPSE_HOLD_MS = 2000;

/** Browser interval handle */
let _timer: number | null = null;
let _started = false;

let _frozenStreakMs = 0;
let _collapseStreakMs = 0;
let _prevPhaseTag = '';
let _visualPenalty = 0;
let _lastChains: BehavioralForensicsChain[] = [];

const _buffer: RuntimeTimelineSnapshot[] = [];

function readLive(): DiagnosticsWindowSurface | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (window as any).__DIAGNOSTICS as DiagnosticsWindowSurface | undefined;
  return d && typeof d === 'object' ? d : null;
}

function computePhaseTag(d: DiagnosticsWindowSurface): string {
  const ms = d.motion.motionSource;
  const gs = d.motion.gestureState;
  const sp = d.speech.speaking;
  const ge = d.embodiment.timelineEnvelope;
  if (!sp && gs === 'idle' && ms === 'IDLE') return 'IDLE';
  if (sp && gs === 'idle' && ms === 'IDLE') return 'SPEAKING_IDLE';
  if (ms === 'GESTURE' || (gs !== 'idle' && ge > 0.08)) return 'GESTURE_ACTIVE';
  if (ms === 'VRMA') return 'VRMA_ACTIVE';
  if (sp) return 'SPEAKING_OTHER';
  return 'OTHER';
}

function pruneBuffer(nowWall: number): void {
  const cutoff = nowWall - ROLLING_MS;
  while (_buffer.length > 0) {
    const t = Date.parse(_buffer[0].timestamp);
    if (Number.isFinite(t) && t < cutoff) _buffer.shift();
    else break;
  }
}

function inferChains(buf: RuntimeTimelineSnapshot[]): BehavioralForensicsChain[] {
  if (buf.length < 4) return [];
  const n = buf.length;
  const frozenHits = buf.filter((s) => s.embodimentState.armFrozen).length;
  const idleDomSpeak = buf.filter((s) => s.speaking && s.embodimentState.idleDominating).length;
  const ghostGest = buf.filter(
    (s) =>
      !s.embodimentState.gestureVisible &&
      s.speaking &&
      (s.semanticGesture !== 'idle' || s.gestureLayerW > 0.06),
  ).length;

  const chains: BehavioralForensicsChain[] = [];
  const fr = frozenHits / n;
  if (fr > 0.06) {
    chains.push({
      rootCause: 'frozen-arm syndrome (envelope vs arm delta divergence)',
      timeline: [
        'gesture scheduled',
        'scheduler delay',
        'gesture envelope dropped',
        'idle overwrite activated',
        'arm movement invisible',
      ],
      confidence: Math.min(0.95, 0.35 + fr * 1.15),
      fileHint: 'VRMSkeletonManager.tsx',
      fnHint: 'motion blend / idleLayerW vs gestureLayerW',
      lineHint: 4624,
    });
  }

  const ir = idleDomSpeak / n;
  if (ir > 0.1) {
    chains.push({
      rootCause: 'idle authority dominating during speech',
      timeline: ['SPEAKING', 'HIGH_IDLE_WEIGHT', 'GESTURE_LOST', 'VISUAL_COLLAPSE'],
      confidence: Math.min(0.92, 0.28 + ir),
      fileHint: 'VRMSkeletonManager.tsx',
      fnHint: 'speaking + IDLE motionSource coupling',
      lineHint: 3771,
    });
  }

  const gr = ghostGest / n;
  if (gr > 0.12) {
    chains.push({
      rootCause: 'gesture authority collapse',
      timeline: [
        'gesture scheduled',
        'semantic bridge cooldown',
        'weak gesture envelope',
        'idle overwrite',
        'intent neutral collapse',
      ],
      confidence: Math.min(0.91, 0.26 + gr * 0.95),
      fileHint: 'motionScheduler.ts',
      fnHint: 'schedulerTick',
      lineHint: 0,
    });
  }

  chains.sort((a, b) => b.confidence - a.confidence);
  return chains.slice(0, 8);
}

function recomputePenalty(snap: RuntimeTimelineSnapshot): void {
  let p = 0;
  const e = snap.embodimentState;
  if (e.armFrozen) p += 28;
  if (e.idleDominating && snap.speaking) p += 18;
  if (!e.gestureVisible && snap.speaking && snap.semanticGesture !== 'idle') p += 14;
  if (!e.visuallyAlive) p += 12;
  if (e.gestureCollapseRisk) p += 14;
  _visualPenalty = Math.min(55, p);
}

function buildSnapshot(): RuntimeTimelineSnapshot | null {
  const d = readLive();
  if (!d) return null;

  const probe = diagTimelineIntentProbe();
  const mo = d.motion;
  const sp = d.speech;
  const sch = d.scheduler;
  const vr = d.vrm;
  const em = d.embodiment;

  const gestureEnvelope = em.timelineEnvelope;
  const finalArmMagnitude = Math.abs(mo.armDeviationLuaRad ?? 0);

  const gestureSemanticActive =
    probe.semanticGesture.length > 0 && probe.semanticGesture !== 'idle';

  const gestureActive =
    mo.gestureLayerW > 0.06 || mo.gestureState !== 'idle' || gestureSemanticActive;

  const schedulerBlocked =
    sch.blocksSinceFlush > 0 ||
    (typeof sch.lastBlockReasonLabel === 'string' && sch.lastBlockReasonLabel.length > 0);

  const idleDominating = mo.idleLayerW > 0.8 && sp.speaking;

  const armFrozenCond =
    gestureEnvelope > ARM_FROZEN_MIN_ENVELOPE && finalArmMagnitude < ARM_FROZEN_MAX_RAD;
  if (armFrozenCond) _frozenStreakMs += SNAPSHOT_MS;
  else _frozenStreakMs = Math.max(0, _frozenStreakMs - SNAPSHOT_MS);
  const armFrozen = _frozenStreakMs >= FROZEN_HOLD_MS;

  const gestureVisible =
    !gestureActive ||
    finalArmMagnitude >= ARM_VISIBLE_MIN_RAD ||
    mo.motionSource === 'GESTURE';

  const collapseCond =
    sp.speaking &&
    gestureSemanticActive &&
    mo.motionSource === 'IDLE' &&
    mo.gestureLayerW < 0.12 &&
    mo.idleLayerW > 0.75;

  if (collapseCond) _collapseStreakMs += SNAPSHOT_MS;
  else _collapseStreakMs = 0;
  const gestureCollapseRisk = _collapseStreakMs >= COLLAPSE_HOLD_MS;

  const conversationalEmbodiment =
    sp.speaking &&
    (gestureVisible || sp.motionEnergyUnified > 0.12) &&
    !idleDominating &&
    !armFrozen;

  const visuallyAlive =
    vr.humanoidPresent &&
    !armFrozen &&
    !(idleDominating && gestureActive && mo.motionSource === 'IDLE');

  const phaseTag = computePhaseTag(d);
  let transitionEdge = '';
  if (_prevPhaseTag.length > 0 && _prevPhaseTag !== phaseTag) {
    transitionEdge = `${_prevPhaseTag}→${phaseTag}`;
  }
  _prevPhaseTag = phaseTag;

  const snapshot: RuntimeTimelineSnapshot = {
    timestamp: new Date().toISOString(),
    speaking: sp.speaking,
    motionSource: mo.motionSource,
    gestureState: mo.gestureState,
    gestureEnvelope,
    gestureLayerW: mo.gestureLayerW,
    idleLayerW: mo.idleLayerW,
    finalArmMagnitude,
    torsoContribution: null,
    headContribution: null,
    schedulerState: {
      lastBlockReasonId: sch.lastBlockReasonId,
      lastBlockReasonLabel: sch.lastBlockReasonLabel,
      blocksSinceFlush: sch.blocksSinceFlush,
    },
    schedulerBlocked,
    activeIntent: probe.activeIntent,
    llmIntent: probe.llmIntent,
    semanticGesture: probe.semanticGesture,
    authorityWinner: mo.motionSource,
    overwrittenBones: diagTimelineConflictBonesSnapshot(),
    vrmState: {
      humanoidPresent: vr.humanoidPresent,
      autoUpdateHumanBones: vr.autoUpdateHumanBones,
      invalidQuatSamplesSinceFlush: vr.invalidQuatSamplesSinceFlush,
      nullBoneSamplesSinceFlush: vr.nullBoneSamplesSinceFlush,
    },
    embodimentState: {
      visuallyAlive,
      gestureVisible,
      conversationalEmbodiment,
      idleDominating,
      armFrozen,
      gestureCollapseRisk,
    },
    transitionEdge,
    phaseTag,
  };

  return snapshot;
}

async function postSnapshot(snapshot: RuntimeTimelineSnapshot): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_DIAGNOSTICS_TIMELINE_SYNC ?? '1').trim() === '0') return;
  try {
    await fetch('/api/diagnostics/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

function tick(): void {
  if (!isDiagnosticsEnabled()) return;
  const snap = buildSnapshot();
  if (!snap) return;

  const nowWall = Date.now();
  _buffer.push(snap);
  pruneBuffer(nowWall);

  _lastChains = inferChains(_buffer);
  recomputePenalty(snap);

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__TIMELINE_LAST_SNAPSHOT = snap;
    w.__TIMELINE_ROLLING_COUNT = _buffer.length;
    w.__TIMELINE_ROLLING_MS_ESTIMATE = _buffer.length * SNAPSHOT_MS;
    w.__BEHAVIORAL_FORENSICS_CHAINS = _lastChains;
    w.__VISUAL_EMBODIMENT_PENALTY = _visualPenalty;
    const transitions = _buffer
      .map((s) => s.transitionEdge)
      .filter((e): e is string => typeof e === 'string' && e.length > 0)
      .slice(-48);
    w.__TEMPORAL_TRANSITION_GRAPH = transitions;
  }

  void postSnapshot(snap);
}

/** Penalty 0–55 subtracted from counter-only health in reporter flush. */
export function getTimelineVisualHealthPenalty(): number {
  return _visualPenalty;
}

export function getBehavioralForensicsChains(): BehavioralForensicsChain[] {
  return _lastChains;
}

/** Recent timeline snapshots for predictive cognition (no extra timers). */
export function getRecentTimelineSnapshots(maxCount: number): RuntimeTimelineSnapshot[] {
  if (maxCount <= 0) return [];
  const n = _buffer.length;
  if (n === 0) return [];
  const take = Math.min(maxCount, n);
  const start = n - take;
  const out: RuntimeTimelineSnapshot[] = new Array(take);
  for (let i = 0; i < take; i++) {
    out[i] = _buffer[start + i];
  }
  return out;
}

export function startRuntimeTimelineRecorder(): void {
  if (typeof window === 'undefined') return;
  if (_started) return;
  if (!isDiagnosticsEnabled()) return;
  _started = true;
  queueMicrotask(() => tick());
  _timer = window.setInterval(tick, SNAPSHOT_MS);
}

export function stopRuntimeTimelineRecorder(): void {
  if (_timer != null) {
    window.clearInterval(_timer);
    _timer = null;
  }
  _started = false;
}
