/**
 * Interaction intent — decision layer only (no VRMA / motion pipeline changes).
 * Maps brain state → discrete mode → presentation hints for head/gaze/blink.
 */

import type { AgentFrame, EmotionLabel, PADVector } from '@/types/ai';

export type InteractionIntent =
  | 'listening'
  | 'thinking'
  | 'explaining'
  | 'emphasizing'
  | 'idle';

/** Treat explaining + emphasizing as “teaching / talking with purpose” for gaze/motion. */
export function isExplainingIntent(intent: InteractionIntent): boolean {
  return intent === 'explaining' || intent === 'emphasizing';
}

export interface InteractionIntentSnapshot {
  talking: boolean;
  thinking: boolean;
  isUserSpeaking: boolean;
  isListening: boolean;
  emotionLabel: EmotionLabel;
  lastFrame: AgentFrame | null;
  pad?: PADVector;
  speechEmphasisHint?: number;
}

const THINKING_EMOTIONS = new Set<EmotionLabel>(['thinking', 'curious', 'surprised']);
const THINKING_FRAME_MS = 850;
const EMPHASIS_AROUSAL = 0.5;
const EMPHASIS_HINT = 0.55;

/**
 * Priority: user has floor → listening; cognitive load → thinking;
 * agent speaks → emphasizing (stress) or explaining; else idle.
 */
export function computeInteractionIntent(s: InteractionIntentSnapshot): InteractionIntent {
  if (s.isUserSpeaking || s.isListening) return 'listening';
  if (s.thinking) return 'thinking';
  const tMs = s.lastFrame?.thinking_time_ms;
  if (typeof tMs === 'number' && tMs >= THINKING_FRAME_MS && !s.talking) return 'thinking';
  if (THINKING_EMOTIONS.has(s.emotionLabel) && !s.talking && !s.isUserSpeaking) return 'thinking';
  if (s.talking) {
    const hint = typeof s.speechEmphasisHint === 'number' ? s.speechEmphasisHint : 0;
    const ar = s.pad?.arousal ?? 0;
    if (hint >= EMPHASIS_HINT || ar >= EMPHASIS_AROUSAL) return 'emphasizing';
    return 'explaining';
  }
  return 'idle';
}

/** Presentation multipliers — head/face only; VRMA body unchanged. */
export interface IntentPresentation {
  headNoiseMul: number;
  headGazeMul: number;
  saccadeMul: number;
  humanIdleNeckMul: number;
  animationGazeScaleMul: number;
  animationSaccadeMul: number;
}

export function getIntentPresentation(intent: InteractionIntent): IntentPresentation {
  switch (intent) {
    case 'listening':
      return {
        headNoiseMul: 0.22,
        headGazeMul: 1,
        saccadeMul: 0.22,
        humanIdleNeckMul: 0.35,
        animationGazeScaleMul: 0.68,
        animationSaccadeMul: 0.22,
      };
    case 'thinking':
      return {
        headNoiseMul: 0.42,
        headGazeMul: 0.78,
        saccadeMul: 0.5,
        humanIdleNeckMul: 0.55,
        animationGazeScaleMul: 0.52,
        animationSaccadeMul: 0.42,
      };
    case 'explaining':
      return {
        headNoiseMul: 0.78,
        headGazeMul: 0.95,
        saccadeMul: 0.88,
        humanIdleNeckMul: 1.05,
        animationGazeScaleMul: 1.02,
        animationSaccadeMul: 0.82,
      };
    case 'emphasizing':
      return {
        headNoiseMul: 0.92,
        headGazeMul: 1.02,
        saccadeMul: 0.95,
        humanIdleNeckMul: 1.12,
        animationGazeScaleMul: 1.08,
        animationSaccadeMul: 0.88,
      };
    default:
      return {
        headNoiseMul: 1,
        headGazeMul: 1,
        saccadeMul: 1,
        humanIdleNeckMul: 1,
        animationGazeScaleMul: 1,
        animationSaccadeMul: 1,
      };
  }
}
