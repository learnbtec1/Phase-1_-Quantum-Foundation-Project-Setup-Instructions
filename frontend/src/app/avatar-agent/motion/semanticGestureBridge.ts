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
 *
 * Authority: conversational dominance on spine/arms is enforced downstream in
 * VRMSkeletonManager via MotionAuthorityLock (timeline envelope + gesture state).
 */

import type { DetectedIntent } from './intentClassifier';
import { diagnosticsSemanticCooldownHit } from '@/lib/diagnostics/diagnosticsSemantic';
import { diagTimelineTouchSemantic } from '@/lib/diagnostics/diagnosticsTimelineProbe';
import { canonicalizeLlmIntentLabel } from './arabicIntentNormalize';

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

/** Shorter explain rhythm during speech — reduces SEMANTIC_COOLDOWN_STARVE without touching idle/off-speech pacing. */
const EXPLAIN_COOLDOWN_MS_WHILE_SPEAKING = 2_850;

/** TTS-active floor: full {@link CD.think} can starve the bridge (telemetry: think-cooldown while intent=thinking). */
const THINK_COOLDOWN_MS_WHILE_SPEAKING = 2_300;

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

function explainCooldownMs(speaking: boolean): number {
  return speaking ? EXPLAIN_COOLDOWN_MS_WHILE_SPEAKING : CD.explain;
}

function emphasisCooldownMs(speaking: boolean): number {
  return speaking ? Math.min(CD.emphasis + 400, 2_400) : CD.emphasis;
}

export function resetSemanticGestureBridgeState(): void {
  _lastByGesture = {};
  _explainQuietUntil = 0;
}

/**
 * Resolve a single semantic gesture decision for this frame.
 * Survives missing/short text, gaps, and low confidence — returns `idle` often.
 */
function resolveSemanticGestureImpl(input: ResolveSemanticGestureInput): SemanticGestureDecision {
  const e = clamp01(input.stableMotionEnergy);
  const idle = (src: string, cooldownHit?: boolean): SemanticGestureDecision => {
    if (cooldownHit === true) diagnosticsSemanticCooldownHit();
    return {
      gesture: 'idle',
      confidence: 0,
      duration: 0,
      intensity: 0,
      interruptible: true,
      sourceIntent: src,
      debugCooldownHit: cooldownHit === true,
    };
  };

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
    // Speaking is guaranteed by the guard above; shorter CD avoids long-TTS think starvation.
    if (nowBlocked('think', input.nowMs, THINK_COOLDOWN_MS_WHILE_SPEAKING)) {
      return idle('think-cooldown', true);
    }
    _explainQuietUntil = input.nowMs + 1_380;
    touch('think', input.nowMs);
    return {
      gesture: 'think',
      confidence: rc,
      duration: 3120,
      intensity: 0.62 + e * 0.12,
      interruptible: true,
      sourceIntent: 'thinking',
    };
  }

  if (input.nowMs < _explainQuietUntil && (intent === 'explaining' || intent === 'questioning')) {
    return idle('think-suppress-explain');
  }

  // ── Greeting / welcome (warm, not streamer wave spam) ───────────────────
  const llmCanon = canonicalizeLlmIntentLabel(input.llmIntent);
  const llmGreet = llmCanon === 'greeting';
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
    if (nowBlocked('emphasis', input.nowMs, emphasisCooldownMs(input.speaking))) {
      return idle('emphasis-cooldown', true);
    }
    touch('emphasis', input.nowMs);
    touch('point', input.nowMs);
    return {
      gesture: 'emphasis',
      confidence: rc,
      duration: 2180,
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
      duration: 2320,
      intensity: 0.54,
      interruptible: true,
      sourceIntent: 'disagreeing',
    };
  }

  if (intent === 'questioning' && rc >= 0.4) {
    if (nowBlocked('explain', input.nowMs, explainCooldownMs(input.speaking))) {
      return idle('explain-cooldown', true);
    }
    touch('explain', input.nowMs);
    return {
      gesture: 'explain',
      confidence: rc,
      duration: 2680,
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
    if (nowBlocked('explain', input.nowMs, explainCooldownMs(input.speaking))) {
      return idle('explain-cooldown', true);
    }
    touch('explain', input.nowMs);
    return {
      gesture: 'explain',
      confidence: rc * 0.92,
      duration: 2440,
      intensity: 0.55 + e * 0.06,
      interruptible: true,
      sourceIntent: intent,
    };
  }

  // Neutral while speaking: gentle explain hold so gestureLayerW does not collapse for whole utterances.
  if (input.speaking && intent === 'neutral') {
    const explainCd = explainCooldownMs(true);
    if (!nowBlocked('explain', input.nowMs, explainCd)) {
      touch('explain', input.nowMs);
      return {
        gesture: 'explain',
        confidence: Math.max(0.44, rc || 0.44),
        duration: 2_580,
        intensity: 0.54 + e * 0.09,
        interruptible: true,
        sourceIntent: 'neutral-speaking-hold',
      };
    }
  }

  return idle(`neutral:${intent}`);
}

/** Exported wrapper — timeline probe for behavioral forensics (no allocation). */
export function resolveSemanticGesture(input: ResolveSemanticGestureInput): SemanticGestureDecision {
  const d = resolveSemanticGestureImpl(input);
  diagTimelineTouchSemantic(d.gesture, d.sourceIntent);
  return d;
}
