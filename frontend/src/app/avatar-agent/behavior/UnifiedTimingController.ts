/**
 * Level 7.2 — One place for schedule jitter + shared offset so host/composer timing stays aligned.
 */

import type { MotionPlan } from './intentTypes';

export class UnifiedTimingController {
  private static baseOffset = 0;

  static schedule(baseMs: number, instability: number): number {
    const jitter = (Math.random() - 0.5) * instability * 80;
    return baseMs + jitter + this.baseOffset;
  }

  /** Align layers with the current mind clock step (ms). */
  static sync(delta: number): void {
    this.baseOffset = delta;
  }

  static reset(): void {
    this.baseOffset = 0;
  }

  /** Apply {@link UnifiedTimingController.schedule} to all delay fields on the plan. */
  static applyToMotionPlan(plan: MotionPlan, timingInstability: number): MotionPlan {
    const inst = Math.max(0, timingInstability);
    const { timing, layerTimings } = plan;
    const next: MotionPlan = {
      ...plan,
      timing: {
        delayMs: Math.max(0, Math.round(this.schedule(timing.delayMs, inst))),
        durationMs: Math.max(
          120,
          Math.round(this.schedule(timing.durationMs, inst * 0.65)),
        ),
      },
    };
    if (layerTimings) {
      next.layerTimings = {
        gazeDelayMs: Math.max(0, Math.round(this.schedule(layerTimings.gazeDelayMs, inst))),
        headDelayMs: Math.max(0, Math.round(this.schedule(layerTimings.headDelayMs, inst))),
        gestureDelayMs: Math.max(
          0,
          Math.round(this.schedule(layerTimings.gestureDelayMs, inst)),
        ),
      };
    }
    return next;
  }
}
