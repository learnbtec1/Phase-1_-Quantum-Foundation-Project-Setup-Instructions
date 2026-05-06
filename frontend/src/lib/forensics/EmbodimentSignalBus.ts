'use client';

/**
 * Lightweight nervous-system fan-out — optional subscribers only (no hot-path allocations).
 */

type VoidFn = () => void;

const _subs = new Set<VoidFn>();

export function embodimentSignalSubscribe(fn: VoidFn): () => void {
  _subs.add(fn);
  return () => {
    _subs.delete(fn);
  };
}

/** Called once per embodiment intelligence cycle (~60s), not per frame. */
export function embodimentSignalEmitCycleComplete(): void {
  for (const fn of _subs) {
    try {
      fn();
    } catch {
      /* non-blocking */
    }
  }
}
