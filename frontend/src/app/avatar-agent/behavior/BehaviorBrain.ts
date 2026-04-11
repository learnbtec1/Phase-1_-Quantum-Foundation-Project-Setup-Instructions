/**
 * Level 6 — Cognitive engine: events → {@link Intent} only.
 * No gestures, poses, quaternions, or motion APIs.
 */

import type { Intent, IntentEmotion, IntentSource } from './intentTypes';

function sourceFromContext(context?: 'conversation' | 'system'): IntentSource {
  if (context === 'system') return 'system';
  return 'text';
}

export type BehaviorBrainEvent =
  | { type: 'behavior_text'; text: string; context?: 'conversation' | 'system' }
  | { type: 'listening'; active: boolean; reason?: string }
  | { type: 'speech'; phase: 'user_start' | 'user_end' | 'agent_start' | 'agent_end' }
  | { type: 'tick'; deltaMs: number };

const BASE_INTENT: Intent = {
  type: 'idle',
  emotion: 'neutral',
  intensity: 0.35,
  confidence: 0.4,
  source: 'context',
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function inferFromText(text: string, context?: 'conversation' | 'system'): Intent {
  const raw = text.trim();
  const t = raw.toLowerCase();

  if (/^\[emotion:/i.test(raw)) {
    const inner = raw.replace(/^\[emotion:\s*/i, '').replace(/\]\s*$/i, '').toLowerCase();
    if (/think|confus|process/i.test(inner)) {
      return {
        type: 'thinking',
        emotion: 'curious',
        intensity: 0.52,
        confidence: 0.68,
        duration: 3500,
        source: 'system',
      };
    }
    if (/happy|excit|joy|proud|great/i.test(inner)) {
      return {
        type: 'reacting',
        emotion: 'happy',
        intensity: 0.62,
        confidence: 0.7,
        duration: 2000,
        source: 'system',
      };
    }
    if (/surpris|shock/i.test(inner)) {
      return {
        type: 'reacting',
        emotion: 'surprised',
        intensity: 0.58,
        confidence: 0.72,
        duration: 1800,
        source: 'system',
      };
    }
    return {
      type: 'idle',
      emotion: 'neutral',
      intensity: 0.4,
      confidence: 0.5,
      source: 'system',
    };
  }

  if (context === 'system' && /student affect|affect:/i.test(t)) {
    if (/calm|relaxed/i.test(t)) {
      return {
        type: 'listening',
        emotion: 'focused',
        intensity: 0.42,
        confidence: 0.55,
        source: 'system',
      };
    }
    if (/excited|happy|energy/i.test(t)) {
      return {
        type: 'reacting',
        emotion: 'happy',
        intensity: 0.62,
        confidence: 0.58,
        source: 'system',
      };
    }
  }

  if (/مرحب|أهلا|السلام|hello|\bhi\b|\bhey\b|good morning|good afternoon/i.test(t)) {
    return {
      type: 'greeting',
      emotion: 'happy',
      intensity: 0.72,
      confidence: 0.84,
      duration: 2200,
      source: sourceFromContext(context),
    };
  }

  if (/[؟?]/.test(raw) && /لماذا|كيف|ما |why|how|what|when|where|could you explain/i.test(t)) {
    return {
      type: 'thinking',
      emotion: 'curious',
      intensity: 0.58,
      confidence: 0.8,
      duration: 4000,
      source: sourceFromContext(context),
    };
  }

  if (/!|رائع|عظيم|great|awesome|wow|exactly|صحيح|ممتاز|perfect|nice work/i.test(t)) {
    return {
      type: 'reacting',
      emotion: 'happy',
      intensity: 0.68,
      confidence: 0.76,
      duration: 1800,
      source: sourceFromContext(context),
    };
  }

  if (/surprised|really\?|no way|غريب|ماذا/i.test(t)) {
    return {
      type: 'reacting',
      emotion: 'surprised',
      intensity: 0.62,
      confidence: 0.7,
      duration: 1600,
      source: sourceFromContext(context),
    };
  }

  if (/listen|your turn|ما رأيك|tell me|student|do you agree/i.test(t)) {
    return {
      type: 'listening',
      emotion: 'focused',
      intensity: 0.52,
      confidence: 0.74,
      duration: 5000,
      source: sourceFromContext(context),
    };
  }

  if (raw.length > 48 || /explain|because|therefore|thus|first|second|لذلك|أولاً|ثانياً/i.test(t)) {
    return {
      type: 'speaking',
      emotion: 'focused',
      intensity: 0.55,
      confidence: 0.52,
      duration: Math.min(12_000, 800 + raw.length * 45),
      source: sourceFromContext(context),
    };
  }

  if (raw.length > 12) {
    return {
      type: 'speaking',
      emotion: 'neutral',
      intensity: 0.48,
      confidence: 0.45,
      duration: Math.min(8000, 600 + raw.length * 40),
      source: sourceFromContext(context),
    };
  }

  return {
    type: 'idle',
    emotion: 'neutral',
    intensity: 0.32,
    confidence: 0.38,
    source: sourceFromContext(context),
  };
}

/**
 * Stateful reducer: ingest events → updated {@link Intent} (read via {@link getIntent}).
 */
export class BehaviorBrain {
  private intent: Intent = { ...BASE_INTENT };

  getIntent(): Intent {
    return { ...this.intent };
  }

  reset(): void {
    this.intent = { ...BASE_INTENT };
  }

  ingest(event: BehaviorBrainEvent): void {
    switch (event.type) {
      case 'behavior_text': {
        const next = inferFromText(event.text, event.context);
        this.intent = {
          ...next,
          intensity: clamp01(
            next.confidence * 0.55 + next.intensity * 0.45,
          ),
          source: sourceFromContext(event.context),
        };
        break;
      }
      case 'listening': {
        if (event.active) {
          this.intent = {
            type: 'listening',
            emotion: 'focused',
            intensity: clamp01(this.intent.intensity + 0.12),
            confidence: 0.82,
            duration: 6000,
            source: 'context',
          };
        } else {
          this.intent = {
            ...this.intent,
            type: this.intent.type === 'listening' ? 'idle' : this.intent.type,
            intensity: clamp01(this.intent.intensity - 0.06),
            source: 'context',
          };
        }
        break;
      }
      case 'speech': {
        if (event.phase === 'user_start') {
          this.intent = {
            type: 'listening',
            emotion: 'focused',
            intensity: clamp01(this.intent.intensity + 0.18),
            confidence: 0.88,
            source: 'context',
          };
        } else if (event.phase === 'user_end') {
          this.intent.intensity = clamp01(this.intent.intensity - 0.05);
          this.intent.source = 'context';
        } else if (event.phase === 'agent_start') {
          this.intent = {
            type: 'speaking',
            emotion: this.intent.emotion === 'focused' ? 'neutral' : this.intent.emotion,
            intensity: clamp01(Math.max(this.intent.intensity, 0.52)),
            confidence: 0.9,
            source: 'system',
          };
        } else if (event.phase === 'agent_end') {
          this.intent = {
            type: 'idle',
            emotion: decayEmotion(this.intent.emotion),
            intensity: clamp01(this.intent.intensity * 0.72),
            confidence: 0.55,
            source: 'system',
          };
        }
        break;
      }
      case 'tick': {
        const d = Math.max(0, event.deltaMs) / 1000;
        this.intent.intensity = clamp01(
          this.intent.intensity + (0.38 - this.intent.intensity) * 0.04 * d,
        );
        if (this.intent.type === 'idle' && this.intent.emotion !== 'neutral') {
          this.intent.emotion = decayEmotion(this.intent.emotion);
        }
        break;
      }
      default:
        break;
    }
  }
}

function decayEmotion(e: IntentEmotion): IntentEmotion {
  if (e === 'surprised' || e === 'happy') return 'neutral';
  if (e === 'curious') return 'neutral';
  if (e === 'focused') return 'neutral';
  return 'neutral';
}

/** @deprecated Level 5 — use {@link Intent} / {@link BehaviorBrain} only. */
export type BehaviorIntent = 'explain' | 'listen' | 'react' | 'idle';
/** @deprecated Level 5 */
export type BehaviorEmotion =
  | 'neutral'
  | 'happy'
  | 'thinking'
  | 'curious'
  | 'concerned'
  | 'empathetic';
/** @deprecated Level 5 */
export type BehaviorState = {
  intent: BehaviorIntent;
  emotion: BehaviorEmotion;
  arousal: number;
  attention: number;
  lastSignal?: string;
};
