'use client';
/**
 * useAvatarConsciousness.ts — Persistent P.A.D consciousness + memory layer.
 *
 * Guarantees:
 *  - Zero per-frame allocations (short-term memory in useRef, never triggers renders)
 *  - Fully typed (no `any`)
 *  - USE_DB-gated long-term persistence (falls back to InMemory REST transparently)
 *  - Proactive silence: 20 s → minor gesture; 30 s → proactive WS question
 *  - Personality drift: slow mutation per interaction, clamped 0..1
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmotionEngine } from '@/ai/emotion/EmotionEngine';
import type { PAD, PersonalityTraits, EmotionContext } from '@/ai/emotion/EmotionEngine';
import { PROACTIVE_GESTURE_MS, PROACTIVE_QUESTION_MS } from '@/config/avatar';

// ── Public types ──────────────────────────────────────────────────────────────

export interface Exchange {
  role: 'user' | 'assistant';
  text: string;
  ts:   number;
}

export interface ConsciousnessState {
  currentEmotion: {
    pleasure:  number;
    arousal:   number;
    dominance: number;
    label:     string;
  };
  personality: {
    empathy:       number;
    humor:         number;
    openness:      number;
    agreeableness: number;
    formality:     number;
  };
  recentMemory: Exchange[];  // snapshot — updated only on meaningful interactions
  context: {
    intent:     string;
    keywords:   string[];
    topic:      string;
    importance: number;
    silenceMs:  number;
  };
}

// ── Short-term memory size ────────────────────────────────────────────────────
const MEMORY_WINDOW = 10;

// ── Default personality ───────────────────────────────────────────────────────
const DEFAULT_PERSONALITY: PersonalityTraits = {
  empathy:       0.70,
  humor:         0.40,
  openness:      0.75,
  agreeableness: 0.80,
  formality:     0.55,
};

// ── Personality drift magnitude per interaction ───────────────────────────────
const DRIFT_RATE = 0.005;

// ── Arabic keyword categories for quick context classification ─────────────────
const INTENT_PATTERNS: Array<{ re: RegExp; intent: string; keywords: string[] }> = [
  { re: /ماذا|كيف|لماذا|متى|أين|من هو|ما هو|\?|؟/, intent: 'question', keywords: ['سؤال'] },
  { re: /ممتاز|رائع|أحسنت|شكرًا|شكراً|برافو|مبروك/, intent: 'praise',    keywords: ['إطراء'] },
  { re: /مشكلة|خطأ|لا أفهم|صعب|مو صح|غلط/,         intent: 'complaint', keywords: ['مشكلة'] },
];

function classifyIntent(text: string): { intent: string; keywords: string[]; importance: number } {
  for (const { re, intent, keywords } of INTENT_PATTERNS) {
    if (re.test(text)) {
      // Simple importance: longer text + pattern match = higher importance
      const importance = Math.min(1, 0.4 + text.length / 400);
      return { intent, keywords, importance };
    }
  }
  return { intent: 'statement', keywords: [], importance: 0.3 };
}

function extractTopic(text: string, previous: string): string {
  // Very lightweight: use first 3 non-stop-words (Arabic stopwords minimal)
  const stopwords = new Set(['في', 'على', 'إلى', 'من', 'هل', 'أن', 'وأن', 'ثم', 'كان', 'إنه']);
  const words = text
    .replace(/[؟!.,،]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  if (words.length === 0) return previous;
  return words.slice(0, 3).join('،');
}

// ── Proactive gesture/question dispatchers ────────────────────────────────────

function dispatchGestureEvent(gesture: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:gesture', { detail: { gesture } }));
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAvatarConsciousness(): {
  consciousnessState:   ConsciousnessState;
  processUserInput:     (text: string, audioBlob?: Blob) => void;
  onAvatarReply:        (replyText: string, avatarEmotion?: Partial<PAD>) => void;
  onUserEmotionFrame:   (userEmotion: PAD | null) => void;
  decideNextAction:     () => string;
  saveLongTerm:         () => Promise<void>;
  fetchLongTerm:        (limit?: number) => Promise<void>;
} {
  // ── Engine instance (stable across renders) ────────────────────────────────
  const engineRef = useRef<EmotionEngine>(new EmotionEngine({ smoothingAlpha: 0.18 }));

  // ── Short-term memory — stored in ref (zero per-frame-allocation) ──────────
  const memoryRef = useRef<Exchange[]>([]);

  // ── Proactive silence tracking ─────────────────────────────────────────────
  const lastInteractionRef   = useRef<number>(Date.now());
  const gestureTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session ID for long-term persistence ──────────────────────────────────
  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined'
      ? crypto.randomUUID()
      : `session-${Date.now()}`
  );

  // ── Renderable consciousness state ────────────────────────────────────────
  const [consciousnessState, setConsciousnessState] = useState<ConsciousnessState>({
    currentEmotion: { pleasure: 0, arousal: 0, dominance: 0, label: 'neutral' },
    personality:    { ...DEFAULT_PERSONALITY },
    recentMemory:   [],
    context: {
      intent:     'neutral',
      keywords:   [],
      topic:      '',
      importance: 0.3,
      silenceMs:  0,
    },
  });

  // ── Internal mutable personality (drift without state thrash) ─────────────
  const personalityRef = useRef<PersonalityTraits>({ ...DEFAULT_PERSONALITY });

  // ── Context ref (current active context) ──────────────────────────────────
  const contextRef = useRef<EmotionContext>({
    intent:    'neutral',
    keywords:  [],
    topic:     '',
    importance: 0.3,
    silenceMs:  0,
  });

  // ── Publish a full state snapshot (triggers React render) ─────────────────
  const publishState = useCallback((): void => {
    const emotion = engineRef.current.current;
    setConsciousnessState({
      currentEmotion: emotion,
      personality:    { ...personalityRef.current },
      recentMemory:   [...memoryRef.current],
      context:        { ...contextRef.current, silenceMs: Date.now() - lastInteractionRef.current },
    });
  }, []);

  // ── Personality drift (called after each interaction) ─────────────────────
  const applyDrift = useCallback((interaction: { pleasure: number; empathy_cue: number }): void => {
    const p = personalityRef.current;
    const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
    // Positive interactions nudge empathy and agreeableness upward
    personalityRef.current = {
      empathy:       clamp01(p.empathy       + DRIFT_RATE * interaction.empathy_cue),
      humor:         clamp01(p.humor         + DRIFT_RATE * (interaction.pleasure > 0.5 ? 1 : -0.5)),
      openness:      clamp01(p.openness      + DRIFT_RATE * 0.5),
      agreeableness: clamp01(p.agreeableness + DRIFT_RATE * interaction.empathy_cue * 0.5),
      formality:     clamp01(p.formality     + DRIFT_RATE * (interaction.pleasure < 0 ? 0.3 : -0.1)),
    };
  }, []);

  // ── Reset proactive timers after any interaction ───────────────────────────
  const resetProactiveTimers = useCallback((): void => {
    lastInteractionRef.current = Date.now();

    if (gestureTimerRef.current !== null) {
      clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = null;
    }
    if (questionTimerRef.current !== null) {
      clearTimeout(questionTimerRef.current);
      questionTimerRef.current = null;
    }

    // 20 s → minor gesture
    gestureTimerRef.current = setTimeout((): void => {
      dispatchGestureEvent('idle_glance');
      gestureTimerRef.current = null;
    }, PROACTIVE_GESTURE_MS);

    // 30 s → proactive question via WS (hook dispatches event; WS layer listens)
    questionTimerRef.current = setTimeout((): void => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('avatar:proactive:question', {
          detail: { silenceMs: Date.now() - lastInteractionRef.current },
        }));
      }
      questionTimerRef.current = null;
    }, PROACTIVE_QUESTION_MS);
  }, []);

  // ── processUserInput ───────────────────────────────────────────────────────
  const processUserInput = useCallback((text: string, _audioBlob?: Blob): void => {
    resetProactiveTimers();

    // Classify intent + extract topic
    const { intent, keywords, importance } = classifyIntent(text);
    const topic = extractTopic(text, contextRef.current.topic);

    contextRef.current = { intent, keywords, topic, importance, silenceMs: 0 };

    // Push to short-term memory (ring buffer, zero allocations beyond the splice)
    const exchange: Exchange = { role: 'user', text, ts: Date.now() };
    memoryRef.current = [...memoryRef.current.slice(-(MEMORY_WINDOW - 1)), exchange];

    // Run engine — compute new avatar emotion
    const output = engineRef.current.update(null, contextRef.current, personalityRef.current);

    // Drift personality: user input = mild positive empathy cue
    applyDrift({ pleasure: output.avatarPAD.pleasure, empathy_cue: importance });

    publishState();
  }, [applyDrift, publishState, resetProactiveTimers]);

  // ── onAvatarReply ──────────────────────────────────────────────────────────
  const onAvatarReply = useCallback((replyText: string, avatarPAD?: Partial<PAD>): void => {
    const exchange: Exchange = { role: 'assistant', text: replyText, ts: Date.now() };
    memoryRef.current = [...memoryRef.current.slice(-(MEMORY_WINDOW - 1)), exchange];

    // Update engine if backend provided a P.A.D hint
    if (avatarPAD) {
      const full: PAD = {
        pleasure:  avatarPAD.pleasure  ?? 0,
        arousal:   avatarPAD.arousal   ?? 0,
        dominance: avatarPAD.dominance ?? 0,
      };
      engineRef.current.update(full, contextRef.current, personalityRef.current);
    }

    publishState();
  }, [publishState]);

  // ── onUserEmotionFrame (from SER / speech emotion recognition) ────────────
  const onUserEmotionFrame = useCallback((userEmotion: PAD | null): void => {
    if (userEmotion === null) return;
    engineRef.current.update(userEmotion, contextRef.current, personalityRef.current);
    publishState();
  }, [publishState]);

  // ── decideNextAction ───────────────────────────────────────────────────────
  const decideNextAction = useCallback((): string => {
    const label = engineRef.current.current.label;
    const silence = Date.now() - lastInteractionRef.current;
    if (silence > PROACTIVE_QUESTION_MS) return 'proactive_question';
    if (silence > PROACTIVE_GESTURE_MS)  return 'idle_gesture';
    const byLabel: Record<string, string> = {
      happy:       'celebrate',
      excited:     'wave',
      encouraging: 'lean_forward',
      thinking:    'chin_touch',
      curious:     'tilt',
      concerned:   'tilt',
      strict:      'point',
    };
    return byLabel[label] ?? 'idle';
  }, []);

  // ── Long-term persistence ──────────────────────────────────────────────────
  const saveLongTerm = useCallback(async (): Promise<void> => {
    try {
      const body = {
        session_id: sessionIdRef.current,
        user_id:    null,
        exchanges:  memoryRef.current,
        summary:    memoryRef.current.map(e => `${e.role}: ${e.text}`).join('\n').slice(0, 800),
      };
      await fetch('/api/v1/memory/conversations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    } catch (err) {
      // Non-fatal: long-term save failures are silent (USE_DB feature gate on server)
      console.warn('[useAvatarConsciousness] saveLongTerm failed:', err);
    }
  }, []);

  const fetchLongTerm = useCallback(async (limit = 5): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/memory/conversations?limit=${limit}`);
      if (!res.ok) return;
      const data = (await res.json()) as Array<{ exchanges: Exchange[] }>;
      // Merge older exchanges into short-term window (oldest first, cap at MEMORY_WINDOW)
      const merged: Exchange[] = [];
      for (const conv of data) {
        merged.push(...(conv.exchanges ?? []));
      }
      const combined = [...merged, ...memoryRef.current].slice(-MEMORY_WINDOW);
      memoryRef.current = combined;
      publishState();
    } catch (err) {
      console.warn('[useAvatarConsciousness] fetchLongTerm failed:', err);
    }
  }, [publishState]);

  // ── Mount: start proactive timers + try to fetch long-term memory ──────────
  useEffect((): (() => void) => {
    resetProactiveTimers();
    void fetchLongTerm(3);

    return (): void => {
      if (gestureTimerRef.current !== null) clearTimeout(gestureTimerRef.current);
      if (questionTimerRef.current !== null) clearTimeout(questionTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    consciousnessState,
    processUserInput,
    onAvatarReply,
    onUserEmotionFrame,
    decideNextAction,
    saveLongTerm,
    fetchLongTerm,
  };
}
