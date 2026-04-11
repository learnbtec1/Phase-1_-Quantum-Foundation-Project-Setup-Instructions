/**
 * Level 7 — Single simulation clock for composed behavior (jitter, ordering).
 */

export class TimeCore {
  private static nowMs = 0;

  static tick(deltaMs: number): void {
    const d = Math.max(0, Math.min(500, deltaMs));
    this.nowMs += d;
  }

  /** Monotonic ms since first tick (not wall clock). */
  static get(): number {
    return this.nowMs;
  }

  static reset(): void {
    this.nowMs = 0;
  }
}
