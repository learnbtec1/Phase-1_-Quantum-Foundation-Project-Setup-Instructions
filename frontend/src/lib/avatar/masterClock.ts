/**
 * MasterClock — single wall-clock reference for brain ticks, motion scheduling, and frame logic.
 * Use `nowMs()` everywhere instead of scattering `Date.now()` / `performance.now()`.
 * Session elapsed time is optional (avatar session anchor).
 */
'use client';

let _sessionAnchorMs: number | null = null;

/** Idempotent — call once when the avatar Canvas mounts. */
export function initMasterClockSession(): void {
  if (_sessionAnchorMs !== null) return;
  _sessionAnchorMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Monotonic ms — safe for deltas and brain `tickIntentBrain(nowMs)`. */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Seconds since avatar session anchor (falls back to first call). */
export function sessionElapsedSec(): number {
  if (_sessionAnchorMs === null) initMasterClockSession();
  return (nowMs() - (_sessionAnchorMs ?? 0)) / 1000;
}

/** Alias — procedural phase `t` (replaces R3F `state.clock.elapsedTime`). */
export const elapsedSec = sessionElapsedSec;

/** Test / dev: reset session anchor (do not use in production paths). */
export function resetMasterClockSessionForTests(): void {
  _sessionAnchorMs = null;
}
