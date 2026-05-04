/**
 * Surgical motion / TTS pipeline tracing — enable with `NEXT_PUBLIC_DEBUG_TRACE=true`
 * (or legacy `NEXT_PUBLIC_AVATAR_MOTION_TRACE=1`).
 */
'use client';

import { isDebugTrace, logDebug, logTraceWarn } from '@/lib/logging/runtimeLog';

export function isAvatarMotionTraceOn(): boolean {
  return isDebugTrace();
}

export function motionTraceLog(scope: string, payload?: unknown): void {
  if (!isDebugTrace()) return;
  if (payload !== undefined) {
    logDebug('TRACE', scope, payload);
  } else {
    logDebug('TRACE', scope);
  }
}

/** Call immediately before a `return` that aborts the pipeline step. */
export function motionTraceStopAtGuard(
  guardId: string,
  reason: string,
  ctx?: Record<string, unknown>,
): void {
  if (!isDebugTrace()) return;
  logTraceWarn(`Stopped at Guard ${guardId} because ${reason}`, ctx ?? {});
}
