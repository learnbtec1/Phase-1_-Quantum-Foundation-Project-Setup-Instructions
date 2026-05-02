// frontend/src/lib/behavior/gestureScheduler.ts

import type { BehaviorPayload, GestureCommand, MicroExpressionCommand, GazeCommand } from './types';

const AVATAR_EVENTS = {
  GESTURE: 'avatar:gesture',
  MICRO_GESTURE: 'avatar:micro:gesture',
  GAZE: 'avatar:gaze',
  POSTURE: 'avatar:posture',
  CANCEL_ALL: 'avatar:behavior:cancel',
} as const;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export class GestureScheduler {
  private pendingTimers: number[] = [];

  schedule(payload: BehaviorPayload | null | undefined, speechStartDelay = 0): void {
    if (!payload || !isBrowser()) return;
    this.cancelAll();

    const baseDelay = speechStartDelay;
    for (const g of payload.gestures ?? []) {
      this.scheduleGesture(g, baseDelay);
    }
    for (const m of payload.micro_expressions ?? []) {
      this.scheduleMicro(m, baseDelay);
    }
    for (const gz of payload.gaze ?? []) {
      this.scheduleGaze(gz, baseDelay);
    }
    if (payload.posture) {
      this.dispatch(AVATAR_EVENTS.POSTURE, payload.posture);
    }
  }

  private scheduleGesture(gesture: GestureCommand, baseDelay: number): void {
    const delay =
      (gesture.critical_timing ? 0 : baseDelay) + gesture.start_offset_ms;
    const id = window.setTimeout(() => {
      this.dispatch(AVATAR_EVENTS.GESTURE, {
        type: gesture.type,
        side: gesture.side === 'none' ? 'right' : gesture.side,
        duration: Math.max(0.3, gesture.duration_ms / 1000),
        priority: gesture.priority,
        // ═══ NEW ═══
        scaleFactor: gesture.scale_factor ?? 1.0,
      });
      this.pendingTimers = this.pendingTimers.filter((t) => t !== id);
    }, delay);
    this.pendingTimers.push(id);
  }

  private scheduleMicro(micro: MicroExpressionCommand, baseDelay: number): void {
    const delay = baseDelay + micro.start_offset_ms;
    const id = window.setTimeout(() => {
      // `kind` is the field VRMSkeletonManager reads; keep `type` for back-compat
      this.dispatch(AVATAR_EVENTS.MICRO_GESTURE, {
        kind: micro.type,
        type: micro.type,
        durationMs: micro.duration_ms,
        intensity: micro.intensity,
      });
      this.pendingTimers = this.pendingTimers.filter((t) => t !== id);
    }, delay);
    this.pendingTimers.push(id);
  }

  /**
   * Map semantic gaze target → yaw/pitch values understood by AnimationController.
   * 'user'  → face camera  (yaw≈0 pitch≈0)
   * 'away'  → look off-screen
   * 'think' → look up-left (thinking gaze)
   */
  private scheduleGaze(gaze: GazeCommand, baseDelay: number): void {
    const delay = baseDelay + gaze.start_offset_ms;
    const id = window.setTimeout(() => {
      const MAP: Record<GazeCommand['target'], { yaw: number; pitch: number }> = {
        user:  { yaw:  0.00, pitch:  0.00 },
        away:  { yaw:  0.32 * (Math.random() > 0.5 ? 1 : -1), pitch: 0.10 },
        think: { yaw: -0.20, pitch: -0.18 },
      };
      const { yaw, pitch } = MAP[gaze.target] ?? MAP['user'];
      this.dispatch(AVATAR_EVENTS.GAZE, {
        yaw, pitch,
        durationMs: gaze.duration_ms,
        target: gaze.target,
      });
      this.pendingTimers = this.pendingTimers.filter((t) => t !== id);
    }, delay);
    this.pendingTimers.push(id);
  }

  private dispatch(eventName: string, detail: unknown): void {
    if (!isBrowser()) return;
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  cancelAll(): void {
    if (!isBrowser()) return;
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers = [];
    this.dispatch(AVATAR_EVENTS.CANCEL_ALL, {});
  }
}

let _instance: GestureScheduler | null = null;

export function getGestureScheduler(): GestureScheduler {
  if (!_instance) _instance = new GestureScheduler();
  return _instance;
}

// ── Sonnet audit: direct morph-style micro-expression dispatch (optional API) ──

export interface MicroExpressionMorphTargets {
  halfSmile?: number;
  eyebrowRaise?: number;
  surprised?: number;
  angry?: number;
  relaxed?: number;
  happy?: number;
  /** Optional hold duration for AvatarCanvas overlay (ms). */
  durationMs?: number;
}

/**
 * Dispatches `avatar:micro:gesture` with numeric morph keys. AvatarCanvas lerps these
 * without requiring a `type` string (scheduler path still uses `type` + intensity).
 */
export function dispatchMicroExpression(targets: MicroExpressionMorphTargets): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(AVATAR_EVENTS.MICRO_GESTURE, { detail: { ...targets } }),
  );
}

export const GESTURES = {
  encouragement: () =>
    dispatchMicroExpression({ halfSmile: 0.2, eyebrowRaise: 0.08, durationMs: 1400 }),

  thinking: () => dispatchMicroExpression({ eyebrowRaise: 0.12, durationMs: 1200 }),

  neutral: () => dispatchMicroExpression({ halfSmile: 0, eyebrowRaise: 0, surprised: 0, durationMs: 600 }),

  surprised: () =>
    dispatchMicroExpression({ surprised: 0.15, eyebrowRaise: 0.1, durationMs: 1000 }),
} as const;
