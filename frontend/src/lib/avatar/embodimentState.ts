/**
 * Single snapshot of avatar embodiment for motion layers — one causal frame of reference.
 * Populated each frame from VRMSkeletonManager; intent motor reads only this (not scattered getters).
 */
import type { BehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import type { MotionIntentState } from '@/lib/avatar/motionIntentContinuity';

/** Optional affect label for intent motor (Phase 2); LLM or pipeline may set. */
export type EmotionHint = 'neutral' | 'happy' | 'focused' | 'thinking' | 'calm' | 'intense';

/** Meaning channels for intent motor — derived from utterance text each frame (0..1). */
export type SpeechSemanticHints = {
  emphasis: number;
  question: number;
  uncertainty: number;
  explanation: number;
  /** "Look", "notice", "pay attention", imperative cues → headTurn. */
  attention?: number;
  /** "Let me think", "hmm" — explicit hesitation cues → headTilt. */
  thinkingCue?: number;
  emotion?: EmotionHint;
};

export type EmbodimentSpeechSlice = {
  energy: number;
  phrasePhase: number;
  syllablePulse: number;
  active: boolean;
  /** Low energy during speech — soft tail / pause */
  inPause?: boolean;
};

export type EmbodimentState = {
  behaviorMode: BehaviorMotionMode;
  intent: MotionIntentState;
  speech: EmbodimentSpeechSlice;
  /** Speech meaning → motion modulation (additive in intent motor). */
  hints: SpeechSemanticHints;
};

const defaultHints: SpeechSemanticHints = {
  emphasis: 0,
  question: 0,
  uncertainty: 0,
  explanation: 0,
  attention: 0,
  thinkingCue: 0,
};

let _embodimentState: EmbodimentState = {
  behaviorMode: 'IDLE',
  intent: {
    activeIntent: null,
    intensity: 0.5,
    startTime: 0,
  },
  speech: {
    energy: 0,
    phrasePhase: 0,
    syllablePulse: 0,
    active: false,
    inPause: false,
  },
  hints: { ...defaultHints },
};

export function getEmbodimentState(): EmbodimentState {
  return {
    behaviorMode: _embodimentState.behaviorMode,
    intent: { ..._embodimentState.intent },
    speech: { ..._embodimentState.speech },
    hints: { ..._embodimentState.hints },
  };
}

export function updateEmbodimentState(next: Partial<EmbodimentState>): void {
  if (next.behaviorMode !== undefined) {
    _embodimentState.behaviorMode = next.behaviorMode;
  }
  if (next.intent !== undefined) {
    _embodimentState.intent = { ..._embodimentState.intent, ...next.intent };
  }
  if (next.speech !== undefined) {
    _embodimentState.speech = { ..._embodimentState.speech, ...next.speech };
  }
  if (next.hints !== undefined) {
    _embodimentState.hints = { ..._embodimentState.hints, ...next.hints };
  }
}
