/**
 * eyeTracker.ts
 * ─────────────
 * Eye tracking and natural gaze behavior for Cogni avatar.
 */

import { Vector3 } from 'three';

export interface GazeTarget {
  type: 'camera' | 'away' | 'think' | 'down' | 'custom';
  position?: Vector3;
  duration?: number;
}

export interface GazeState {
  currentTarget: GazeTarget;
  targetYaw: number;
  targetPitch: number;
  holdUntil: number;
  nextAutoGazeTime: number;
}

interface EyeTrackerConfig {
  enabled: boolean;
  lerpFactor: number;
  gazeAwayIntervalMin: number;
  gazeAwayIntervalMax: number;
  gazeAwayDurationMin: number;
  gazeAwayDurationMax: number;
  gazeHoldOnUserSpeech: number;
}

const DEFAULT_CONFIG: EyeTrackerConfig = {
  enabled: true,
  lerpFactor: 0.08,
  gazeAwayIntervalMin: 8,
  gazeAwayIntervalMax: 15,
  gazeAwayDurationMin: 500,
  gazeAwayDurationMax: 1200,
  gazeHoldOnUserSpeech: 2.5,
};

export class EyeTracker {
  private config: EyeTrackerConfig;
  private state: GazeState;
  private cameraPosition: Vector3 = new Vector3(0, 0, 5);

  constructor(config?: Partial<EyeTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.state = {
      currentTarget: { type: 'camera' },
      targetYaw: 0,
      targetPitch: 0,
      holdUntil: 0,
      nextAutoGazeTime: Date.now() + this.randomGazeAwayInterval(),
    };

    const envEnabled = process.env.NEXT_PUBLIC_COGNI_ENABLE_EYE_TRACKING;
    if (envEnabled !== undefined) {
      this.config.enabled = envEnabled.toLowerCase() === 'true';
    }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /** When true, neck/gaze refs drive the face; skip raw eye-bone saccades in VRMSkeletonManager. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  setCameraPosition(position: Vector3): void {
    this.cameraPosition.copy(position);
  }

  setGazeTarget(target: GazeTarget): void {
    this.state.currentTarget = target;
    this.state.holdUntil = Date.now() + (target.duration ?? 2000);
    this.updateTargetAngles();
  }

  onUserSpeechStart(): void {
    this.state.currentTarget = { type: 'camera' };
    this.state.holdUntil = Date.now() + this.config.gazeHoldOnUserSpeech * 1000;
    this.updateTargetAngles();
  }

  update(currentYaw: number, currentPitch: number): { yaw: number; pitch: number } {
    if (!this.config.enabled) {
      return { yaw: currentYaw, pitch: currentPitch };
    }

    const now = Date.now();

    if (now > this.state.holdUntil) {
      if (now > this.state.nextAutoGazeTime) {
        this.triggerAutomaticGazeAway();
      }
    }

    this.updateTargetAngles();

    const newYaw = this.lerp(currentYaw, this.state.targetYaw, this.config.lerpFactor);
    const newPitch = this.lerp(currentPitch, this.state.targetPitch, this.config.lerpFactor);

    return { yaw: newYaw, pitch: newPitch };
  }

  private updateTargetAngles(): void {
    switch (this.state.currentTarget.type) {
      case 'camera':
        this.state.targetYaw = 0;
        this.state.targetPitch = 0;
        break;

      case 'away':
        this.state.targetYaw = Math.random() > 0.5 ? 0.4 : -0.4;
        this.state.targetPitch = -0.15;
        break;

      case 'think':
        this.state.targetYaw = Math.random() > 0.5 ? 0.25 : -0.25;
        this.state.targetPitch = 0.3;
        break;

      case 'down':
        this.state.targetYaw = 0;
        this.state.targetPitch = -0.4;
        break;

      case 'custom':
        if (this.state.currentTarget.position) {
          const dx = this.state.currentTarget.position.x;
          const dy = this.state.currentTarget.position.y;
          this.state.targetYaw = Math.atan2(dx, 5);
          this.state.targetPitch = Math.atan2(dy, 5);
        }
        break;
    }
  }

  private triggerAutomaticGazeAway(): void {
    const duration =
      this.config.gazeAwayDurationMin +
      Math.random() * (this.config.gazeAwayDurationMax - this.config.gazeAwayDurationMin);

    this.state.currentTarget = { type: 'away' };
    this.state.holdUntil = Date.now() + duration;

    this.state.nextAutoGazeTime = Date.now() + this.randomGazeAwayInterval();

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[EyeTracker] Auto gaze away for ${duration}ms`);
    }
  }

  private randomGazeAwayInterval(): number {
    return (
      (this.config.gazeAwayIntervalMin +
        Math.random() * (this.config.gazeAwayIntervalMax - this.config.gazeAwayIntervalMin)) *
      1000
    );
  }

  private lerp(current: number, target: number, factor: number): number {
    return current + (target - current) * factor;
  }

  getDebugState(): { target: string; yaw: number; pitch: number; holdUntil: number } {
    return {
      target: this.state.currentTarget.type,
      yaw: this.state.targetYaw,
      pitch: this.state.targetPitch,
      holdUntil: this.state.holdUntil,
    };
  }
}

let _eyeTracker: EyeTracker | null = null;

export function getEyeTracker(): EyeTracker {
  if (!_eyeTracker) {
    _eyeTracker = new EyeTracker();
  }
  return _eyeTracker;
}
