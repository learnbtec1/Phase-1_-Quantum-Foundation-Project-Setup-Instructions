/**
 * Shared AI / Avatar type definitions.
 *
 * Used by:
 *   • useBrainStore  (store state shape)
 *   • AgentDirector  (PAD, BehaviorOutput, AgentFrame)
 *   • EmotionalMemoryManager (EmotionalMemoryEntry)
 *   • BehaviorRulesEngine (PADVector, BehaviorOutput)
 *   • useAgentAgent  (EmotionLabel, AgentFrame)
 */

// ─── Emotion label ─────────────────────────────────────────────────────────────

export type EmotionLabel =
  | 'neutral'
  | 'calm'
  | 'thinking'
  | 'encouraging'
  | 'excited'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'relaxed'
  | 'attentive'
  | 'proud'
  | 'curious'
  | 'concerned'
  | 'sleepy'
  | 'bored'
  | 'anxious'
  | 'empathetic';

// ─── PAD model ─────────────────────────────────────────────────────────────────

/** Pleasure–Arousal–Dominance affective space. All axes: −1 to 1. */
export interface PADVector {
  pleasure:  number;
  arousal:   number;
  dominance: number;
}

// ─── Agent frame (from WebSocket backend) ─────────────────────────────────────

/** A single AI reply frame from the WebSocket backend. */
export interface AgentFrame {
  /** Natural-language reply text (Arabic). */
  text:                string;
  /** Raw emotion string from the backend (may differ from EmotionLabel). */
  emotion:             string;
  /** Natural-language action / gesture description from the action line. */
  gesture:             string;
  /** Estimated gesture duration in milliseconds. */
  gesture_duration_ms: number;
  /** Micro-expression hint (usually same as emotion). */
  expression:          string;
  /** TTS voice parameters. */
  voice:               { pitch: number; rate: number };
  /** Thinking / reaction delay in milliseconds. */
  thinking_time_ms:    number;
  /**
   * Optional user-side PAD from backend (e.g. future sentiment / SER).
   * When set, BrainStore blends with avatar PAD for independent affect.
   */
  user_pad?:           PADVector;
  /**
   * True when the WS frame included a non-empty LLM `performance` array.
   * AgentDirector must not infer body gestures from legacy action text,
   * GestureEngine, emotion contracts, or co-speech — only `avatar:performance` cues apply.
   */
  gesturesFromStructuredPerformance?: boolean;
}

// ─── Behavior output ───────────────────────────────────────────────────────────

/**
 * Output of BehaviorRulesEngine.decideBehaviorFromPAD.
 * Also stored in BrainStore.currentAction for the AgentDirector to consume.
 */
export interface BehaviorOutput {
  /** Gesture type string (e.g. 'openHand', 'point', 'idle'). */
  gesture:             string;
  /** Face / rules-engine expression hint (e.g. 'happy', 'strict'). */
  expression?:       string;
  /** Gesture intensity (0–1.5). */
  gestureIntensity?:   number;
  /** Gesture duration in milliseconds. */
  gestureDurationMs?:  number;
  /** Which hand: 'left' | 'right' | 'both'. */
  gestureSide?:        string;
  /** Voice tone hint: 'warm' | 'firm' | 'soft' | 'excited' | 'neutral'. */
  voiceTone?:          string;
  /** How long to wait before executing the behavior (ms). */
  thinkingDelayMs:     number;
}

// ─── Emotional memory ──────────────────────────────────────────────────────────

/** A single snapshot in the avatar's emotional memory timeline. */
export interface EmotionalMemoryEntry {
  /** Avatar PAD at time of recording. */
  avatarPAD: PADVector;
  /** Emotional mood attributed to the user in this moment. */
  userMood:  EmotionLabel;
  /** Normalised PAD magnitude (0–1) — used for LTM promotion decisions. */
  intensity: number;
  /** Optional topic string extracted from the dialogue. */
  topic?:    string;
  /** Unix timestamp in milliseconds. */
  ts:        number;
}

// ─── Long-term memory ──────────────────────────────────────────────────────────

export interface ImportantMoment {
  description: string;
  ts:          number;
}

export interface LongTermMemory {
  userInterests:    string[];
  importantMoments: ImportantMoment[];
}
