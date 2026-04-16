/**
 * Root-cause motion diagnostics: periodic summaries, overlay snapshot, warnings.
 * Does not change motion policy — observation only.
 */
'use client';

import { motionDebug } from '@/lib/avatar/motionDebug';
import {
  motionBlockStats,
  motionDiagBlockTotal,
  motionPlaySuccessCount,
} from '@/lib/avatar/motionDiagnosticsStore';
import {
  getBehaviorMotionState,
  recordContinuousMotionActivity,
} from '@/lib/behavior/behaviorMotionBrain';
import { getMotionControllerState } from '@/lib/avatar/motionAuthority';
import { isAnticipationActive } from '@/lib/behavior/anticipationLayer';
import { isInternalThinking } from '@/lib/behavior/internalThoughtLayer';

let intervalStarted = false;

/** Call when continuous motion is applied (e.g. intent motor) so idle / “no motion” diagnostics stay accurate. */
export function recordActivity(): void {
  recordContinuousMotionActivity();
}

export type MotionTraceOverlayState = {
  mode: string;
  motionActive: boolean;
  motionSource: string;
  lastActionDelta: number | null;
  anticipationActive: boolean;
  internalThinking: boolean;
  plays: number;
  blockStats: typeof motionBlockStats;
  blockTotal: number;
};

export function getMotionTraceOverlayState(): MotionTraceOverlayState {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const b = getBehaviorMotionState();
  const mc = getMotionControllerState();
  const last = b.lastActionTime;
  return {
    mode: b.mode,
    motionActive: mc.active,
    motionSource: mc.source,
    lastActionDelta: last > 0 ? Math.round(now - last) : null,
    anticipationActive: isAnticipationActive(),
    internalThinking: isInternalThinking(),
    plays: motionPlaySuccessCount,
    blockStats: { ...motionBlockStats },
    blockTotal: motionDiagBlockTotal(),
  };
}

function warnOverBlocking(): void {
  const plays = motionPlaySuccessCount;
  const total = motionDiagBlockTotal();
  if (plays > 0 && total > plays * 3) {
    // eslint-disable-next-line no-console
    console.warn('[MOTION] OVER-BLOCKING DETECTED', { total, plays, blockStats: { ...motionBlockStats } });
  }
}

function warnUnderMotion(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { lastActionTime } = getBehaviorMotionState();
  if (lastActionTime > 0 && now - lastActionTime > 5000) {
    // eslint-disable-next-line no-console
    console.warn('[MOTION] NO MOTION FOR TOO LONG', {
      msSinceLastAction: Math.round(now - lastActionTime),
      mode: getBehaviorMotionState().mode,
    });
  }
}

/** Idempotent — safe to call from `initGestureNormalizer`. */
export function startMotionDiagnosticReporting(): void {
  if (typeof window === 'undefined' || intervalStarted) return;
  if (process.env.NODE_ENV !== 'development') return;
  intervalStarted = true;
  window.setInterval(() => {
    motionDebug('BLOCK STATS:', { ...motionBlockStats }, 'plays:', motionPlaySuccessCount);
    motionDebug('OVERLAY:', getMotionTraceOverlayState());
    warnOverBlocking();
    warnUnderMotion();
  }, 5000);
}
