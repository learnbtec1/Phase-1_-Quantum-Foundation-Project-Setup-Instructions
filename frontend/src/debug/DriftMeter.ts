/**
 * DriftMeter — Measures viseme lip-sync temporal drift.
 *
 * Drift = |audio.currentTime_ms − lastAppliedCue_ms|
 *
 * A reading ≤ 50 ms passes the performance budget defined in the spec.
 * Readings > 50 ms indicate the render loop is falling behind the audio clock.
 *
 * Usage (inside AvatarCanvas useFrame — no allocations):
 *
 *   const drift = driftMeter.measure(audioEl.currentTime * 1000, lastCueAppliedMs);
 *   // drift is now available in AvatarInspector via inspectorRef
 *
 * Design goals:
 *   • Zero heap allocations in the hot path.
 *   • Rolling 30-sample average (ringbuffer).
 *   • Exposes peakDrift and avgDrift for the inspector.
 */

const RING_SIZE = 30;

export class DriftMeter {
  private readonly _samples: Float32Array = new Float32Array(RING_SIZE);
  private _head    = 0;
  private _count   = 0;
  private _peak    = 0;
  private _sum     = 0;
  private _lastRaw = 0;

  /** The most recent raw drift reading (ms). */
  get lastMs(): number  { return this._lastRaw; }
  /** Peak drift observed in the rolling window (ms). */
  get peakMs(): number  { return this._peak; }
  /** Rolling average drift (ms). */
  get avgMs():  number  { return this._count > 0 ? this._sum / this._count : 0; }
  /** True if the latest sample exceeds the 50 ms budget. */
  get overBudget(): boolean { return this._lastRaw > 50; }

  /**
   * Record a drift sample. Call once per frame while lip-sync is active.
   * @param audioNowMs      audio.currentTime × 1000
   * @param lastCuedMs      timestamp (ms) of the last viseme cue applied
   */
  measure(audioNowMs: number, lastCuedMs: number): number {
    const drift = Math.abs(audioNowMs - lastCuedMs);
    this._lastRaw = drift;

    // Evict oldest sample from sum
    const old = this._samples[this._head];
    this._sum -= old;

    // Insert new sample
    this._samples[this._head] = drift;
    this._sum += drift;
    this._head = (this._head + 1) % RING_SIZE;
    if (this._count < RING_SIZE) this._count++;

    // Update peak
    if (drift > this._peak) this._peak = drift;

    return drift;
  }

  /** Reset all accumulated state (call when lip-sync session ends). */
  reset(): void {
    this._samples.fill(0);
    this._head  = 0;
    this._count = 0;
    this._peak  = 0;
    this._sum   = 0;
    this._lastRaw = 0;
  }

  /** Human-readable summary for the debug overlay. */
  toString(): string {
    return `drift: last=${this._lastRaw.toFixed(0)}ms avg=${this.avgMs.toFixed(0)}ms peak=${this._peak.toFixed(0)}ms`;
  }
}

/** Singleton — share one meter across the entire VRMScene lifetime. */
export const driftMeter = new DriftMeter();
