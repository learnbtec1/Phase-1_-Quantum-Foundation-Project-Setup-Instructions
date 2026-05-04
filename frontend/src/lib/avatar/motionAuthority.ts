/**
 * Central motion authority — one logical owner for body motion at a time.
 * VRMAPlayer (mixer), UnifiedGestureEngine, and SpontaneousBehavior coordinate through this module.
 *
 * Priority (highest → lowest): VRMA > REACTION > GESTURE > IDLE > NONE
 */

import { DEBUG_AVATAR } from '@/app/avatar-agent/debugAvatar';
import { motionDebug } from '@/lib/avatar/motionDebug';
import { motionDiagIncrBlock } from '@/lib/avatar/motionDiagnosticsStore';
import { PRIORITY, type PriorityValue } from '@/constants/gestures';
import { isProceduralOnlyMotion, isVrmaPlaybackGloballyDisabled } from '@/lib/avatar/vrmaPlaybackPolicy';
import { isDebugMotion, logError, logWarn } from '@/lib/logging/runtimeLog';

export type MotionSource = 'NONE' | 'VRMA' | 'GESTURE' | 'IDLE' | 'REACTION';

export type MotionControllerState = {
  active: boolean;
  source: MotionSource;
  startedAt: number;
  lockUntil: number;
};

const motionController: MotionControllerState = {
  active: false,
  source: 'NONE',
  startedAt: 0,
  lockUntil: 0,
};

/** True while mixer is playing the looping baseline idle tier (engine uses to avoid parallel full VRMA). */
let vrmaBaselineLayerActive = false;

export function setVrmaBaselineLayerActive(v: boolean): void {
  vrmaBaselineLayerActive = v;
}

export function isVrmaBaselineLayerActive(): boolean {
  return vrmaBaselineLayerActive;
}

const PRIORITY_RANK: Record<MotionSource, number> = {
  NONE: 0,
  IDLE: 1,
  GESTURE: 2,
  REACTION: 3,
  VRMA: 4,
};

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Non-VRMA locks cannot dominate the body indefinitely — frees VRMA layering. */
export function releaseStaleNonVrmaAuthority(): void {
  if (!motionController.active) return;
  const s = motionController.source;
  if (s === 'NONE' || s === 'VRMA') return;
  const t = perfNow();
  if (t - motionController.startedAt > 2000) {
    releaseMotion(s);
  }
}

export function canOverride(current: MotionSource, next: MotionSource): boolean {
  return PRIORITY_RANK[next] >= PRIORITY_RANK[current];
}

function motionLog(kind: 'START' | 'BLOCKED' | 'END', detail: string): void {
  if (!isDebugMotion() && !DEBUG_AVATAR) return;
  const tag =
    kind === 'START' ? 'MOTION START:' : kind === 'BLOCKED' ? 'MOTION BLOCKED:' : 'MOTION END:';
  // eslint-disable-next-line no-console -- gated by DEBUG_AVATAR / motion debug env
  console.log('[DEBUG][MOTION]', tag, detail);
}

function dispatchAuthorityEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avatar:motion:authority', { detail: getMotionAuthority() }),
  );
}

/** @internal — tests / devtools */
export function getMotionControllerState(): Readonly<MotionControllerState> {
  return motionController;
}

/**
 * Hard guard called every frame by VRMSkeletonManager.
 * In procedural-only mode, if VRMA somehow owns the controller, evict it immediately.
 */
export function assertNoVrmaLeak(): void {
  if (!isProceduralOnlyMotion()) return;
  const src: MotionSource = motionController.source;
  if (src === 'VRMA') {
    logError(
      'SYSTEM',
      '[VRMA LEAK DETECTED] motionController.source=VRMA while PROCEDURAL_ONLY_MOTION=true — forcing release',
    );
    motionController.active = false;
    motionController.source = 'NONE';
    motionController.startedAt = 0;
    motionController.lockUntil = 0;
    vrmaBaselineLayerActive = false;
    dispatchAuthorityEvent();
  }
}

function applyAcquire(next: Exclude<MotionSource, 'NONE'>, lockMs: number): boolean {
  // Hard block — VRMA cannot acquire authority in procedural-only OR globally-disabled mode.
  if ((next as MotionSource) === 'VRMA' && isVrmaPlaybackGloballyDisabled()) {
    // eslint-disable-next-line no-console -- VRMA block confirmation (always-on)
    console.warn('[VRMA BLOCKED SOURCE]', 'applyAcquire hard-blocked', { next, lockMs, caller: new Error().stack?.split('\n')[2]?.trim() });
    return false;
  }
  releaseStaleNonVrmaAuthority();
  const t = perfNow();
  const cur = motionController.source;
  // VRMA (full-body / baseline holder) is primary — REACTION/GESTURE/IDLE never preempt it.
  // CRITICAL path uses `force` + barge-in, which clears authority before acquire.
  if (cur === 'VRMA' && next !== 'VRMA') {
    motionLog('BLOCKED', `VRMA holds — reject ${next}`);
    motionDiagIncrBlock('authority');
    motionDebug('AUTH BLOCK:', cur, '→', next, '(vrma-primary)');
    return false;
  }
  if (cur !== 'NONE' && !canOverride(cur, next)) {
    motionLog('BLOCKED', `${cur}→${next} (priority)`);
    motionDiagIncrBlock('authority');
    motionDebug('AUTH BLOCK:', cur, '→', next, '(priority)');
    return false;
  }
  if (cur === next && next !== 'VRMA' && motionController.active && t < motionController.lockUntil) {
    motionLog('BLOCKED', `same-source-lock ${next}`);
    motionDiagIncrBlock('authority');
    motionDebug('AUTH BLOCK:', cur, '→', next, '(same-source-lock)');
    return false;
  }
  const wasInactive = !motionController.active;
  const prev = motionController.source;
  motionController.active = true;
  motionController.source = next;
  motionController.startedAt = t;
  motionController.lockUntil = t + Math.max(0, lockMs);
  if (wasInactive || prev !== next) motionLog('START', next);
  dispatchAuthorityEvent();
  motionDebug('AUTH STATE:', { ...motionController });
  return true;
}

/**
 * Acquire motion for `next` until `lockMs` elapses (wall clock).
 * `force: true` (CRITICAL engine path): barge VRMA mixer then release VRMA authority so REACTION/GESTURE can run.
 */
export function tryAcquireMotion(
  next: Exclude<MotionSource, 'NONE'>,
  lockMs: number,
  opts?: { force?: boolean },
): boolean {
  releaseStaleNonVrmaAuthority();
  if (opts?.force) {
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('avatar:vrma:barge-in'));
      } catch {
        /* */
      }
    }
    releaseMotion();
  }
  return applyAcquire(next, lockMs);
}

/** Same as `tryAcquireMotion(next, lockMs)` without force / barge. */
export function tryStartMotion(
  next: Exclude<MotionSource, 'NONE'>,
  lockMs: number,
): boolean {
  return tryAcquireMotion(next, lockMs, undefined);
}

/** Clear controller when `source` matches (or clear all if omitted). */
export function releaseMotion(source?: MotionSource): void {
  if (source !== undefined && motionController.source !== source) return;
  const prev = motionController.source;
  motionController.active = false;
  motionController.source = 'NONE';
  motionController.startedAt = 0;
  motionController.lockUntil = 0;
  if (prev !== 'NONE') motionLog('END', prev);
  dispatchAuthorityEvent();
  motionDebug('AUTH STATE:', { ...motionController });
}

export function releaseMotionIfHeld(source: MotionSource): void {
  if (motionController.source === source) releaseMotion(source);
}

/** VRMA barge / teardown — clears VRMA tier only (listener may also fade the mixer). */
export function forceReleaseMotion(_reason?: string): void {
  releaseMotion('VRMA');
}

/** Legacy: VRMA mixer is blocking non-baseline playback (strict VRMA-only gate). */
export type MotionAuthoritySource = 'VRMA' | 'GESTURE' | 'IDLE' | null;

export type MotionAuthorityState = {
  active: boolean;
  source: MotionAuthoritySource;
};

export function getMotionAuthority(): MotionAuthorityState {
  const vrmaBlocking = motionController.active && motionController.source === 'VRMA';
  return {
    active: vrmaBlocking,
    source: vrmaBlocking ? 'VRMA' : null,
  };
}

/** Spontaneous idle layer — only when no motion owner (VRMA / gesture / reaction / idle lock). */
export function motionAuthorityAllowsIdleLayer(): boolean {
  return !motionController.active || motionController.source === 'NONE';
}

/**
 * VRMA mixer: non-baseline clip owns VRMA authority; baseline idle releases it so gestures can enqueue.
 * (Optional sync when not driving authority purely through `tryAcquireMotion` in `playClip`.)
 */
export function syncMotionAuthorityFromVrma(blocking: boolean): void {
  if (isProceduralOnlyMotion()) {
    // In procedural-only mode never let VRMA acquire authority; force-clear if somehow set.
    if (motionController.source === 'VRMA') releaseMotion('VRMA');
    return;
  }
  if (blocking) {
    if (motionController.source !== 'VRMA') {
      tryAcquireMotion('VRMA', 600_000);
    }
  } else if (motionController.source === 'VRMA') {
    releaseMotion('VRMA');
  }
}

/** True while full-body VRMA is active — engine uses this for CRITICAL bypass semantics. */
export function isVrmaBodyMotionExclusive(): boolean {
  return motionController.active && motionController.source === 'VRMA';
}

/** Secondary `avatar:gesture` → full-body VRMA map — block while orchestrated motion is in flight. */
/** Gesture → VRMA map must never block mixer playback; gestures layer procedurally / on mixer. */
export function motionBlocksSecondaryFullBodyVrma(): boolean {
  return false;
}

/** UnifiedGestureEngine `play()` — VRMA primary: enqueue always except CRITICAL uses force in #execute. */
export function motionEngineMayEnqueuePlay(priority: PriorityValue): boolean {
  releaseStaleNonVrmaAuthority();
  if (priority === PRIORITY.CRITICAL) return true;
  if (!motionController.active || motionController.source === 'NONE') return true;
  if (motionController.source === 'VRMA') return true;
  const ok = canOverride(motionController.source, 'GESTURE');
  if (!ok) {
    motionDebug('AUTH BLOCK (enqueue):', motionController.source, 'blocks', 'GESTURE', 'prio', priority);
  }
  return ok;
}

// ─── Gesture repeat memory (shared: VRMAPlayer + callers) ───────────────────

let lastGestureKey: string | null = null;
let lastGestureAt = 0;
const GESTURE_REPEAT_MS = 4000;

export function shouldBlockGestureRepeat(key: string): boolean {
  const t = perfNow();
  const k = key.toLowerCase();
  if (lastGestureKey === k && t - lastGestureAt < GESTURE_REPEAT_MS) {
    motionDiagIncrBlock('gestureRepeat');
    motionDebug('GESTURE REPEAT BLOCK:', k, Math.round(t - lastGestureAt), 'ms since last');
    return true;
  }
  return false;
}

export function recordGesturePlayed(key: string): void {
  lastGestureKey = key.toLowerCase();
  lastGestureAt = perfNow();
}
