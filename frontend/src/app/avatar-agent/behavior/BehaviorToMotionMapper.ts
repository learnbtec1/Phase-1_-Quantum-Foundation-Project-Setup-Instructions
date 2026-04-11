/**
 * Level 6 — Maps {@link ApprovedIntent} → {@link MotionPlan} (data only).
 * MUST NOT import VRM, PoseComposer, or three.
 */

import type { ApprovedIntent, MotionPlan } from './intentTypes';

function emotionToDispatch(emotion: string, strength: number): { emotion: string; strength: number } {
  const map: Record<string, string> = {
    neutral: 'neutral',
    happy: 'happy',
    curious: 'surprised',
    focused: 'neutral',
    surprised: 'surprised',
  };
  return { emotion: map[emotion] ?? 'neutral', strength: clamp01(strength) };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive a single motion plan from an approved intent.
 */
export function approvedIntentToMotionPlan(approved: ApprovedIntent): MotionPlan {
  const strength = 0.32 + 0.5 * approved.adjustedIntensity;
  const baseDelay = approved.transitionDelay;
  const easing = 'ease-in-out' as const;

  switch (approved.type) {
    case 'greeting':
      return {
        gesture: 'wave',
        poseModifiers: {
          headTilt: 0.12,
          eyeFocus: 'user',
          spineLean: 0.04,
        },
        timing: {
          delayMs: baseDelay + 40,
          durationMs: approved.duration ?? 900,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch('happy', strength),
        motorMulHint: 0.88 + 0.2 * approved.adjustedIntensity,
      };

    case 'thinking':
      return {
        poseModifiers: {
          headTilt: 0.28,
          eyeFocus: 'away',
          spineLean: 0.02,
        },
        timing: {
          delayMs: baseDelay + 60,
          durationMs: approved.duration ?? 2800,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch('curious', strength * 0.92),
        motorMulHint: 0.78 + 0.15 * approved.adjustedIntensity,
      };

    case 'reacting':
      return {
        gesture: 'agree',
        poseModifiers: {
          headTilt: 0.08,
          eyeFocus: 'user',
        },
        timing: {
          delayMs: baseDelay + 30,
          durationMs: approved.duration ?? 1600,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch(
          approved.emotion === 'surprised' ? 'surprised' : 'happy',
          strength,
        ),
        motorMulHint: 0.92 + 0.12 * approved.adjustedIntensity,
      };

    case 'listening':
      return {
        poseModifiers: {
          headTilt: 0.06,
          eyeFocus: 'user',
        },
        timing: {
          delayMs: baseDelay,
          durationMs: approved.duration ?? 3200,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch('focused', strength * 0.75),
        motorMulHint: 0.72 + 0.1 * approved.adjustedIntensity,
      };

    case 'speaking':
      return {
        gesture: 'explain',
        poseModifiers: {
          headTilt: 0.1,
          eyeFocus: 'user',
        },
        timing: {
          delayMs: baseDelay + 20,
          durationMs: approved.duration ?? 4200,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch(approved.emotion, strength * 0.88),
        motorMulHint: 0.85 + 0.18 * approved.adjustedIntensity,
      };

    case 'idle':
    default:
      return {
        gesture: 'idle',
        poseModifiers: {
          headTilt: 0.02,
          eyeFocus: 'user',
        },
        timing: {
          delayMs: baseDelay,
          durationMs: 500,
        },
        smoothing: { easing },
        emotionDispatch: emotionToDispatch('neutral', 0.28 + 0.2 * approved.adjustedIntensity),
        motorMulHint: 0.75 + 0.08 * approved.adjustedIntensity,
      };
  }
}
