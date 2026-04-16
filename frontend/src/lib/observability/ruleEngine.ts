/**
 * Correlates observability signals → actionable insights (not raw logs).
 */

import type { Insight } from './types';
import { getSmoothedFps, isFrameSpike } from './systemHealthMonitor';
import { getRootDriftM, isRootDriftWarn, isMotionFreezeSuspect, getMotionSilentSec } from './motionDiagnostics';
import { getLipDriftLevel, getLipDriftMs } from './audioLipSyncMonitor';
import { getHeapTrend } from './memoryWatcher';
import { useBrainStore } from '@/store/useBrainStore';

let lastEvalAt = 0;
const EVAL_INTERVAL_MS = 900;
let cachedInsights: Insight[] = [];

export function getCachedInsights(): Insight[] {
  return cachedInsights;
}

export function evaluateRules(nowMs: number, frameDeltaSec: number): Insight[] {
  if (nowMs - lastEvalAt < EVAL_INTERVAL_MS) return cachedInsights;
  lastEvalAt = nowMs;

  const out: Insight[] = [];
  const fps = getSmoothedFps();
  const spike = isFrameSpike(frameDeltaSec);
  const driftM = getRootDriftM();
  const driftWarn = isRootDriftWarn();
  const lipLevel = getLipDriftLevel();
  const lipMs = getLipDriftMs();
  const freeze = isMotionFreezeSuspect();
  const silentSec = getMotionSilentSec();
  const heapRising = getHeapTrend() === 'rising';
  const { talking, thinking } = useBrainStore.getState();

  if (driftWarn && (fps < 42 || spike)) {
    out.push({
      id: 'phys_instability',
      title: 'Physics instability',
      severity: 'WARNING',
      summary: `Root drift ~${driftM.toFixed(3)} m with low FPS (${fps.toFixed(0)}) or frame spikes.`,
      cause: 'Avatar root moved from baseline and render thread is stuttering.',
      suggestedFix: 'Check floor lock / lift node, reduce scene cost, verify VRMA vs procedural fight.',
      ts: nowMs,
    });
  }

  if (lipLevel === 'critical' || (lipLevel === 'warning' && talking)) {
    out.push({
      id: 'audio_desync',
      title: 'Audio / lip desync',
      severity: lipLevel === 'critical' ? 'CRITICAL' : 'WARNING',
      summary: `Lip cue vs playhead drift ≈ ${lipMs.toFixed(0)} ms (${lipLevel}).`,
      cause: 'Viseme timeline and audio.currentTime diverged (buffer, interrupt, or unit mismatch).',
      suggestedFix: 'Confirm avatar:speak:start order, check drift correction in LipSyncManager, avoid overlapping TTS.',
      ts: nowMs,
    });
  }

  if (freeze && (talking || thinking)) {
    out.push({
      id: 'behavior_freeze',
      title: 'Behavior freeze risk',
      severity: 'WARNING',
      summary: `No motion-related events for ~${silentSec.toFixed(1)} s while cognitive state is active.`,
      cause: 'Gesture/VRMA pipeline may be blocked or idle layer suppressed.',
      suggestedFix: 'Inspect motion authority, VRMA baseline, and gesture engine gates.',
      ts: nowMs,
    });
  }

  if (heapRising && fps < 50) {
    out.push({
      id: 'memory_perf',
      title: 'Memory + performance',
      severity: 'INFO',
      summary: 'JS heap trending up while FPS is below target.',
      cause: 'Possible retained closures, textures, or event backlog.',
      suggestedFix: 'Take a heap snapshot after long session; verify listener cleanup and texture dispose.',
      ts: nowMs,
    });
  }

  cachedInsights = out;
  return out;
}
