/**
 * Continuous motion scheduler — re-queues light gestures when the body pipeline goes quiet,
 * without changing VRMA / intent / presence. Browser-only.
 *
 * Loads `unifiedGestureEngine` via dynamic `import()` to avoid a circular dependency with
 * `UnifiedGestureEngine` (which calls `startMotionScheduler` from `initGestureNormalizer`).
 */
'use client';

import { getAvatarOrchestratorState } from '@/lib/avatar/avatarOrchestratorState';
import {
  isAvatarMotionTraceOn,
  motionTraceStopAtGuard,
} from '@/lib/avatar/avatarMotionTrace';
import { PRIORITY } from '@/constants/gestures';
import { getEmbodimentState } from '@/lib/avatar/embodimentState';
import { getMotionControllerState, isVrmaBaselineLayerActive } from '@/lib/avatar/motionAuthority';
import { getBehaviorMotionState } from '@/lib/behavior/behaviorMotionBrain';
import { getUtteranceSemanticIntent } from '@/lib/avatar/speechIntentHints';
import { dispatchUtteranceSemanticMotion } from '@/lib/avatar/utteranceSemanticMotion';
import { useBrainStore } from '@/store/useBrainStore';
import { isMotionDiagEnabled } from '@/lib/avatar/motionDiagEnv';
import { isProceduralOnlyMotion } from '@/lib/avatar/vrmaPlaybackPolicy';
import { logDebug } from '@/lib/logging/runtimeLog';
import { peekSpeechEnergy, getCouplingMode } from '@/app/avatar-agent/motion/__speechFusion';
import {
  diagnosticsSchedulerBlocked,
  diagnosticsSchedulerDispatched,
} from '@/lib/diagnostics/diagnosticsScheduler';

/** Throttle [MOTION_ALLOW] to once per 1500ms to avoid console flood. */
let lastMotionAllowLogAt = 0;
/** Throttle [COUPLING_STATE] to once per 750ms. */
let lastCouplingStateLogAt = 0;

type UnifiedMod = typeof import('@/ai/cognitive/UnifiedGestureEngine');
let engineModPromise: Promise<UnifiedMod> | null = null;

function loadGestureEngine(): Promise<UnifiedMod> {
  if (!engineModPromise) {
    engineModPromise = import('@/ai/cognitive/UnifiedGestureEngine');
  }
  return engineModPromise;
}

const TICK_MS = 150;
const MIN_SINCE_LAST_ACTION_MS = 1200;
/** While speaking, allow faster ambient / micro-motion re-queue (avoids “frozen body” under VRMA + TTS). */
const MIN_SINCE_LAST_ACTION_SPEAKING_MS = 300;
const MIN_BETWEEN_SCHEDULER_PLAYS_MS = 3400;
/** Conversational re-queue — was 2200ms (felt like “frozen arms” between beats). */
const MIN_BETWEEN_SCHEDULER_PLAYS_SPEAKING_MS = 1500;

let started = false;
let intervalId: number | null = null;
let lastSchedulerPlayAt = 0;
/** Last `minBetween` used in `schedulerTick` — for `getMotionSchedulerCooldownDebug`. */
let lastSchedulerMinBetweenMs = MIN_BETWEEN_SCHEDULER_PLAYS_MS;
/** Throttle noisy trace logs (normal tick skips). */
let lastTraceSched2LogAt = 0;
let lastTraceSched6LogAt = 0;
/** Throttle `[MOTION] guard` lines — scheduler ticks often. */
let lastMotionGuardConsoleAt = 0;
/** Throttle `[MOTION_BLOCKED]` when motion debug is on. */
let lastMotionDiagBlockedAt = 0;

function logMotionDiagBlocked(reason: string, ctx?: Record<string, unknown>): void {
  if (!isMotionDiagEnabled()) return;
  const now = perfNow();
  if (now - lastMotionDiagBlockedAt < 450) return;
  lastMotionDiagBlockedAt = now;
  logDebug('MOTION', '[MOTION_BLOCKED]', reason, ctx ?? {});
}

function logMotionGuard(
  reason: string,
  speaking: boolean,
  ctx?: Record<string, unknown>,
): void {
  logMotionDiagBlocked(reason, { speaking, ...(ctx ?? {}) });
  if (!speaking) return;
  const now = perfNow();
  if (now - lastMotionGuardConsoleAt < 900) return;
  lastMotionGuardConsoleAt = now;
  logDebug('MOTION', '[MOTION] guard:', reason, ctx ?? {});
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function schedulerTick(): Promise<void> {
  if (typeof window === 'undefined') {
    motionTraceStopAtGuard('sched-0', 'no window', {});
    return;
  }
  if ((process.env.NEXT_PUBLIC_MOTION_SCHEDULER ?? '').trim().toLowerCase() === '0') {
    motionTraceStopAtGuard('sched-1', 'NEXT_PUBLIC_MOTION_SCHEDULER=0', {});
    return;
  }

  const now = perfNow();
  const mc = getMotionControllerState();
  const baselineActive = isVrmaBaselineLayerActive();
  const b = getBehaviorMotionState();
  const orch = getAvatarOrchestratorState();
  const speaking = orch.speaking || useBrainStore.getState().talking;
  const semanticIntent = speaking ? getUtteranceSemanticIntent() : null;
  const minBetween = speaking
    ? semanticIntent
      ? 850 + Math.floor(Math.random() * 350)
      : MIN_BETWEEN_SCHEDULER_PLAYS_SPEAKING_MS
    : MIN_BETWEEN_SCHEDULER_PLAYS_MS;
  lastSchedulerMinBetweenMs = minBetween;
  const minSinceAction = speaking ? MIN_SINCE_LAST_ACTION_SPEAKING_MS : MIN_SINCE_LAST_ACTION_MS;

  const vrmaBlockingAmbient =
    !isProceduralOnlyMotion() &&
    mc.active &&
    mc.source === 'VRMA' &&
    !baselineActive;

  if (now - lastSchedulerPlayAt < minBetween) {
    if (
      isAvatarMotionTraceOn() &&
      now - lastTraceSched2LogAt >= 5000
    ) {
      lastTraceSched2LogAt = now;
      motionTraceStopAtGuard('sched-2', 'MIN_BETWEEN_SCHEDULER_PLAYS_MS not elapsed', {
        elapsed: now - lastSchedulerPlayAt,
        minMs: minBetween,
      });
    }
    logMotionDiagBlocked('min_between_scheduler_plays', {
      speaking,
      elapsed: now - lastSchedulerPlayAt,
      minMs: minBetween,
    });
    logMotionGuard('min between scheduler plays', speaking, {
      elapsed: now - lastSchedulerPlayAt,
      minMs: minBetween,
    });
    diagnosticsSchedulerBlocked('MIN_BETWEEN');
    return;
  }

  // sched-3: skip lastActionTime guard in procedural-only mode — continuous procedural
  // motion should never deadlock the scheduler by keeping lastActionTime fresh.
  if (!isProceduralOnlyMotion() && b.lastActionTime > 0 && now - b.lastActionTime < minSinceAction) {
    motionTraceStopAtGuard('sched-3', 'recent behavior motion action (MIN_SINCE_LAST_ACTION_MS)', {
      elapsed: now - b.lastActionTime,
      minMs: minSinceAction,
    });
    logMotionDiagBlocked('recent_behavior_action', {
      speaking,
      elapsed: now - b.lastActionTime,
      minMs: minSinceAction,
    });
    logMotionGuard('recent behavior motion action', speaking, {
      elapsed: now - b.lastActionTime,
      minMs: minSinceAction,
    });
    diagnosticsSchedulerBlocked('RECENT_ACTION');
    return;
  }

  if (vrmaBlockingAmbient && !speaking) {
    motionTraceStopAtGuard('sched-4', 'VRMA blocks ambient (active non-baseline VRMA)', {
      mcActive: mc.active,
      mcSource: mc.source,
      baselineActive,
    });
    logMotionDiagBlocked('vrma_blocks_ambient', {
      speaking,
      mcActive: mc.active,
      mcSource: mc.source,
      baselineActive,
    });
    logMotionGuard('VRMA blocks ambient', speaking, {
      mcActive: mc.active,
      baselineActive,
    });
    diagnosticsSchedulerBlocked('VRMA_BLOCK');
    return;
  }

  void getEmbodimentState();

  const mode = b.mode;
  const { unifiedGestureEngine } = await loadGestureEngine();

  /** Emit [MOTION_ALLOW] at most once per 1500ms so it's visible without flooding. */
  function logAllow(gesture: string, modeOverride?: string): void {
    if (now - lastMotionAllowLogAt >= 1500) {
      lastMotionAllowLogAt = now;
      // eslint-disable-next-line no-console -- motion flow checkpoint (always-on, not gated)
      console.log('[MOTION_ALLOW]', {
        gesture,
        mode: modeOverride ?? mode,
        speaking,
        proceduralOnly: isProceduralOnlyMotion(),
        ...(modeOverride ? { speechBypass: true } : {}),
      });
    }
    logDebug('MOTION', '[MOTION_SELECTED]', { primitive: gesture, mode, gesture, speaking });
  }

  if (semanticIntent) {
    lastSchedulerPlayAt = now;
    logAllow(`semantic:${semanticIntent}`);
    dispatchUtteranceSemanticMotion(semanticIntent, (name, opts) =>
      unifiedGestureEngine.play(name, opts ?? {}),
    );
    diagnosticsSchedulerDispatched();
    return;
  }

  if (mode === 'RESPONDING') {
    lastSchedulerPlayAt = now;
    logAllow('explain');
    void unifiedGestureEngine.play('explain', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    diagnosticsSchedulerDispatched();
    return;
  }

  if (mode === 'LISTENING') {
    lastSchedulerPlayAt = now;
    logAllow('nod');
    void unifiedGestureEngine.play('nod', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    diagnosticsSchedulerDispatched();
    return;
  }

  if (mode === 'THINKING') {
    // WS `llm_thinking` already queues Thinking VRMA (HIGH) — ambient LOW re-play stacks clips / neck.
    if (useBrainStore.getState().thinking) {
      motionTraceStopAtGuard('sched-5', 'THINKING mode but brain.thinking already true — skip LOW replay', {});
      logMotionDiagBlocked('thinking_skip_low_replay', { mode: 'THINKING' });
      diagnosticsSchedulerBlocked('THINKING_SKIP');
      return;
    }
    lastSchedulerPlayAt = now;
    logAllow('thinking');
    void unifiedGestureEngine.play('thinking', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    diagnosticsSchedulerDispatched();
    return;
  }

  // sched-6: random IDLE skip. The post-cooldown rate is already gated by
  // MIN_BETWEEN_SCHEDULER_PLAYS_MS (4 s); a second 80 % filter on top stacked
  // delays to 5-8 s and produced log spam without dispatch. Lowered to 50 %
  // so idle motion is still randomised but at a perceptually visible cadence.
  //
  // Speech bypass:
  //   • If `getCouplingMode(speaking) === 'SPEAKING'` (i.e. speaking + energy > 0.2)
  //     we promote the dispatch to `explain`, log mode='SPEAKING', and skip the random hold.
  //   • Below the SPEAKING threshold but with weaker speech (energy > 0.1) we still
  //     skip the random hold so `idle_shift` keeps firing during quiet utterances.
  const speechEnergyForSched = speaking ? peekSpeechEnergy() : 0;
  const couplingMode = getCouplingMode(speaking);
  const speechIsActive = couplingMode === 'SPEAKING';
  const speechBypassesIdleSkip =
    speaking && (orch.speaking === true || speechEnergyForSched > 0.1);

  // Throttled [COUPLING_STATE] log — once per ~750 ms.
  if (now - lastCouplingStateLogAt >= 750) {
    lastCouplingStateLogAt = now;
    // eslint-disable-next-line no-console -- motion-flow checkpoint
    console.log('[COUPLING_STATE]', {
      energy:         +speechEnergyForSched.toFixed(3),
      speaking,
      mode:           speechIsActive ? 'SPEAKING' : mode,
      proceduralOnly: isProceduralOnlyMotion(),
      bypass:         speechIsActive,
    });
  }

  if (mode === 'IDLE' && speechIsActive) {
    // Promote IDLE → SPEAKING dispatch: fire `explain` instead of `idle_shift`.
    lastSchedulerPlayAt = now;
    logAllow('explain', 'SPEAKING');
    void unifiedGestureEngine.play('explain', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    diagnosticsSchedulerDispatched();
    return;
  }

  if (mode === 'IDLE' && !speechBypassesIdleSkip && Math.random() > 0.5) {
    if (isAvatarMotionTraceOn() && now - lastTraceSched6LogAt >= 5000) {
      lastTraceSched6LogAt = now;
      motionTraceStopAtGuard('sched-6', 'IDLE mode random hold (50% skip idle_shift)', {});
    }
    logMotionDiagBlocked('idle_random_hold_skip', { mode: 'IDLE' });
    diagnosticsSchedulerBlocked('IDLE_RANDOM');
    return;
  }

  lastSchedulerPlayAt = now;
  logAllow('idle_shift');
  void unifiedGestureEngine.play('idle_shift', {
    priority: PRIORITY.LOW,
    humanTiming: false,
    behaviorBrain: true,
  });
  diagnosticsSchedulerDispatched();
}

/** DevTools: cooldown gate the ambient scheduler uses (matches last tick’s `minBetween`). */
export function getMotionSchedulerCooldownDebug(now: number = perfNow()): {
  blocking: boolean;
  msUntilNext: number;
  lastPlayAt: number;
  minBetweenMs: number;
} {
  const elapsed = now - lastSchedulerPlayAt;
  const minBetween = lastSchedulerMinBetweenMs;
  return {
    blocking: elapsed < minBetween,
    msUntilNext: Math.max(0, minBetween - elapsed),
    lastPlayAt: lastSchedulerPlayAt,
    minBetweenMs: minBetween,
  };
}

/** Idempotent — starts one 100–200ms loop for ambient motion scheduling. */
export function startMotionScheduler(): void {
  if (typeof window === 'undefined') {
    motionTraceStopAtGuard('sched-start-0', 'no window', {});
    return;
  }
  if (started) {
    if (isAvatarMotionTraceOn()) {
      motionTraceStopAtGuard('sched-start-1', 'scheduler already started', {});
    }
    return;
  }
  // `NEXT_PUBLIC_DISABLE_VRMA` turns off pre-baked VRMA clips only — procedural ambient
  // gestures (`idle_shift`, `nod`, …) must keep running so the avatar stays alive with local TTS.
  started = true;
  intervalId = window.setInterval(() => {
    void schedulerTick();
  }, TICK_MS);
}

/** Test / teardown hook. */
export function stopMotionScheduler(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  started = false;
}
