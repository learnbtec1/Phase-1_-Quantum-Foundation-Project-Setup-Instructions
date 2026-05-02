/**
 * Central hub: ties monitors, rules, alerts. External API for R3F + React overlay.
 */

import type { ObservabilitySnapshot } from './types';
import { recordFrame, getFrameTimeMs, getSmoothedFps, isFrameSpike, readHeapUsedMb } from './systemHealthMonitor';
import { sampleMemory, getHeapTrend } from './memoryWatcher';
import {
  getRootDriftM,
  isRootDriftWarn,
  getMotionSilentSec,
  isMotionFreezeSuspect,
} from './motionDiagnostics';
import { getLipDriftMs, getLipDriftLevel } from './audioLipSyncMonitor';
import { getBrainChurnPerSec, isStateChurnWarn } from './stateConsistency';
import { getGestureRepeatRatio, isGestureOveruseWarn } from './behaviorAnalyzer';
import { getEventStreamLength } from './eventStream';
import { evaluateRules, getCachedInsights } from './ruleEngine';
import { pushAlert } from './alertStore';
import { getRecentAlerts } from './alertStore';
import { tickSelfHealing } from './selfHealingEngine';
import { tickPredictiveEngine } from './predictiveEngine';

let frameCount = 0;
let lastMemorySampleAt = 0;
let lastDeltaSec = 1 / 60;
let threeGeom = 0;
let threeTex = 0;

const listeners = new Set<() => void>();

/**
 * Stable snapshot for useSyncExternalStore: same object reference until metrics actually change.
 * Returning a new object from getSnapshot on every render causes "Maximum update depth exceeded".
 */
function buildSnapshot(): ObservabilitySnapshot {
  const heap = readHeapUsedMb();
  return {
    fps: getSmoothedFps(),
    frameTimeMs: getFrameTimeMs(),
    frameSpike: isFrameSpike(lastDeltaSec),
    heapUsedMb: heap,
    heapTrend: getHeapTrend(),
    rootDriftM: getRootDriftM(),
    rootDriftWarn: isRootDriftWarn(),
    lipDriftMs: getLipDriftMs(),
    lipDriftLevel: getLipDriftLevel(),
    motionSilentSec: getMotionSilentSec(),
    motionFreezeSuspect: isMotionFreezeSuspect(),
    brainChurnPerSec: getBrainChurnPerSec(),
    stateChurnWarn: isStateChurnWarn(),
    gestureRepeatRatio: getGestureRepeatRatio(),
    threeGeometries: threeGeom,
    threeTextures: threeTex,
    activeInsights: getCachedInsights().map((i) => ({ ...i })),
    recentAlerts: getRecentAlerts().slice(-12).map((a) => ({ ...a })),
    eventStreamLen: getEventStreamLength(),
  };
}

function snapshotFingerprint(s: ObservabilitySnapshot): string {
  return JSON.stringify({
    fps: Math.round(s.fps),
    ft: Math.round(s.frameTimeMs * 100) / 100,
    fs: s.frameSpike,
    hm: s.heapUsedMb != null ? Math.round(s.heapUsedMb * 10) / 10 : null,
    ht: s.heapTrend,
    rd: Math.round(s.rootDriftM * 1000) / 1000,
    rw: s.rootDriftWarn,
    lip: Math.round(s.lipDriftMs),
    ll: s.lipDriftLevel,
    ms: Math.round(s.motionSilentSec * 10) / 10,
    mf: s.motionFreezeSuspect,
    bc: Math.round(s.brainChurnPerSec * 10) / 10,
    sc: s.stateChurnWarn,
    gr: Math.round(s.gestureRepeatRatio * 100),
    tg: s.threeGeometries,
    tt: s.threeTextures,
    ev: s.eventStreamLen,
    ai: s.activeInsights.map((i) => `${i.id}:${i.severity}:${i.summary}`),
    ra: s.recentAlerts.map((a) => `${a.id}:${a.message}`),
  });
}

let cachedSnapshot: ObservabilitySnapshot = buildSnapshot();
let lastFingerprint = snapshotFingerprint(cachedSnapshot);

export function subscribeObservability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  listeners.forEach((l) => l());
}

export function resetObservabilityHub(): void {
  frameCount = 0;
  lastMemorySampleAt = 0;
  lastDeltaSec = 1 / 60;
  threeGeom = 0;
  threeTex = 0;
  cachedSnapshot = buildSnapshot();
  lastFingerprint = snapshotFingerprint(cachedSnapshot);
  /* Intentionally do not clear subscribeObservability listeners — React overlay may already be subscribed. */
}

export function patchRendererInfo(geometries: number, textures: number): void {
  threeGeom = geometries;
  threeTex = textures;
}

/** Call from single useFrame when observability enabled */
export function tickObservabilityHub(deltaSec: number, nowMs: number): void {
  lastDeltaSec = deltaSec;
  recordFrame(deltaSec, nowMs);
  frameCount += 1;

  if (nowMs - lastMemorySampleAt > 2000) {
    lastMemorySampleAt = nowMs;
    sampleMemory(readHeapUsedMb());
  }

  if (frameCount % 20 === 0) {
    const insights = evaluateRules(nowMs, deltaSec);
    for (const ins of insights) {
      pushAlert({
        severity: ins.severity,
        code: ins.id,
        message: ins.summary,
        cause: ins.cause,
        suggestedFix: ins.suggestedFix,
      });
    }
    if (isGestureOveruseWarn()) {
      pushAlert({
        severity: 'INFO',
        code: 'gesture_repeat',
        message: 'Same gesture family dominating recent window.',
        suggestedFix: 'Increase gesture variance in UnifiedGestureEngine / director mapping.',
      });
    }
    if (isStateChurnWarn()) {
      pushAlert({
        severity: 'WARNING',
        code: 'brain_churn',
        message: 'Brain state changing unusually fast.',
        suggestedFix: 'Audit subscribers and AgentDirector frame cadence.',
      });
    }
  }
}

/** Always returns the same reference until notify commits a new fingerprint. */
export function getObservabilitySnapshot(): ObservabilitySnapshot {
  return cachedSnapshot;
}

/** SSR / hydration: same stable reference as client initial (overlay is client-only). */
export function getObservabilityServerSnapshot(): ObservabilitySnapshot {
  return cachedSnapshot;
}

export function notifyObservabilitySubscribers(): void {
  const next = buildSnapshot();
  tickPredictiveEngine(next);
  tickSelfHealing(next);
  const fp = snapshotFingerprint(next);
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;
  cachedSnapshot = next;
  emit();
}
