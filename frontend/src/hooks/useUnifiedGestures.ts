'use client';

/**
 * useUnifiedGestures — React bridge to UnifiedGestureEngine.
 *
 * - Initialises the gesture normalizer once per mount (idempotent)
 * - Exposes typed API for component-level gesture dispatch
 */
import { useCallback, useEffect, useMemo } from 'react';
import {
  unifiedGestureEngine,
  initGestureNormalizer,
  type CanonicalGesture,
} from '@/ai/cognitive/UnifiedGestureEngine';
import { PRIORITY, type PriorityValue } from '@/constants/gestures';

export type { CanonicalGesture, PriorityValue };
export { PRIORITY };

export interface GesturePlayOptions {
  priority?: PriorityValue;
  durationMs?: number;
  crossFade?: boolean;
}

export function useUnifiedGestures() {
  useEffect(() => {
    initGestureNormalizer();
  }, []);

  const play = useCallback(
    (name: string, opts?: GesturePlayOptions) => unifiedGestureEngine.play(name, opts),
    [],
  );

  const think   = useCallback(() => unifiedGestureEngine.think(),   []);
  const wave    = useCallback(() => unifiedGestureEngine.wave(),    []);
  const clap    = useCallback(() => unifiedGestureEngine.clap(),    []);
  const agree   = useCallback(() => unifiedGestureEngine.agree(),   []);
  const listen  = useCallback(() => unifiedGestureEngine.listen(),  []);
  const process = useCallback(() => unifiedGestureEngine.process(), []);
  const error   = useCallback(() => unifiedGestureEngine.error(),   []);
  const curious = useCallback(() => unifiedGestureEngine.curious(), []);
  const idle    = useCallback(() => unifiedGestureEngine.idle(),    []);
  const cancelAll = useCallback(() => unifiedGestureEngine.cancelAll(), []);

  const stats = useCallback(() => unifiedGestureEngine.getStats(), []);

  return useMemo(() => ({
    engine: unifiedGestureEngine,
    play,
    think,
    wave,
    clap,
    agree,
    listen,
    process,
    error,
    curious,
    idle,
    cancelAll,
    stats,
    PRIORITY,
  }), [play, think, wave, clap, agree, listen, process, error, curious, idle, cancelAll, stats]);
}

/** Alias maintained for backward compatibility with callers of `useGestures` */
export { useUnifiedGestures as useGestures };
