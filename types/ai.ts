/**
 * types/ai.ts — Digital Human AI System Type Definitions
 *
 * Covers:
 *   • PAD emotional model (Pleasure-Arousal-Dominance)
 *   • Big Five personality traits (OCEAN)
 *   • Three-layer memory system
 *   • Avatar physical state
 *   • Rule-based behavior engine types
 *   • LLM structured response frame
 *   • Combined DigitalHumanState
 */

// ─── PAD Emotional Model ──────────────────────────────────────────────────────

/**
 * Pleasure-Arousal-Dominance vector.
 * All components are clamped to [-1.0, 1.0].
 *
 *  pleasure  : +1 = very pleasant   / -1 = very unpleasant
 *  arousal   : +1 = highly activated / -1 = dormant / sleepy
 *  dominance : +1 = in full control  / -1 = submissive / helpless
 */
export interface PADVector {
  pleasure:  number;
  arousal:   number;
  dominance: number;
}

/**
 * Discrete emotion labels derived from PAD space.
 * These map to VRM expressions and TTS parameters.
 */
export type EmotionLabel =
  | 'excited'
  | 'happy'
  | 'calm'
  | 'relaxed'
  | 'surprised'
  | 'neutral'
  | 'curious'
  | 'thinking'
  | 'encouraging'
  | 'proud'
  | 'attentive'
  | 'concerned'
  | 'anxious'
  | 'sad'
  | 'angry'
  | 'bored'
  | 'sleepy';

// ─── Big Five Personality Traits (OCEAN) ─────────────────────────────────────

/**
 * Stable personality dimensions that shape behavior throughout the session.
 * All values are normalised to [0.0, 1.0].
 *
 *  openness          : curiosity / creativity / intellectual engagement
 *  conscientiousness : organisation / reliability / self-discipline
 *  extraversion      : talkativeness / assertiveness / energy
 *  agreeableness     : empathy / cooperativeness / warmth
 *  neuroticism       : emotional reactivity / anxiety sensitivity
 */
export interface BigFiveTraits {
  openness:          number;
  conscientiousness: number;
  extraversion:      number;
  agreeableness:     number;
  neuroticism:       number;
}

// ─── Memory System ────────────────────────────────────────────────────────────

/** One turn inside the short-term conversational buffer */
export interface ConversationTurn {
  readonly id:        string;
  role:               'user' | 'avatar';
  text:               string;
  emotion?:           EmotionLabel;
  /** PAD snapshot at the moment this turn was recorded */
  padSnapshot?:       PADVector;
  timestamp:          number;
}

/**
 * Ring buffer of the most recent N conversation turns.
 * maxTurns is enforced by the store (default 10).
 */
export interface ShortTermMemory {
  turns:       ConversationTurn[];
  readonly maxTurns: number;
}

/**
 * A single emotionally significant moment saved for recall.
 * intensity = normalised magnitude of the PAD vector at that instant.
 */
export interface EmotionalMemoryEntry {
  readonly timestamp: number;
  userMood:           EmotionLabel;
  avatarPAD:          PADVector;
  topic?:             string;
  /** 0..1 — how emotionally significant this moment was */
  intensity:          number;
}

/** Persistent facts about the user accumulated across sessions */
export interface LongTermMemory {
  /** Topics the user has shown strong interest in (occurrence ≥ 3) */
  userInterests:    string[];
  /** topic → occurrence count within the current session */
  frequentTopics:   Record<string, number>;
  /** Manually flagged important moments */
  importantMoments: ReadonlyArray<{
    description: string;
    timestamp:   number;
    emotion:     EmotionLabel;
  }>;
}

// ─── Avatar Physical State ────────────────────────────────────────────────────

/** Real-time physical / procedural animation state of the avatar */
export interface AvatarPhysicalState {
  /** Head yaw  — radians, clamped [-0.5, 0.5] */
  headYaw:      number;
  /** Head pitch — radians, clamped [-0.35, 0.35] */
  headPitch:    number;
  /** Spine forward lean — [0, 0.05] */
  spineForward: number;
  /** Breathing oscillator phase [0, 2π] — drives chest + shoulder motion */
  breathPhase:  number;
  isNodding:    boolean;
  isTalking:    boolean;
  isListening:  boolean;
  /** Blink phase [0, 1] — 0 = open, 1 = fully closed */
  blinkPhase:   number;
}

// ─── Behavior System ──────────────────────────────────────────────────────────

export type GestureType =
  | 'nod'
  | 'headTilt'
  | 'wave'
  | 'beat'
  | 'openHand'
  | 'point'
  | 'shrug'
  | 'leanIn'
  | 'leanBack'
  | 'cross';

export type PostureType = 'neutral' | 'listen' | 'emphasize' | 'relax' | 'defensive';

export type VoiceTone = 'warm' | 'neutral' | 'firm' | 'soft' | 'excited';

/** Compiled motor output produced by the behavior engine for one turn */
export interface BehaviorOutput {
  gesture?:           GestureType;
  gestureDurationMs?: number;
  gestureSide?:       'left' | 'right' | 'both';
  /** 0..1 */
  gestureIntensity?:  number;
  posture?:           PostureType;
  voiceTone?:         VoiceTone;
  /** 0..1 — scales VRM expression blend weight */
  expressionIntensity?: number;
  /** Milliseconds the avatar pauses before speaking (thinking delay) */
  thinkingDelayMs:    number;
}

/**
 * A single declarative rule in the behavior engine.
 * Higher priority rules are evaluated first.
 */
export interface BehaviorRule {
  readonly id: string;
  conditions: {
    userEmotion?:       EmotionLabel;
    padRange?: {
      pleasure?:  [min: number, max: number];
      arousal?:   [min: number, max: number];
      dominance?: [min: number, max: number];
    };
    personalityCheck?: (traits: BigFiveTraits) => boolean;
    topics?:            string[];
  };
  output:    Partial<BehaviorOutput>;
  priority:  number;
}

// ─── Personality Modifiers ────────────────────────────────────────────────────

/** Multipliers derived from Big Five traits, applied at render time */
export interface PersonalityModifiers {
  /** 0.5..2.0 — scales how often gestures fire */
  gestureFrequencyMultiplier: number;
  /** 0.75..1.5 — scales TTS speed */
  speechRateMultiplier:       number;
  /** 0..1 — scales intensity of all physical reactions */
  reactionIntensity:          number;
  /** 0..1 — weight toward empathy responses */
  empathyWeight:              number;
  /** 0..1 — higher = more subtle / restrained expressions */
  expressionSubtlety:         number;
}

// ─── LLM Structured Response Frame ───────────────────────────────────────────

/**
 * Strict contract between the GPT-4o backend and the avatar renderer.
 * The LLM MUST emit this JSON structure on every response.
 *
 * @example
 * {
 *   "text": "That's a really interesting question.",
 *   "emotion": "curious",
 *   "gesture": "يميل الرأس ويفكر",
 *   "gesture_duration_ms": 1500,
 *   "expression": "curious",
 *   "voice": { "pitch": 1.2, "rate": 1.0 },
 *   "thinking_time_ms": 450
 * }
 */
export interface AgentFrame {
  /** Dialogue line — spoken aloud by TTS */
  text:                 string;
  /** Canonical emotion tag (e.g. "curious", "celebrate", "neutral") */
  emotion:              string;
  /** Natural-language gesture description evaluated by GestureEngine */
  gesture:              string;
  gesture_duration_ms:  number;
  /** VRM expression preset name */
  expression:           string;
  voice: {
    /** Multiplicative pitch modifier relative to baseline (1.0 = normal) */
    pitch: number;
    /** Multiplicative rate modifier relative to baseline (1.0 = normal) */
    rate:  number;
  };
  /** How long the avatar hesitates before speaking, in milliseconds */
  thinking_time_ms: number;
}

// ─── Combined Digital Human State ────────────────────────────────────────────

/** Root state object managed by useBrainStore */
export interface DigitalHumanState {
  // ── Emotional core ──────────────────────────────────────────────────────
  pad:          PADVector;
  emotionLabel: EmotionLabel;

  // ── Personality (stable across session) ─────────────────────────────────
  personality:       BigFiveTraits;
  personaModifiers:  PersonalityModifiers;

  // ── Memory layers ────────────────────────────────────────────────────────
  shortTermMemory:  ShortTermMemory;
  emotionalMemory:  EmotionalMemoryEntry[];
  longTermMemory:   LongTermMemory;

  // ── Physical ─────────────────────────────────────────────────────────────
  physical: AvatarPhysicalState;

  // ── Behavior ──────────────────────────────────────────────────────────────
  currentAction: BehaviorOutput | null;

  // ── LLM bridge ────────────────────────────────────────────────────────────
  lastFrame: AgentFrame | null;

  // ── Lifecycle flags ───────────────────────────────────────────────────────
  isSpeaking:     boolean;
  isThinking:     boolean;
  wasInterrupted: boolean;
}
