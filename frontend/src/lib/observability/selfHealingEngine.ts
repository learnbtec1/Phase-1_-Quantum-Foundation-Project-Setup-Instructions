/**
 * Autonomous soft corrections — bounded, cooldown-guarded, no core pipeline overrides.
 * Enabled only when observability is on (same gate as monitoring).
 */

import type { ObservabilitySnapshot } from './types';
import { isObservabilityEnabled } from './config';
import { pushEventStream } from './eventStream';
import { resetMotionDiagnostics } from './motionDiagnostics';
import { getSharedAudioContext, resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';

export type HealLogEntry = {
  ts: number;
  rule: string;
  message: string;
  fix: string;
};

const LOG_MAX = 40;
const healLog: HealLogEntry[] = [];

const COOLDOWN_MS: Record<string, number> = {
  lip_sync: 4500,
  motion_baseline: 8000,
  audio_context: 6000,
  motion_stir: 5000,
  gesture_hint: 10_000,
  fps_throttle: 20_000,
};

const lastAppliedAt: Record<string, number> = {};
const issueCounts: Record<string, number> = {};

/** Observability notify stride (frames). Raised when FPS critically low to reduce overhead. */
let notifyStrideFrames = 10;
/** Added by predictive engine under load (bounded) — reduces notify frequency further. */
let predictiveStrideBonus = 0;
let fpsThrottleUntil = 0;

export function getObservabilityNotifyStride(): number {
  /* Cap keeps observability + predictive from starving the render loop of useful samples */
  return Math.min(28, notifyStrideFrames + predictiveStrideBonus);
}

/** Predictive layer: extra frames between observability notifies (0–12). */
export function setPredictiveNotifyStrideBonus(bonus: number): void {
  predictiveStrideBonus = Math.max(0, Math.min(12, Math.round(bonus)));
}

export function getHealingLog(): readonly HealLogEntry[] {
  return healLog;
}

export function getHealingIssueCounts(): Readonly<Record<string, number>> {
  return { ...issueCounts };
}

function logHeal(rule: string, message: string, fix: string): void {
  const entry: HealLogEntry = { ts: performance.now(), rule, message, fix };
  healLog.push(entry);
  while (healLog.length > LOG_MAX) healLog.shift();
  pushEventStream('heal', rule, { message, fix });
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.info(`[SelfHeal] ${rule}: ${message} → ${fix}`);
  }
}

function canApply(rule: string): boolean {
  const t = performance.now();
  const last = lastAppliedAt[rule] ?? 0;
  const cd = COOLDOWN_MS[rule] ?? 5000;
  return t - last >= cd;
}

function markApplied(rule: string): void {
  lastAppliedAt[rule] = performance.now();
  issueCounts[rule] = (issueCounts[rule] ?? 0) + 1;
}

/**
 * Nudge lip sync offset (handled in LipSyncManager — clamped there).
 * Small negative delta pulls playhead alignment toward neutral drift buffer.
 */
function healLipSyncDrift(snapshot: ObservabilitySnapshot): void {
  if (!canApply('lip_sync')) return;
  if (snapshot.lipDriftLevel !== 'critical' && snapshot.lipDriftLevel !== 'warning') return;
  if (snapshot.lipDriftMs < 38) return;

  const deltaSec = -0.006;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cogni:heal:lip-offset', {
      detail: { deltaSec },
    }),
  );
  logHeal(
    'lip_sync',
    `Lip drift ~${snapshot.lipDriftMs.toFixed(0)} ms (${snapshot.lipDriftLevel})`,
    `Applied offset nudge ${(deltaSec * 1000).toFixed(1)} ms (clamped in LipSyncManager)`,
  );
  markApplied('lip_sync');
}

/** Reset motion observability baseline only — does not teleport avatar mesh */
function healMotionBaseline(snapshot: ObservabilitySnapshot): void {
  if (!canApply('motion_baseline')) return;
  if (!snapshot.rootDriftWarn) return;

  resetMotionDiagnostics();
  logHeal(
    'motion_baseline',
    `Root drift metric ${snapshot.rootDriftM.toFixed(3)} m (observability)`,
    'Rebased motion diagnostics baseline (monitoring only)',
  );
  markApplied('motion_baseline');
}

function healAudioContext(): void {
  if (!canApply('audio_context')) return;
  const ctx = getSharedAudioContext();
  if (!ctx || ctx.state !== 'suspended') return;

  const prev = ctx.state;
  void resumeSharedAudioContext().then((c) => {
    if (c?.state === 'running') {
      logHeal('audio_context', `AudioContext was ${prev}`, 'resumeSharedAudioContext()');
      markApplied('audio_context');
    }
  });
}

/** Subtle emphasis bump — reuses existing micro-gesture pathway (low amplitude) */
function healMotionStir(snapshot: ObservabilitySnapshot): void {
  if (!canApply('motion_stir')) return;
  if (!snapshot.motionFreezeSuspect || snapshot.motionSilentSec < 6) return;
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent('avatar:micro:gesture', {
      detail: { kind: 'heal_stir', intensity: 0.06 },
    }),
  );
  logHeal('motion_stir', `Motion silent ~${snapshot.motionSilentSec.toFixed(1)} s`, 'Micro-gesture stir (existing channel)');
  markApplied('motion_stir');
}

function healGestureOverload(snapshot: ObservabilitySnapshot): void {
  if (!canApply('gesture_hint')) return;
  if (snapshot.gestureRepeatRatio < 0.52) return;

  logHeal(
    'gesture_hint',
    `High gesture repeat ${(snapshot.gestureRepeatRatio * 100).toFixed(0)}%`,
    'Logged only — tune UnifiedGestureEngine / director if persistent',
  );
  markApplied('gesture_hint');
}

function healFpsThrottle(snapshot: ObservabilitySnapshot): void {
  const now = performance.now();
  if (now < fpsThrottleUntil && notifyStrideFrames > 10) return;
  if (!canApply('fps_throttle')) return;
  if (snapshot.fps >= 34) {
    if (notifyStrideFrames > 10) {
      notifyStrideFrames = 10;
      logHeal('fps_throttle', 'FPS recovered', 'Restored observability notify stride (10 frames)');
    }
    return;
  }
  if (snapshot.fps < 28 && snapshot.frameSpike) {
    notifyStrideFrames = 22;
    fpsThrottleUntil = now + 25_000;
    logHeal(
      'fps_throttle',
      `Low FPS ~${snapshot.fps.toFixed(0)} + frame spike`,
      'Increased observability notify stride to reduce main-thread work (temporary)',
    );
    markApplied('fps_throttle');
  }
}

/**
 * Single entry from observability tick — uses latest snapshot (built each notify).
 * Idempotent per rule via cooldowns; no-op when observability disabled.
 */
export function tickSelfHealing(snapshot: ObservabilitySnapshot): void {
  if (!isObservabilityEnabled()) return;

  healAudioContext();
  healLipSyncDrift(snapshot);
  healMotionBaseline(snapshot);
  healMotionStir(snapshot);
  healGestureOverload(snapshot);
  healFpsThrottle(snapshot);
}

export function resetSelfHealingState(): void {
  notifyStrideFrames = 10;
  predictiveStrideBonus = 0;
  fpsThrottleUntil = 0;
  for (const k of Object.keys(lastAppliedAt)) delete lastAppliedAt[k];
}
