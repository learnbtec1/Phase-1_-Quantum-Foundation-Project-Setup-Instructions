'use client';
/**
 * Semantic Gesture Bridge — Stage 4
 *
 * Maps conversational meaning (rule intent + LLM hints + listen/speak context)
 * into discrete {@link SemanticGestureDecision} values. Cooldowns and soft
 * priorities keep motion teacher-like (calm Jordanian educator), not spammy.
 *
 * Execution path: VRMSkeletonManager → {@link resolveSemanticGesture} →
 * {@link pushBehaviorFromSemanticDecision} in `behaviorTimeline.ts` →
 * `tickBehaviorTimeline` → legacy gesture refs. No direct bone writes here.
 *
 * FORENSIC_CP: bridge cooldowns تحكم التكرار؛ لكن جدولة الذراع أثناء الكلام الطويل تعتمد أيضًا على
 * `talkGestureNextAtMsRef` في VRMSkeletonManager (لا تعتمد على hash النص وحده).
 */

import type { DetectedIntent } from './intentClassifier';

export type SemanticGestureDecision = {
  gesture:
    | 'wave'
    | 'explain'
    | 'point'
    | 'listen'
    | 'think'
    | 'welcome'
    | 'emphasis'
    | 'idle';
  confidence: number;
  duration: number;
  intensity: number;
  interruptible: boolean;
  sourceIntent: string;
  /** True when a concrete gesture was skipped due to cooldown (for debug HUD). */
  debugCooldownHit?: boolean;
};

export type ResolveSemanticGestureInput = {
  detectedIntent: DetectedIntent;
  /** 0..1 from `detectIntentDetailed`. */
  ruleConfidence: number;
  llmIntent?: string | null;
  utteranceText: string;
  utteranceHash: string;
  speaking: boolean;
  listening: boolean;
  nowMs: number;
  /** From `getStableMotionEnergy()` — amplitude hint only, not a second authority. */
  stableMotionEnergy: number;
};

const CD = {
  waveWelcome: 15_000,
  explain: 5_000,
  point: 3_600,
  think: 5_200,
  emphasis: 2_800,
  listen: 6_500,
} as const;

let _lastByGesture: Partial<Record<SemanticGestureDecision['gesture'], number>> = {};
let _explainQuietUntil = 0;

function nowBlocked(g: SemanticGestureDecision['gesture'], t: number, ms: number): boolean {
  return ((_lastByGesture[g] ?? 0) + ms > t);
}

function touch(g: SemanticGestureDecision['gesture'], t: number): void {
  _lastByGesture[g] = t;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function resetSemanticGestureBridgeState(): void {
  _lastByGesture = {};
  _explainQuietUntil = 0;
}

/**
 * Resolve a single semantic gesture decision for this frame.
 * Survives missing/short text, gaps, and low confidence — returns `idle` often.
 */
export function resolveSemanticGesture(input: ResolveSemanticGestureInput): SemanticGestureDecision {
  const e = clamp01(input.stableMotionEnergy);
  const idle = (src: string, cooldownHit?: boolean): SemanticGestureDecision => ({
    gesture: 'idle',
    confidence: 0,
    duration: 0,
    intensity: 0,
    interruptible: true,
    sourceIntent: src,
    debugCooldownHit: cooldownHit === true,
  });

  // ── Listening posture (user not speaking) ───────────────────────────────
  if (input.listening && !input.speaking) {
    if (nowBlocked('listen', input.nowMs, CD.listen)) {
      return idle('listen-cooldown', true);
    }
    touch('listen', input.nowMs);
    return {
      gesture: 'listen',
      confidence: 0.66,
      duration: 2550,
      intensity: 0.48 + e * 0.1,
      interruptible: true,
      sourceIntent: 'listening',
    };
  }

  if (!input.speaking) {
    return idle('not-speaking');
  }

  const rc = clamp01(input.ruleConfidence);
  const intent = input.detectedIntent;

  // ── Thinking / hesitation (suppresses busy explain briefly) ─────────────
  if (intent === 'thinking' && rc >= 0.36) {
    if (nowBlocked('think', input.nowMs, CD.think)) {
      return idle('think-cooldown', true);
    }
    _explainQuietUntil = input.nowMs + 2200;
    touch('think', input.nowMs);
    return {
      gesture: 'think',
      confidence: rc,
      duration: 2850,
      intensity: 0.62 + e * 0.12,
      interruptible: true,
      sourceIntent: 'thinking',
    };
  }

  if (input.nowMs < _explainQuietUntil && (intent === 'explaining' || intent === 'questioning')) {
    return idle('think-suppress-explain');
  }

  // ── Greeting / welcome (warm, not streamer wave spam) ───────────────────
  const llmGreet = (input.llmIntent ?? '').toLowerCase() === 'greeting';
  if (intent === 'greeting' || llmGreet) {
    if (nowBlocked('welcome', input.nowMs, CD.waveWelcome)) {
      return idle('welcome-cooldown', true);
    }
    touch('welcome', input.nowMs);
    touch('wave', input.nowMs);
    return {
      gesture: 'welcome',
      confidence: Math.max(rc, llmGreet ? 0.55 : 0.5),
      duration: 2150,
      intensity: 0.68 + e * 0.08,
      interruptible: true,
      sourceIntent: llmGreet ? 'llm:greeting' : 'greeting',
    };
  }

  if (intent === 'emphasizing' && rc >= 0.42) {
    if (nowBlocked('emphasis', input.nowMs, CD.emphasis)) {
      return idle('emphasis-cooldown', true);
    }
    touch('emphasis', input.nowMs);
    touch('point', input.nowMs);
    return {
      gesture: 'emphasis',
      confidence: rc,
      duration: 1950,
      intensity: 0.58 + e * 0.1,
      interruptible: true,
      sourceIntent: 'emphasizing',
    };
  }

  if (intent === 'disagreeing' && rc >= 0.4) {
    if (nowBlocked('point', input.nowMs, CD.point)) {
      return idle('point-cooldown', true);
    }
    touch('point', input.nowMs);
    return {
      gesture: 'point',
      confidence: rc,
      duration: 2100,
      intensity: 0.54,
      interruptible: true,
      sourceIntent: 'disagreeing',
    };
  }

  if (intent === 'questioning' && rc >= 0.4) {
    if (nowBlocked('explain', input.nowMs, CD.explain)) {
      return idle('explain-cooldown', true);
    }
    touch('explain', input.nowMs);
    return {
      gesture: 'explain',
      confidence: rc,
      duration: 2450,
      intensity: 0.6 + e * 0.08,
      interruptible: true,
      sourceIntent: 'questioning',
    };
  }

  if (intent === 'explaining' && rc >= 0.38) {
    if (nowBlocked('explain', input.nowMs, CD.explain)) {
      return idle('explain-cooldown', true);
    }
    touch('explain', input.nowMs);
    return {
      gesture: 'explain',
      confidence: rc,
      duration: 2650,
      intensity: 0.62 + e * 0.1,
      interruptible: true,
      sourceIntent: 'explaining',
    };
  }

  if ((intent === 'agreeing' || intent === 'confirming') && rc >= 0.38) {
    if (nowBlocked('explain', input.nowMs, CD.explain)) {
      return idle('explain-cooldown', true);
    }
    touch('explain', input.nowMs);
    return {
      gesture: 'explain',
      confidence: rc * 0.92,
      duration: 2200,
      intensity: 0.55 + e * 0.06,
      interruptible: true,
      sourceIntent: intent,
    };
  }

  return idle(`neutral:${intent}`);
}
