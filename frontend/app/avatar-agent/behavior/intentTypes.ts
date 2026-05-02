/**
 * Level 6 — cognitive intent types (no motion, no bones).
 * Motion is derived only via `MotionPlan` from BehaviorToMotionMapper.
 */

export type IntentType =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'reacting'
  | 'greeting';

export type IntentEmotion =
  | 'neutral'
  | 'happy'
  | 'curious'
  | 'focused'
  | 'surprised';

export type IntentSource = 'text' | 'system' | 'context';

/** Raw cognitive output from {@link BehaviorBrain} — never gestures or poses. */
export type Intent = {
  type: IntentType;
  emotion: IntentEmotion;
  /** 0..1 — drive level (not motor ref; host may map separately). */
  intensity: number;
  /** 0..1 — classifier / rule confidence. */
  confidence: number;
  /** Optional suggested hold (ms); arbitrator may adjust. */
  duration?: number;
  source: IntentSource;
};

/** After {@link BehaviorArbitrator} — safe to map to motion. */
export type ApprovedIntent = Intent & {
  adjustedIntensity: number;
  /** Micro-delay before motion execution (human-like). */
  transitionDelay: number;
};

export type MotionEasing = 'linear' | 'ease-in-out';

/**
 * Multi-layer motion plan — execution only in {@link BehaviorBrainHost}.
 * Maps to CustomEvents / dispatchAvatar, never to VRM refs here.
 */
export type MotionPlan = {
  gesture?: string;
  poseModifiers?: {
    headTilt?: number;
    eyeFocus?: 'user' | 'away';
    spineLean?: number;
  };
  timing: {
    delayMs: number;
    durationMs: number;
  };
  smoothing: {
    easing: MotionEasing;
  };
  /** Optional face channel — still dispatched only by host. */
  emotionDispatch?: { emotion: string; strength: number };
  /** Optional motor hint (0.55–1.45); host blends with PAD ref if present. */
  motorMulHint?: number;
  /**
   * Level 6.1 — Stagger relative to `timing.delayMs`: gaze first, then head, then gesture.
   * When absent, host fires all channels in one batch.
   */
  layerTimings?: {
    gazeDelayMs: number;
    headDelayMs: number;
    gestureDelayMs: number;
  };
};
