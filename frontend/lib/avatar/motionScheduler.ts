/**
 * Continuous motion scheduler — re-queues light gestures when the body pipeline goes quiet,
 * without changing VRMA / intent / presence. Browser-only.
 *
 * Loads `unifiedGestureEngine` via dynamic `import()` to avoid a circular dependency with
 * `UnifiedGestureEngine` (which calls `startMotionScheduler` from `initGestureNormalizer`).
 */
'use client';

import { PRIORITY } from '@/constants/gestures';
import { getEmbodimentState } from '@/lib/avatar/embodimentState';
import { getMotionControllerState, isVrmaBaselineLayerActive } from '@/lib/avatar/motionAuthority';
import { getBehaviorMotionState } from '@/lib/behavior/behaviorMotionBrain';
import { useBrainStore } from '@/store/useBrainStore';
import { isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';

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
const MIN_BETWEEN_SCHEDULER_PLAYS_MS = 4000;

let started = false;
let intervalId: number | null = null;
let lastSchedulerPlayAt = 0;

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function schedulerTick(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ((process.env.NEXT_PUBLIC_MOTION_SCHEDULER ?? '').trim().toLowerCase() === '0') {
    return;
  }

  const now = perfNow();
  const mc = getMotionControllerState();
  const baselineActive = isVrmaBaselineLayerActive();
  const b = getBehaviorMotionState();

  const vrmaBlockingAmbient =
    mc.active &&
    mc.source === 'VRMA' &&
    !baselineActive;

  if (now - lastSchedulerPlayAt < MIN_BETWEEN_SCHEDULER_PLAYS_MS) return;

  if (b.lastActionTime > 0 && now - b.lastActionTime < MIN_SINCE_LAST_ACTION_MS) return;

  if (vrmaBlockingAmbient) return;

  void getEmbodimentState();

  const mode = b.mode;
  const { unifiedGestureEngine } = await loadGestureEngine();

  if (mode === 'RESPONDING') {
    lastSchedulerPlayAt = now;
    void unifiedGestureEngine.play('explain', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    return;
  }

  if (mode === 'LISTENING') {
    lastSchedulerPlayAt = now;
    void unifiedGestureEngine.play('nod', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    return;
  }

  if (mode === 'THINKING') {
    // WS `llm_thinking` already queues Thinking VRMA (HIGH) — ambient LOW re-play stacks clips / neck.
    if (useBrainStore.getState().thinking) {
      return;
    }
    lastSchedulerPlayAt = now;
    void unifiedGestureEngine.play('thinking', {
      priority: PRIORITY.LOW,
      humanTiming: false,
      behaviorBrain: false,
    });
    return;
  }

  if (mode === 'IDLE' && Math.random() > 0.2) return;

  lastSchedulerPlayAt = now;
  void unifiedGestureEngine.play('idle_shift', {
    priority: PRIORITY.LOW,
    humanTiming: false,
    behaviorBrain: true,
  });
}

/** Idempotent — starts one 100–200ms loop for ambient motion scheduling. */
export function startMotionScheduler(): void {
  if (typeof window === 'undefined' || started) return;
  if (isVrmaPlaybackGloballyDisabled()) {
    started = true;
    return;
  }
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
