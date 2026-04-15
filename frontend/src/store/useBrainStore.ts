/**
 * useBrainStore — Phase 4 Central Brain State (Zustand)
 *
 * The single source of truth for the avatar's real-time cognitive state:
 *   • Emotional state  (emotionLabel, PAD vector)
 *   • Physical state   (talking, thinking, listening)
 *   • Last LLM frame   (AgentFrame — drives AgentDirector subscriptions)
 *   • Current action   (BehaviorOutput — explicit AgentDirector action queue)
 *   • Conversation history (short-term turns)
 *   • Emotional memory (trajectory entries for EmotionalMemoryManager)
 *   • Long-term memory (user interests, important moments)
 *
 * Uses Zustand's subscribeWithSelector middleware so AgentDirector can
 * subscribe to individual state slices:
 *   useBrainStore.subscribe(s => s.emotionLabel, (next, prev) => { ... })
 */

import { create }                  from 'zustand';
import { subscribeWithSelector }   from 'zustand/middleware';
import { setCognitiveOrchestratorLLMOutput } from '@/lib/ai/cognitiveOrchestrator';
import type {
  EmotionLabel,
  PADVector,
  AgentFrame,
  BehaviorOutput,
  EmotionalMemoryEntry,
  LongTermMemory,
} from '@/types/ai';
import type { InteractionIntent } from '@/ai/avatar/avatarIntent';
import type { UserMirrorEmotion, UserSpeechRhythm } from '@/lib/avatar/userEmotionMirror';

// ─── Conversation turn ────────────────────────────────────────────────────────

export interface ConversationTurn {
  role:     string;              // 'user' | 'avatar'
  text:     string;
  emotion?: EmotionLabel;
  ts:       number;
}

// ─── Store state + actions ────────────────────────────────────────────────────

export interface BrainState {
  // Emotional state
  emotionLabel:       EmotionLabel;
  pad:                PADVector;
  /** User / listener engagement PAD (VAD, future SER) — blended into `pad` in processFrame. */
  userPad:            PADVector | null;

  // LLM frame state
  lastFrame:          AgentFrame | null;
  currentAction:      BehaviorOutput | null;

  // Physical / UI state
  talking:            boolean;
  thinking:           boolean;
  /** True while a `transcript` frame is being processed (user's speech detected) */
  isUserSpeaking:     boolean;
  physical:           { isListening: boolean };

  /** AgentDirector-driven mode for head/gaze/blink (VRMA body unchanged). */
  interactionIntent: InteractionIntent;

  // ── Awareness / Teacher consciousness layer ──────────────────────────────
  currentTeachingGoal:      string | null;
  latestInternalMonologue:  string | null;
  latestAwarenessCues:      AgentFrame['awareness_cues'] | null;

  // ── Intuition layer (IntuitionEngine) ────────────────────────────────────
  /** نمط تعلم الطالب المُكتشَف */
  studentPattern:           string | null;
  /** نقطة الضعف الخفية */
  hiddenWeakness:           string | null;
  /** الحاجة الحقيقية للطالب */
  studentRealNeed:          string | null;
  /** درجة ثقة الفهم (0–1) */
  comprehensionConfidence:  number;
  /** علامات الضغط المكتشفة */
  stressSignals:            string[];

  /** Subtle user→avatar mirroring (transcript + pace), not mimic */
  userMirrorEmotion:        UserMirrorEmotion;
  userSpeechRhythm:         UserSpeechRhythm;

  // ── Persuasion layer ─────────────────────────────────────────────────────
  /** آخر توجيه إقناعي */
  lastPersuasionMode:       string | null;

  // ── Temporal awareness layer ──────────────────────────────────────────────
  /** مرحلة الجلسة الحالية */
  sessionPhase:             string;
  /** مستوى الطاقة المُقدَّر */
  estimatedEnergyLevel:     number;
  /** أيام حتى الامتحان */
  daysToExam:               number | null;

  // ── Post-session reflection ───────────────────────────────────────────────
  /** ملخص التأمل بعد الجلسة */
  lastSessionReflection:    string | null;

  // Memory
  conversationHistory: ConversationTurn[];
  emotionalMemory:    EmotionalMemoryEntry[];
  longTermMemory:     LongTermMemory;

  // ── Actions ────────────────────────────────────────────────────────────────
  setTalking:       (v: boolean) => void;
  setThinking:      (v: boolean) => void;
  setUserSpeaking:  (v: boolean) => void;
  /** Explicitly set currentAction (used by AgentDirector._reactToPAD after decideBehaviorFromPAD) */
  setCurrentAction: (action: BehaviorOutput | null) => void;
  setPhysical: (v: Partial<{ isListening: boolean }>) => void;
  setInteractionIntent: (intent: InteractionIntent) => void;
  /** Update teacher's current goal from Thinker goal_update */
  setTeachingGoal:  (goal: string | null) => void;
  setAwarenessCues: (cues: AgentFrame['awareness_cues'] | null, monologue?: string | null) => void;
  /** Update intuition reading from IntuitionEngine */
  setIntuitionReading: (reading: {
    studentPattern?: string;
    hiddenWeakness?: string | null;
    studentRealNeed?: string | null;
    comprehensionConfidence?: number;
    stressSignals?: string[];
  }) => void;
  /** Update temporal awareness */
  setTemporalContext: (ctx: {
    sessionPhase?: string;
    estimatedEnergyLevel?: number;
    daysToExam?: number | null;
  }) => void;
  /** Update persuasion mode */
  setPersuasionMode: (mode: string) => void;
  /** Store post-session reflection */
  setSessionReflection: (reflection: string) => void;
  setUserPad:  (pad: PADVector | null) => void;
  setUserMirrorState: (v: Partial<Pick<BrainState, 'userMirrorEmotion' | 'userSpeechRhythm'>>) => void;

  /** Push a conversation turn (user or avatar). */
  pushTurn: (turn: { role: string; text: string; emotion?: EmotionLabel }) => void;

  /**
   * Process an incoming AgentFrame:
   *   • Maps frame.emotion → EmotionLabel → PAD vector
   *   • Sets lastFrame (triggers AgentDirector sub 4)
   *   • Sets emotionLabel (triggers AgentDirector sub 1)
   *   • Sets pad (triggers AgentDirector sub 2)
   *   • Derives and sets currentAction (triggers AgentDirector sub 3)
   *   • Clears thinking flag
   */
  processFrame: (frame: AgentFrame) => void;

  /** Record an emotional moment into the rolling emotional memory. */
  recordEmotionalMoment: (userMood: EmotionLabel, topic?: string) => void;

  /** Add a significant moment to long-term memory. */
  addImportantMoment: (description: string) => void;

  /** Add a keyword to the user's interest profile (deduplicated). */
  learnInterest: (keyword: string) => void;

  /** Interrupt any in-progress performance (clears talking/thinking). */
  interrupt: () => void;

  /** Reset all state to initial values. */
  reset: () => void;

  /**
   * V20 — apply emotion/PAD immediately from a normalized WS frame (before processFrame).
   * Keeps embodiment in sync when the same tick also runs full processFrame after.
   */
  applyStreamingEmbodiment: (emotionLabel: EmotionLabel, padOverride?: PADVector) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PAD: PADVector = { pleasure: 0, arousal: 0, dominance: 0 };

/** Map raw emotion string (from backend) to canonical EmotionLabel. */
const EMOTION_TO_LABEL: Record<string, EmotionLabel> = {
  neutral:          'neutral',
  friendly:         'calm',
  thinking:         'thinking',
  encouraging:      'encouraging',
  celebrate:        'excited',
  celebration:      'excited',
  happy:            'happy',
  excited:          'excited',
  sad:              'sad',
  angry:            'angry',
  surprised:        'surprised',
  relax:            'relaxed',
  relaxed:          'relaxed',
  calm:             'calm',
  strict:           'attentive',
  strictEvaluation: 'attentive',
  proud:            'proud',
  curious:          'curious',
  attentive:        'attentive',
  concerned:        'concerned',
  sleepy:           'sleepy',
  bored:            'bored',
  anxious:          'anxious',
  // Previously missing — caused empathy emotion to map to 'neutral' silently
  empathetic:       'empathetic',
  empathy:          'empathetic',
  // Teaching-specific emotions from backend
  motivating:       'encouraging',
  motivated:        'encouraging',
  supportive:       'encouraging',
  confused:         'thinking',
  confused_student: 'concerned',
  proud_student:    'proud',
  celebrating:      'excited',
  warm:             'calm',
  playful:          'happy',
  inquisitive:      'curious',
};

/** Map EmotionLabel to approximate PAD coordinates. */
const EMOTION_TO_PAD: Record<EmotionLabel, PADVector> = {
  neutral:     { pleasure:  0.00, arousal:  0.00, dominance:  0.00 },
  calm:        { pleasure:  0.30, arousal: -0.20, dominance:  0.10 },
  thinking:    { pleasure:  0.10, arousal:  0.20, dominance:  0.10 },
  encouraging: { pleasure:  0.55, arousal:  0.40, dominance:  0.30 },
  excited:     { pleasure:  0.80, arousal:  0.80, dominance:  0.40 },
  happy:       { pleasure:  0.70, arousal:  0.30, dominance:  0.20 },
  sad:         { pleasure: -0.60, arousal: -0.30, dominance: -0.30 },
  angry:       { pleasure: -0.70, arousal:  0.80, dominance:  0.60 },
  surprised:   { pleasure:  0.10, arousal:  0.70, dominance: -0.10 },
  relaxed:     { pleasure:  0.40, arousal: -0.40, dominance:  0.10 },
  attentive:   { pleasure:  0.20, arousal:  0.30, dominance:  0.30 },
  proud:       { pleasure:  0.65, arousal:  0.40, dominance:  0.60 },
  curious:     { pleasure:  0.30, arousal:  0.50, dominance:  0.10 },
  concerned:   { pleasure: -0.20, arousal:  0.30, dominance:  0.10 },
  sleepy:      { pleasure:  0.10, arousal: -0.70, dominance: -0.20 },
  bored:       { pleasure: -0.20, arousal: -0.50, dominance: -0.10 },
  anxious:     { pleasure: -0.40, arousal:  0.60, dominance: -0.30 },
  empathetic:  { pleasure:  0.35, arousal:  0.20, dominance:  0.20 },
};

/** Normalised PAD magnitude (0–1). */
function padIntensity(pad: PADVector): number {
  const mag = Math.sqrt(pad.pleasure ** 2 + pad.arousal ** 2 + pad.dominance ** 2);
  return Math.min(1, mag / Math.sqrt(3)); // √3 is max possible magnitude
}

const MAX_HISTORY      = 20;
const MAX_EMOTION_MEM  = 50;

function blendPad(a: PADVector, b: PADVector, wB: number): PADVector {
  const wA = 1 - wB;
  return {
    pleasure:  a.pleasure * wA + b.pleasure * wB,
    arousal:   a.arousal * wA + b.arousal * wB,
    dominance: a.dominance * wA + b.dominance * wB,
  };
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL: Omit<BrainState,
  | 'setTalking' | 'setThinking' | 'setUserSpeaking' | 'setCurrentAction'
  | 'setPhysical' | 'setInteractionIntent' | 'setUserPad' | 'setUserMirrorState' | 'setTeachingGoal' | 'setAwarenessCues'
  | 'setIntuitionReading' | 'setTemporalContext' | 'setPersuasionMode' | 'setSessionReflection'
  | 'pushTurn' | 'processFrame' | 'interrupt' | 'reset' | 'applyStreamingEmbodiment'
  | 'recordEmotionalMoment' | 'addImportantMoment' | 'learnInterest'
> = {
  emotionLabel:             'neutral',
  pad:                      { ...DEFAULT_PAD },
  userPad:                  null,
  lastFrame:                null,
  currentAction:            null,
  talking:                  false,
  thinking:                 false,
  isUserSpeaking:           false,
  physical:                 { isListening: false },
  interactionIntent:        'idle',
  currentTeachingGoal:      null,
  latestInternalMonologue:  null,
  latestAwarenessCues:      null,
  // Intuition
  studentPattern:           null,
  hiddenWeakness:           null,
  studentRealNeed:          null,
  comprehensionConfidence:  0.5,
  stressSignals:            [],
  userMirrorEmotion:        'calm',
  userSpeechRhythm:         'neutral',
  // Persuasion
  lastPersuasionMode:       null,
  // Temporal
  sessionPhase:             'warmup',
  estimatedEnergyLevel:     0.7,
  daysToExam:               null,
  // Reflection
  lastSessionReflection:    null,
  conversationHistory:      [],
  emotionalMemory:          [],
  longTermMemory:           { userInterests: [], importantMoments: [] },
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useBrainStore = create<BrainState>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL,

    setTalking:      (v) => set({ talking: v }),
    setThinking:     (v) => set({ thinking: v }),
    setUserSpeaking: (v) => set({ isUserSpeaking: v }),
    setCurrentAction:(a) => set({ currentAction: a }),
    setTeachingGoal: (g) => set({ currentTeachingGoal: g }),
    setAwarenessCues: (cues, monologue) => set({
      latestAwarenessCues: cues ?? null,
      ...(monologue !== undefined ? { latestInternalMonologue: monologue ?? null } : {}),
    }),
    setIntuitionReading: (r) => set({
      ...(r.studentPattern       !== undefined ? { studentPattern: r.studentPattern ?? null }           : {}),
      ...(r.hiddenWeakness       !== undefined ? { hiddenWeakness: r.hiddenWeakness ?? null }           : {}),
      ...(r.studentRealNeed      !== undefined ? { studentRealNeed: r.studentRealNeed ?? null }         : {}),
      ...(r.comprehensionConfidence !== undefined ? { comprehensionConfidence: r.comprehensionConfidence } : {}),
      ...(r.stressSignals        !== undefined ? { stressSignals: r.stressSignals }                     : {}),
    }),
    setTemporalContext: (ctx) => set({
      ...(ctx.sessionPhase          !== undefined ? { sessionPhase: ctx.sessionPhase }                 : {}),
      ...(ctx.estimatedEnergyLevel  !== undefined ? { estimatedEnergyLevel: ctx.estimatedEnergyLevel } : {}),
      ...(ctx.daysToExam            !== undefined ? { daysToExam: ctx.daysToExam }                     : {}),
    }),
    setPersuasionMode: (mode) => set({ lastPersuasionMode: mode }),
    setSessionReflection: (r) => set({ lastSessionReflection: r }),

    setPhysical: (v) => set(s => ({
      physical: { ...s.physical, ...v },
    })),

    setInteractionIntent: (intent) => set({ interactionIntent: intent }),

    setUserPad: (pad) => set({ userPad: pad }),

    setUserMirrorState: (v) => set(s => ({
      ...(v.userMirrorEmotion !== undefined ? { userMirrorEmotion: v.userMirrorEmotion } : {}),
      ...(v.userSpeechRhythm !== undefined ? { userSpeechRhythm: v.userSpeechRhythm } : {}),
    })),

    pushTurn: (turn) => set(s => {
      const entry: ConversationTurn = { ...turn, ts: Date.now() };
      const history = [...s.conversationHistory, entry];
      return {
        conversationHistory: history.length > MAX_HISTORY
          ? history.slice(-MAX_HISTORY)
          : history,
      };
    }),

    applyStreamingEmbodiment: (emotionLabel, padOverride) => {
      const pad = padOverride ?? EMOTION_TO_PAD[emotionLabel] ?? DEFAULT_PAD;
      set({ emotionLabel, pad: { ...pad } });
    },

    processFrame: (frame) => {
      const emotionLabel: EmotionLabel =
        EMOTION_TO_LABEL[frame.emotion as string] ?? 'neutral';
      let pad = EMOTION_TO_PAD[emotionLabel] ?? DEFAULT_PAD;
      const { userPad } = get();
      if (frame.user_pad) {
        pad = blendPad(pad, frame.user_pad, 0.38);
      } else if (userPad) {
        pad = blendPad(pad, userPad, 0.35);
      }

      const hasCognitive =
        frame.cognitive_intent !== undefined
        || frame.cognitive_intensity !== undefined
        || frame.cognitive_tone !== undefined;
      if (hasCognitive) {
        setCognitiveOrchestratorLLMOutput({
          intent: frame.cognitive_intent,
          intensity: frame.cognitive_intensity,
          tone: frame.cognitive_tone,
        });
      }

      // NOTE: currentAction is intentionally NOT derived here.
      // AgentDirector sub-3 (currentAction) would double-fire with sub-4 (lastFrame).
      // Set currentAction explicitly via external calls only (e.g. decideBehaviorFromPAD).
      set({
        lastFrame:     frame,
        emotionLabel,
        pad,
        thinking:      false,
      });
    },

    recordEmotionalMoment: (userMood, topic) => {
      const { pad, emotionalMemory } = get();
      const entry: EmotionalMemoryEntry = {
        avatarPAD: { ...pad },
        userMood,
        intensity: padIntensity(pad),
        topic,
        ts: Date.now(),
      };
      const updated = [...emotionalMemory, entry];
      set({
        emotionalMemory: updated.length > MAX_EMOTION_MEM
          ? updated.slice(-MAX_EMOTION_MEM)
          : updated,
      });
    },

    addImportantMoment: (description) => set(s => ({
      longTermMemory: {
        ...s.longTermMemory,
        importantMoments: [
          ...s.longTermMemory.importantMoments,
          { description, ts: Date.now() },
        ],
      },
    })),

    learnInterest: (keyword) => set(s => {
      if (!keyword?.trim()) return s;
      if (s.longTermMemory.userInterests.includes(keyword)) return s;
      return {
        longTermMemory: {
          ...s.longTermMemory,
          userInterests: [...s.longTermMemory.userInterests, keyword],
        },
      };
    }),

    interrupt: () => {
      setCognitiveOrchestratorLLMOutput(null);
      set({
        talking: false,
        thinking: false,
        isUserSpeaking: false,
        currentAction: null,
        latestAwarenessCues: null,
        interactionIntent: 'idle',
        userMirrorEmotion: 'calm',
        userSpeechRhythm: 'neutral',
      });
    },

    reset: () => {
      setCognitiveOrchestratorLLMOutput(null);
      set({
        ...INITIAL,
        pad:                    { ...DEFAULT_PAD },
        userPad:                null,
        physical:               { isListening: false },
        interactionIntent:      'idle',
        conversationHistory:    [],
        emotionalMemory:        [],
        longTermMemory:         { userInterests: [], importantMoments: [] },
        isUserSpeaking:         false,
        currentTeachingGoal:    null,
        latestInternalMonologue: null,
        latestAwarenessCues:    null,
        userMirrorEmotion:      'calm',
        userSpeechRhythm:       'neutral',
      });
    },
  })),
);

export default useBrainStore;
