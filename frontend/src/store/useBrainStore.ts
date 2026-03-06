'use client';

/**
 * store/useBrainStore.ts — Zustand Digital Human Brain Store
 *
 * Central state machine for the avatar AI system.
 * Manages: PAD emotion, Big Five personality, three memory layers,
 *          physical pose state, behavior output, and lifecycle flags.
 *
 * Persisted keys (localStorage: 'nexus-brain'):
 *   personality · longTermMemory · emotionalMemory (last 20) · shortTermMemory (last 5)
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

import type {
  PADVector,
  BigFiveTraits,
  ConversationTurn,
  EmotionalMemoryEntry,
  AvatarPhysicalState,
  BehaviorOutput,
  AgentFrame,
  DigitalHumanState,
  EmotionLabel,
  PersonalityModifiers,
} from '@/types/ai';

// ─── PAD → EmotionLabel mapping ──────────────────────────────────────────────
// Regions in PAD space map to discrete emotional labels.
// Priority: check high-signal states first, fall back to neutral.

function padToEmotionLabel(pad: PADVector): EmotionLabel {
  const { pleasure: p, arousal: a, dominance: d } = pad;

  if (p >= 0.55 && a >= 0.45)                return 'excited';
  if (p >= 0.45 && a >= 0.05)                return 'happy';
  if (p >= 0.25 && a < -0.25)                return 'relaxed';
  if (p >= 0.10 && a < -0.45)                return 'sleepy';
  if (p >= -0.05 && a >= 0.55)               return d >= 0.0 ? 'surprised' : 'anxious';
  if (p >= 0.00 && a >= 0.20)                return 'curious';
  if (p >= -0.05 && a >= -0.10 && d >= 0.25) return 'attentive';
  if (p >= 0.30 && d >= 0.50)                return 'proud';
  if (p >= 0.05 && a < 0.05)                 return 'calm';
  if (p >= -0.15 && a < -0.05)               return 'bored';
  if (p < -0.25 && a >= 0.45)                return 'angry';
  if (p < -0.20 && a >= 0.00)                return 'concerned';
  if (p < -0.25 && a < -0.05)                return 'sad';
  return 'neutral';
}

// ─── Personality → Behaviour Modifiers ───────────────────────────────────────

function computePersonalityModifiers(t: BigFiveTraits): PersonalityModifiers {
  return {
    // Extraverts gesture more; introverts less
    gestureFrequencyMultiplier: 0.50 + t.extraversion * 1.50,
    // Extraverts speak faster
    speechRateMultiplier:       0.80 + t.extraversion * 0.40,
    // High neuroticism amplifies all reactions; conscientiousness dampens them
    reactionIntensity:          0.30 + t.neuroticism * 0.45 - t.conscientiousness * 0.15,
    // Agreeableness drives empathetic choices in behavior rules
    empathyWeight:              t.agreeableness,
    // Introverts are more expressively subtle
    expressionSubtlety:         1.00 - t.extraversion * 0.55,
  };
}

// ─── PAD utilities ────────────────────────────────────────────────────────────

function clampPAD(v: PADVector): PADVector {
  const c = (n: number) => Math.max(-1, Math.min(1, n));
  return { pleasure: c(v.pleasure), arousal: c(v.arousal), dominance: c(v.dominance) };
}

function lerpPAD(a: PADVector, b: PADVector, t: number): PADVector {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    pleasure:  lerp(a.pleasure,  b.pleasure),
    arousal:   lerp(a.arousal,   b.arousal),
    dominance: lerp(a.dominance, b.dominance),
  };
}

// ─── Persona defaults (Dr. Hamza — human-like teacher) ───────────────────────

const DR_HAMZA_PERSONALITY: BigFiveTraits = {
  openness:          0.80,  // intellectually curious, loves new ideas
  conscientiousness: 0.90,  // organised, methodical, reliable
  extraversion:      0.75,  // engaging, warm, present
  agreeableness:     0.85,  // empathetic, supportive, patient
  neuroticism:       0.20,  // emotionally stable
};

const BASELINE_PAD: PADVector = { pleasure: 0.30, arousal: 0.20, dominance: 0.55 };

const DEFAULT_PHYSICAL: AvatarPhysicalState = {
  headYaw:      0,
  headPitch:    0,
  spineForward: 0,
  breathPhase:  0,
  isNodding:    false,
  isTalking:    false,
  isListening:  false,
  blinkPhase:   0,
};

// ─── PAD deltas emitted by various LLM emotion tags ──────────────────────────
// Values are pre-scaled for Dr. Hamza's personality baseline.
// Brain store amplifies / dampens these via neuroticism + conscientiousness.

const PAD_DELTAS: Readonly<Record<string, Partial<PADVector>>> = {
  celebrate:   { pleasure:  0.40, arousal:  0.35, dominance:  0.20 },
  celebration: { pleasure:  0.40, arousal:  0.35, dominance:  0.20 },
  happy:       { pleasure:  0.30, arousal:  0.10 },
  excited:     { pleasure:  0.30, arousal:  0.40, dominance:  0.10 },
  encouraging: { pleasure:  0.20, arousal:  0.10, dominance:  0.10 },
  friendly:    { pleasure:  0.20, arousal:  0.05 },
  proud:       { pleasure:  0.25, arousal:  0.10, dominance:  0.25 },
  curious:     { pleasure:  0.10, arousal:  0.25, dominance:  0.00 },
  attentive:   { pleasure:  0.10, arousal:  0.10, dominance:  0.15 },
  thinking:    { pleasure: -0.05, arousal: -0.10, dominance: -0.05 },
  strict:      { pleasure: -0.10, arousal:  0.15, dominance:  0.30 },
  concerned:   { pleasure: -0.20, arousal:  0.10, dominance: -0.10 },
  surprised:   { pleasure:  0.00, arousal:  0.40, dominance: -0.20 },
  sad:         { pleasure: -0.30, arousal: -0.20, dominance: -0.20 },
  angry:       { pleasure: -0.30, arousal:  0.40, dominance:  0.20 },
  neutral:     { pleasure:  0.00, arousal:  0.00, dominance:  0.00 },
};

// ─── Store interface ──────────────────────────────────────────────────────────

export interface BrainStore extends DigitalHumanState {
  // PAD mutations
  /** Apply a partial delta (clamped); recomputes emotionLabel automatically */
  updatePAD: (delta: Partial<PADVector>) => void;
  /** Overwrite PAD entirely */
  setPAD: (next: PADVector) => void;
  /** Decay PAD toward the persona's baseline — call from useFrame or a setInterval */
  tickPADDecay: (rate?: number) => void;

  // Memory
  /** Add a conversation turn to short-term memory (ring-buffer, max 10) */
  pushTurn: (turn: Omit<ConversationTurn, 'id' | 'timestamp'>) => void;
  /** Snapshot current PAD state as an emotional memory entry */
  recordEmotionalMoment: (userMood: EmotionLabel, topic?: string) => void;
  /** Register a topic mention; auto-promotes to interest after 3 mentions */
  learnInterest: (topic: string) => void;
  /** Manually flag a moment as important (stored in long-term memory) */
  addImportantMoment: (description: string) => void;

  // Physical
  setPhysical: (partial: Partial<AvatarPhysicalState>) => void;
  /** Advance the breathing oscillator — call from useFrame with delta seconds */
  tickBreath: (delta: number) => void;

  // Behavior
  setCurrentAction: (action: BehaviorOutput) => void;
  clearAction: () => void;

  // LLM frame ingestion
  /**
   * Main update entry point — called whenever a new AgentFrame arrives.
   * Updates PAD (scaled by personality), stores lastFrame, clears isThinking.
   */
  processFrame: (frame: AgentFrame) => void;

  // Lifecycle
  setTalking:  (v: boolean) => void;
  setThinking: (v: boolean) => void;
  /** Immediately stop speaking; set wasInterrupted flag */
  interrupt: () => void;
  /** Full reset to default initial state */
  reset: () => void;
}

// ─── Factory for a fresh initial state ───────────────────────────────────────

function buildInitialState(): DigitalHumanState {
  const personality = { ...DR_HAMZA_PERSONALITY };
  return {
    pad:             { ...BASELINE_PAD },
    emotionLabel:    'neutral',
    personality,
    personaModifiers: computePersonalityModifiers(personality),
    shortTermMemory:  { turns: [], maxTurns: 10 },
    emotionalMemory:  [],
    longTermMemory:   { userInterests: [], frequentTopics: {}, importantMoments: [] },
    physical:        { ...DEFAULT_PHYSICAL },
    currentAction:   null,
    lastFrame:       null,
    isSpeaking:      false,
    isThinking:      false,
    wasInterrupted:  false,
  };
}

// ─── Zustand Store ────────────────────────────────────────────────────────────

export const useBrainStore = create<BrainStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...buildInitialState(),

        // ── PAD ──────────────────────────────────────────────────────────────

        updatePAD: (delta) => {
          set((s) => {
            const next = clampPAD({
              pleasure:  s.pad.pleasure  + (delta.pleasure  ?? 0),
              arousal:   s.pad.arousal   + (delta.arousal   ?? 0),
              dominance: s.pad.dominance + (delta.dominance ?? 0),
            });
            return { pad: next, emotionLabel: padToEmotionLabel(next) };
          });
        },

        setPAD: (next) => {
          const clamped = clampPAD(next);
          set({ pad: clamped, emotionLabel: padToEmotionLabel(clamped) });
        },

        tickPADDecay: (rate = 0.018) => {
          set((s) => {
            const decayed = clampPAD(lerpPAD(s.pad, BASELINE_PAD, rate));
            return { pad: decayed, emotionLabel: padToEmotionLabel(decayed) };
          });
        },

        // ── Memory ───────────────────────────────────────────────────────────

        pushTurn: (turn) => {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const full: ConversationTurn = {
            ...turn,
            id,
            timestamp:   Date.now(),
            padSnapshot: { ...get().pad },
          };
          set((s) => {
            const turns = [
              ...s.shortTermMemory.turns,
              full,
            ].slice(-s.shortTermMemory.maxTurns);
            return { shortTermMemory: { ...s.shortTermMemory, turns } };
          });
        },

        recordEmotionalMoment: (userMood, topic) => {
          const { pad } = get();
          const magnitude = Math.sqrt(
            pad.pleasure ** 2 + pad.arousal ** 2 + pad.dominance ** 2
          );
          const entry: EmotionalMemoryEntry = {
            timestamp: Date.now(),
            userMood,
            avatarPAD: { ...pad },
            topic,
            intensity: Math.min(1, magnitude / Math.sqrt(3)),
          };
          set((s) => ({
            emotionalMemory: [...s.emotionalMemory.slice(-49), entry],
          }));
        },

        learnInterest: (topic) => {
          set((s) => {
            const freq = { ...s.longTermMemory.frequentTopics };
            freq[topic] = (freq[topic] ?? 0) + 1;
            const alreadyKnown = s.longTermMemory.userInterests.includes(topic);
            const interests =
              freq[topic] >= 3 && !alreadyKnown
                ? [...s.longTermMemory.userInterests, topic]
                : s.longTermMemory.userInterests;
            return {
              longTermMemory: {
                ...s.longTermMemory,
                frequentTopics: freq,
                userInterests:  interests,
              },
            };
          });
        },

        addImportantMoment: (description) => {
          set((s) => ({
            longTermMemory: {
              ...s.longTermMemory,
              importantMoments: [
                ...s.longTermMemory.importantMoments,
                { description, timestamp: Date.now(), emotion: s.emotionLabel },
              ],
            },
          }));
        },

        // ── Physical ─────────────────────────────────────────────────────────

        setPhysical: (partial) => {
          set((s) => ({ physical: { ...s.physical, ...partial } }));
        },

        tickBreath: (delta) => {
          set((s) => {
            const breathPhase = (s.physical.breathPhase + delta * 0.28) % (2 * Math.PI);
            return { physical: { ...s.physical, breathPhase } };
          });
        },

        // ── Behavior ─────────────────────────────────────────────────────────

        setCurrentAction: (action) => set({ currentAction: action }),
        clearAction:       ()       => set({ currentAction: null }),

        // ── LLM Frame ────────────────────────────────────────────────────────

        processFrame: (frame) => {
          const { personality } = get();

          // Personality amplifier:
          //   high neuroticism  → stronger emotional swings
          //   high conscientiousness → self-regulation dampens swings
          const amplifier = 1.0
            + personality.neuroticism       * 0.50
            - personality.conscientiousness * 0.20;

          const rawDelta = PAD_DELTAS[frame.emotion] ?? {};
          const scaledDelta: Partial<PADVector> = {
            pleasure:  (rawDelta.pleasure  ?? 0) * amplifier,
            arousal:   (rawDelta.arousal   ?? 0) * amplifier,
            dominance: (rawDelta.dominance ?? 0) * amplifier,
          };

          // Apply PAD update then store frame + clear thinking flag
          const currentPAD = get().pad;
          const next = clampPAD({
            pleasure:  currentPAD.pleasure  + (scaledDelta.pleasure  ?? 0),
            arousal:   currentPAD.arousal   + (scaledDelta.arousal   ?? 0),
            dominance: currentPAD.dominance + (scaledDelta.dominance ?? 0),
          });

          set({
            pad:          next,
            emotionLabel: padToEmotionLabel(next),
            lastFrame:    frame,
            isThinking:   false,
          });
        },

        // ── Lifecycle ─────────────────────────────────────────────────────────

        setTalking: (v) => {
          set((s) => ({
            isSpeaking: v,
            physical:   { ...s.physical, isTalking: v },
          }));
        },

        setThinking: (v) => set({ isThinking: v }),

        interrupt: () => {
          set((s) => ({
            wasInterrupted: true,
            isSpeaking:     false,
            physical:       { ...s.physical, isTalking: false },
          }));
        },

        reset: () => set(buildInitialState()),
      }),

      {
        name: 'nexus-brain',
        // Only persist stable / valuable data — not ephemeral runtime state
        partialize: (s) => ({
          personality:     s.personality,
          longTermMemory:  s.longTermMemory,
          // Keep last 20 emotional moments
          emotionalMemory: s.emotionalMemory.slice(-20),
          // Keep last 5 turns for session continuity
          shortTermMemory: {
            turns:    s.shortTermMemory.turns.slice(-5),
            maxTurns: s.shortTermMemory.maxTurns,
          },
        }),
      }
    )
  )
);

// ─── Derived selectors (use in components for targeted re-renders) ────────────

export const selectPAD         = (s: BrainStore) => s.pad;
export const selectEmotion     = (s: BrainStore) => s.emotionLabel;
export const selectPersonality = (s: BrainStore) => s.personality;
export const selectModifiers   = (s: BrainStore) => s.personaModifiers;
export const selectSTM         = (s: BrainStore) => s.shortTermMemory;
export const selectLTM         = (s: BrainStore) => s.longTermMemory;
export const selectPhysical    = (s: BrainStore) => s.physical;
export const selectLastFrame   = (s: BrainStore) => s.lastFrame;
export const selectIsLive      = (s: BrainStore) => s.isSpeaking || s.isThinking;
export const selectWasInterrupted = (s: BrainStore) => s.wasInterrupted;
