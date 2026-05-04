/**
 * Motion pipeline diagnostics — enabled when `NEXT_PUBLIC_DEBUG_MOTION=true`
 * (or legacy `NEXT_PUBLIC_DEBUG_MOTION_DIAG=true`).
 */
'use client';

import { isDebugMotion } from '@/lib/logging/runtimeLog';

export function isMotionDiagEnabled(): boolean {
  return isDebugMotion();
}
