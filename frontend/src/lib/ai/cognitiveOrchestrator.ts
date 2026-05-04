/**
 * Maps transcript + optional LLM-authoritative fields → EmbodimentState slices.
 * When `intent` is provided by the LLM, it is the source of truth (heuristics skipped).
 * Intent lifecycle: stale structured LLM → smooth intensity decay; no hard resets.
 */
import type { EmbodimentState, SpeechSemanticHints } from '@/lib/avatar/embodimentState';
import type { BehaviorMotionMode } from '@/lib/behavior/behaviorMotionBrain';
import type { MotionIntentKind } from '@/lib/avatar/motionIntentContinuity';
import { deriveSpeechSemanticHints } from '@/lib/avatar/speechSemanticHints';

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Stable 0..1 from string — avoids jitter frame-to-frame. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 10000) / 10000;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

let lastDerivedIntent: MotionIntentKind = null;
let lastIntentStartTime = 0;
/** Updated whenever `activeIntent` changes (transition safety / diagnostics). */
let lastIntentUpdateTime = 0;
let smoothedIntensity = 0.5;

/** Wall time of last structured cognitive_* payload from LLM (processFrame). */
let lastStructuredCognitiveAtMs = 0;

const STALE_STRUCTURED_MS_MIN = 2500;
const STALE_STRUCTURED_MS_MAX = 4000;
function staleStructuredThresholdMs(): number {
  return STALE_STRUCTURED_MS_MIN + hash01('cognitive-stale') * (STALE_STRUCTURED_MS_MAX - STALE_STRUCTURED_MS_MIN);
}

const DECAY_INTENT_FADE_MUL = 0.96;
const INTENT_CLEAR_INTENSITY = 0.12;

/** Latest LLM / backend embodiment hints (set when AgentFrame includes cognitive_*). */
export type CognitiveLLMOutput = {
  intent?: CognitiveIntentHint;
  intensity?: number;
  tone?: string;
};

let llmPipelineHints: CognitiveLLMOutput | null = null;

export function setCognitiveOrchestratorLLMOutput(h: CognitiveLLMOutput | null): void {
  llmPipelineHints = h;
  if (h === null) {
    lastStructuredCognitiveAtMs = 0;
    return;
  }
  if (h.intent !== undefined || h.intensity !== undefined || h.tone !== undefined) {
    lastStructuredCognitiveAtMs = perfNow();
  }
}

export function getCognitiveOrchestratorLLMOutput(): CognitiveLLMOutput | null {
  return llmPipelineHints;
}

/** Optional LLM fields merged into deriveEmbodimentFromLLM each frame (skeleton path). */
export function getCognitiveOrchestratorInputOverlay(): CognitiveLLMOutput {
  return llmPipelineHints ? { ...llmPipelineHints } : {};
}

/** Last time `activeIntent` changed (ms). */
export function getLastIntentUpdateTime(): number {
  return lastIntentUpdateTime;
}

// ─── Heuristic fallback (only when LLM does not supply intent) ───

const RE_EXPLAIN_EN =
  /\b(because|therefore|means|thus|hence|explain|essentially|clarify|in other words|for example|e\.g\.|in summary)\b/i;
const RE_EXPLAIN_AR = /(يعني|لأن|وبالتالي|بالتالي|لذلك|أي أن|بمعنى|شرح|باختصار|ملخصًا|ملخصا)/u;

const RE_THINK_EN =
  /\b(why|how come|what if|unsure|maybe|perhaps|not sure|i think|i guess|probably|might|could it|hmm)\b/i;
/**
 * Word-level Arabic hesitation / interrogative cues — the standalone `?` / `؟`
 * was deliberately removed: a single trailing question mark in an explanatory
 * sentence must NOT classify intent as `thinking` (it locks the expression
 * engine into tilt-only motion).
 */
const RE_THINK_AR_WORDS = /(كيف|لماذا|لم |هل |ماذا|ربما|أظن|يمكن|غير متأكد|مو متأكد|مش متأكد)/u;

const RE_STRONG_EN = /\b(very|important|critical|essential|must|definitely|strongly|key)\b/i;
const RE_STRONG_AR = /(لازم|مهم جدا|مهمّ|جداً|جدا|ضروري|حرج|أساسي|بالغ الأهمية)/u;

export type CognitiveIntentHint = 'explaining' | 'thinking' | 'listening';

export type CognitiveOrchestratorInput = {
  text: string;
  intent?: CognitiveIntentHint;
  intensity?: number;
  tone?: string;
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
};

function inferIntentHeuristic(raw: string, lower: string, isAgentSpeaking: boolean): MotionIntentKind | null {
  if (!isAgentSpeaking || !raw.length) return null;
  const explain = RE_EXPLAIN_EN.test(raw) || RE_EXPLAIN_AR.test(raw);
  /** Word-level hesitation is the only signal allowed to override an explanation cue. */
  const wordThinkCue = RE_THINK_EN.test(lower) || RE_THINK_AR_WORDS.test(raw);
  const hasQuestionMark = /[؟?]/.test(raw);

  if (explain && !wordThinkCue) return 'explaining';
  if (wordThinkCue) return 'thinking';
  if (hasQuestionMark && !explain) return 'thinking';
  if (explain) return 'explaining';
  return null;
}

function applyToneToHints(hints: SpeechSemanticHints, tone: string | undefined): SpeechSemanticHints {
  if (!tone || !tone.trim()) return hints;
  const t = tone.toLowerCase();
  const next = { ...hints };
  if (/support|warm|empath|care|encourag|reassur|positive/u.test(t)) {
    next.emphasis = clamp01(next.emphasis + 0.06);
    next.explanation = clamp01(next.explanation + 0.05);
  }
  if (/serious|firm|critical|strict|important/u.test(t)) {
    next.emphasis = clamp01(next.emphasis + 0.12);
  }
  if (/uncertain|tentative|hesitat/u.test(t)) {
    next.uncertainty = clamp01(next.uncertainty + 0.1);
  }
  if (/curious|question|wonder/u.test(t)) {
    next.question = clamp01(next.question + 0.08);
  }
  return next;
}

/**
 * Derives embodiment fields. LLM-provided `intent` / `intensity` / `tone` take priority over heuristics.
 * Intensity: lerp toward target normally; when structured LLM is stale and agent idle → multiply decay per frame.
 */
export function deriveEmbodimentFromLLM(input: CognitiveOrchestratorInput): Partial<EmbodimentState> {
  const raw = String(input.text ?? '').replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();
  const now = perfNow();

  let behaviorMode: BehaviorMotionMode = 'IDLE';
  if (input.isUserSpeaking) behaviorMode = 'LISTENING';
  else if (input.isAgentSpeaking) behaviorMode = 'RESPONDING';

  const hadStructuredLLM = lastStructuredCognitiveAtMs > 0;
  const staleMs = staleStructuredThresholdMs();
  const staleStructured =
    hadStructuredLLM
    && now - lastStructuredCognitiveAtMs >= staleMs;
  const decayActive =
    staleStructured
    && !input.isAgentSpeaking
    && !input.isUserSpeaking;

  let targetIntensity = 0.45;
  if (input.intensity !== undefined && Number.isFinite(input.intensity)) {
    targetIntensity = clamp01(input.intensity);
  } else if (!input.isUserSpeaking && !input.isAgentSpeaking) {
    targetIntensity = 0.2;
  } else if (RE_STRONG_EN.test(lower) || RE_STRONG_AR.test(raw)) {
    targetIntensity = 0.7 + hash01(raw) * 0.28;
  } else if (raw.length > 0) {
    targetIntensity = 0.4 + Math.min(0.22, raw.length / 900);
  } else {
    targetIntensity = 0.35;
  }

  if (decayActive) {
    smoothedIntensity *= DECAY_INTENT_FADE_MUL;
    if (smoothedIntensity < INTENT_CLEAR_INTENSITY) {
      smoothedIntensity = Math.max(0.05, smoothedIntensity);
    }
  } else {
    smoothedIntensity += (targetIntensity - smoothedIntensity) * 0.14;
  }

  let activeIntent: MotionIntentKind = null;

  if (input.isUserSpeaking) {
    activeIntent = 'listening';
  } else if (decayActive && smoothedIntensity < INTENT_CLEAR_INTENSITY) {
    activeIntent = null;
    if (llmPipelineHints !== null) {
      setCognitiveOrchestratorLLMOutput(null);
    }
  } else if (decayActive && smoothedIntensity >= INTENT_CLEAR_INTENSITY) {
    /** Do not hold `listening` after user stops — only fade LLM / heuristic body intents. */
    activeIntent = lastDerivedIntent === 'listening' ? null : lastDerivedIntent;
  } else if (input.intent !== undefined) {
    activeIntent = input.intent;
  } else if (input.isAgentSpeaking && raw.length > 0) {
    activeIntent = inferIntentHeuristic(raw, lower, true);
  } else {
    activeIntent = null;
  }

  if (activeIntent !== lastDerivedIntent) {
    const t = perfNow();
    lastIntentStartTime = t;
    lastIntentUpdateTime = t;
    lastDerivedIntent = activeIntent;
  }

  let hints = deriveSpeechSemanticHints(raw.length ? raw : undefined);
  hints = applyToneToHints(hints, input.tone);

  return {
    behaviorMode,
    intent: {
      activeIntent,
      intensity: Math.min(1, Math.max(0, smoothedIntensity)),
      startTime: lastIntentStartTime,
    },
    hints,
  };
}

export function resetCognitiveOrchestratorSmoothing(): void {
  lastDerivedIntent = null;
  lastIntentStartTime = 0;
  lastIntentUpdateTime = 0;
  smoothedIntensity = 0.5;
  lastStructuredCognitiveAtMs = 0;
}
