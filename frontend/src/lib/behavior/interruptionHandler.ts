/**
 * interruptionHandler.ts
 * ──────────────────────
 * Handles user interruptions during avatar speech.
 */

import { cancelAllBehavior } from './behaviorEventHandler';

export interface InterruptionState {
  isInterrupting: boolean;
  interruptionStartTime: number;
  resumeTimeoutId: ReturnType<typeof setTimeout> | null;
}

interface InterruptionConfig {
  enabled: boolean;
  resumeTimeoutMs: number;
  minInterruptionDuration: number;
}

const DEFAULT_CONFIG: InterruptionConfig = {
  enabled: true,
  resumeTimeoutMs: 1500,
  minInterruptionDuration: 300,
};

export class InterruptionHandler {
  private config: InterruptionConfig;
  private state: InterruptionState;
  private onInterruptCallback?: () => void;
  private onResumeCallback?: () => void;

  constructor(config?: Partial<InterruptionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.state = {
      isInterrupting: false,
      interruptionStartTime: 0,
      resumeTimeoutId: null,
    };

    const envEnabled = process.env.NEXT_PUBLIC_COGNI_ENABLE_INTERRUPTION;
    if (envEnabled !== undefined) {
      this.config.enabled = envEnabled.toLowerCase() === 'true';
    }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  onInterrupt(callback: () => void): void {
    this.onInterruptCallback = callback;
  }

  onResume(callback: () => void): void {
    this.onResumeCallback = callback;
  }

  triggerInterruption(): void {
    if (!this.config.enabled || this.state.isInterrupting) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[InterruptionHandler] User interruption detected');
    }

    this.state.isInterrupting = true;
    this.state.interruptionStartTime = Date.now();

    if (this.state.resumeTimeoutId) {
      clearTimeout(this.state.resumeTimeoutId);
      this.state.resumeTimeoutId = null;
    }

    cancelAllBehavior();

    if (typeof window !== 'undefined' && (window as unknown as { cogniStopAudio?: () => void }).cogniStopAudio) {
      try {
        (window as unknown as { cogniStopAudio: () => void }).cogniStopAudio();
      } catch {
        /* ignore */
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:enterListeningMode'));
    }

    if (this.onInterruptCallback) {
      this.onInterruptCallback();
    }
  }

  onUserSpeechEnd(): void {
    if (!this.state.isInterrupting) {
      return;
    }

    const interruptionDuration = Date.now() - this.state.interruptionStartTime;

    if (interruptionDuration < this.config.minInterruptionDuration) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[InterruptionHandler] Interruption too short, ignoring');
      }
      this.state.isInterrupting = false;
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[InterruptionHandler] User stopped speaking, starting resume timeout');
    }

    this.state.resumeTimeoutId = setTimeout(() => {
      this.resume();
    }, this.config.resumeTimeoutMs);
  }

  private resume(): void {
    if (!this.state.isInterrupting) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[InterruptionHandler] Resuming after interruption');
    }

    this.state.isInterrupting = false;
    this.state.resumeTimeoutId = null;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avatar:exitListeningMode'));
    }

    if (this.onResumeCallback) {
      this.onResumeCallback();
    }
  }

  cancelInterruption(): void {
    if (this.state.resumeTimeoutId) {
      clearTimeout(this.state.resumeTimeoutId);
      this.state.resumeTimeoutId = null;
    }
    this.state.isInterrupting = false;
  }

  isInterrupting(): boolean {
    return this.state.isInterrupting;
  }

  getDebugState(): InterruptionState {
    return { ...this.state };
  }
}

let _handler: InterruptionHandler | null = null;

export function getInterruptionHandler(): InterruptionHandler {
  if (!_handler) {
    _handler = new InterruptionHandler();
  }
  return _handler;
}
