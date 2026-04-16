/**
 * Independent Opinion Engine — client-side **instruction & consistency layer** for the LLM.
 * Does not invent facts; shapes *how* the tutor forms views (stance, reasoning, uncertainty).
 *
 * Integrates: personality vector, emotional memory hints, bounded topic memory (localStorage).
 */
'use client';

import { getAdaptationHints, getProfile } from '@/lib/avatar/emotionalMemory';
import {
  getEffectivePersonalityVector,
  type PersonalityVector,
} from '@/lib/avatar/personalityEvolution';

const STORAGE_KEY = 'cogni:opin';
const MAX_TOPICS = 18;
const REFINEMENT_STEP = 0.002;
const REFINEMENT_CAP = 0.28;

export type OpinionStanceKind = 'collaborative' | 'direct' | 'exploratory';

export interface StructuredOpinion {
  /** Instructional stance for the model — not an asserted fact */
  stance: string;
  reasoning: string;
  nuance: string;
  /** Optional alternative framing (high curiosity) */
  alternativeView?: string;
}

export interface OpinionContextInput {
  userText: string;
  comprehensionConfidence: number;
  /** True when sending audio before transcript exists */
  isAudioTurn?: boolean;
}

interface TopicOpinionRecord {
  stanceKind: OpinionStanceKind;
  ts: number;
}

interface OpinionStore {
  topics: Record<string, TopicOpinionRecord>;
  /** Long-term subtle refinement 0..REFINEMENT_CAP */
  refinement: number;
  interactionTicks: number;
}

let _store: OpinionStore | null = null;
let _dirty = false;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function topicKeyFromText(t: string): string {
  const words = t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 5);
  return words.join('|').slice(0, 96) || 'general';
}

/** Deterministic stance class from personality + memory — no RNG */
export function classifyOpinionStance(
  v: PersonalityVector,
  comprehensionLow: boolean,
): OpinionStanceKind {
  if (comprehensionLow) return 'collaborative';
  if (v.curiosity > 0.68 && v.formality < 0.52) return 'exploratory';
  if (v.formality > 0.54 && v.empathy < 0.58) return 'direct';
  return 'collaborative';
}

function ensureStore(): OpinionStore {
  if (_store) return _store;
  if (typeof window === 'undefined') {
    _store = { topics: {}, refinement: 0, interactionTicks: 0 };
    return _store;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<OpinionStore>;
      _store = {
        topics: typeof p.topics === 'object' && p.topics ? p.topics : {},
        refinement: clamp01(typeof p.refinement === 'number' ? p.refinement : 0),
        interactionTicks: Math.max(0, p.interactionTicks ?? 0),
      };
    } else {
      _store = { topics: {}, refinement: 0, interactionTicks: 0 };
    }
  } catch {
    _store = { topics: {}, refinement: 0, interactionTicks: 0 };
  }
  return _store;
}

export function initOpinionEngine(): void {
  ensureStore();
}

export function flushOpinionEngine(): void {
  if (typeof window === 'undefined' || !_dirty || !_store) return;
  try {
    const keys = Object.keys(_store.topics);
    if (keys.length > MAX_TOPICS) {
      const sorted = keys.sort(
        (a, b) => (_store!.topics[b].ts ?? 0) - (_store!.topics[a].ts ?? 0),
      );
      const next: Record<string, TopicOpinionRecord> = {};
      sorted.slice(0, MAX_TOPICS).forEach((k) => {
        next[k] = _store!.topics[k];
      });
      _store.topics = next;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_store));
    _dirty = false;
  } catch {
    /* quota */
  }
}

/** After user message — record stance kind for continuity (no factual claims). */
export function recordOpinionTopicSnapshot(userText: string): void {
  if (!userText?.trim()) return;
  const s = ensureStore();
  const key = topicKeyFromText(userText);
  const v = getEffectivePersonalityVector();
  const low = getProfile().engagement < 0.38 || getAdaptationHints().clarityBias > 0.55;
  const kind = classifyOpinionStance(v, low);
  s.topics[key] = { stanceKind: kind, ts: Date.now() };
  s.interactionTicks += 1;
  s.refinement = Math.min(REFINEMENT_CAP, s.refinement + REFINEMENT_STEP);
  _dirty = true;
}

function priorTopicNote(userText: string): string | null {
  const key = topicKeyFromText(userText);
  const s = ensureStore();
  const rec = s.topics[key];
  if (!rec) return null;
  const ageH = (Date.now() - rec.ts) / 3_600_000;
  if (ageH > 72) return null;
  return (
    `Earlier in this topic area you leaned toward a "${rec.stanceKind}" framing; if you change your mind, acknowledge it briefly (do not contradict without explaining).`
  );
}

function depthMode(conf: number): 'simple' | 'medium' | 'deep' {
  if (conf < 0.42) return 'simple';
  if (conf < 0.72) return 'medium';
  return 'deep';
}

function buildAlternativeHint(v: PersonalityVector): string | null {
  if (v.curiosity < 0.62) return null;
  return 'Optionally mention one reasonable alternative or caveat in one short phrase.';
}

/**
 * Structured instruction triple for prompts / logs (no hallucinated facts).
 */
export function buildStructuredOpinion(input: OpinionContextInput): StructuredOpinion {
  const v = getEffectivePersonalityVector();
  const hints = getAdaptationHints();
  const prof = getProfile();
  const conf = input.comprehensionConfidence;
  const depth = depthMode(conf);
  const soft = v.empathy > 0.62;
  const direct = v.formality > 0.54 && v.energy > 0.48;
  const uncertain = conf < 0.48 || hints.clarityBias > 0.55;

  let stance = 'Offer a clear, tutor-appropriate viewpoint grounded in the lesson context.';
  if (soft) {
    stance =
      'Lead with empathy: acknowledge effort; state your view as a considered teaching stance, not a personal attack.';
  } else if (direct) {
    stance = 'State your position clearly and briefly, then support with reasoning tied to criteria or definitions.';
  }

  let reasoning = 'Separate facts (from materials) from interpretation; justify interpretive steps explicitly.';
  if (depth === 'simple') {
    reasoning =
      'Keep reasoning short; prioritize one main chain of thought; avoid jargon unless defined.';
  } else if (depth === 'deep') {
    reasoning =
      'You may use a compact analytical chain: claim → warrant → example; stay within the scenario.';
  }

  let nuance =
    'If evidence is incomplete, say so; prefer hedged phrasing over false certainty (e.g. أعتقد أن… مع ذلك يعتمد على…).';
  if (uncertain) {
    nuance +=
      ' Reduce assertiveness; invite the learner to verify definitions or steps.';
  }
  if (hints.recallHintAr) {
    nuance += ' You may gently connect to prior difficulty only if it helps learning.';
  }

  const refinement = ensureStore().refinement;
  if (refinement > 0.08) {
    nuance += ` Refinement bias: ${(refinement * 100).toFixed(0)}% — slightly prefer concise, student-aligned phrasing.`;
  }

  const alternativeView = buildAlternativeHint(v) ?? undefined;

  return { stance, reasoning, nuance, alternativeView };
}

/** Compact string for `emotional_context` / WS (English + short Arabic cues). */
export function getOpinionContextForPrompt(input: OpinionContextInput): string {
  const v = getEffectivePersonalityVector();
  const so = buildStructuredOpinion(input);
  const prior = !input.isAudioTurn && input.userText.trim()
    ? priorTopicNote(input.userText)
    : null;

  const lines: string[] = [
    'OPINION_LAYER:',
    `stance=${so.stance}`,
    `reasoning=${so.reasoning}`,
    `nuance=${so.nuance}`,
  ];
  if (so.alternativeView) lines.push(`alt_hint=${so.alternativeView}`);
  lines.push(
    `personality_filter: empathy=${v.empathy.toFixed(2)} curiosity=${v.curiosity.toFixed(2)} formality=${v.formality.toFixed(2)} energy=${v.energy.toFixed(2)}`,
  );
  lines.push(`depth=${depthMode(input.comprehensionConfidence)}`);
  if (prior) lines.push(`consistency=${prior}`);
  if (input.isAudioTurn) {
    lines.push('mode=audio_turn: keep opinion instructions; wait for transcript if ambiguous.');
  }

  return lines.join(' | ').slice(0, 2800);
}

/** Merge with existing emotional context without duplicating separators */
export function mergeOpinionIntoEmotionalContext(
  emotionalSummary: string,
  input: OpinionContextInput,
): string {
  const op = getOpinionContextForPrompt(input);
  if (!emotionalSummary.trim()) return op;
  return `${emotionalSummary} || ${op}`;
}

export function resetOpinionEngine(): void {
  _store = { topics: {}, refinement: 0, interactionTicks: 0 };
  _dirty = true;
  flushOpinionEngine();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Embodiment hints — consumer may tie to `thinking` intent / pre-speech (optional).
 * Values are conservative to avoid spam.
 */
export function getOpinionEmbodimentHints(input: OpinionContextInput): {
  suggestThinkingPause: boolean;
  /** 0..1 scale for subtle extra “consideration” feel */
  considerationWeight: number;
} {
  const v = getEffectivePersonalityVector();
  const conf = input.comprehensionConfidence;
  const deep = depthMode(conf) === 'deep';
  const struggle = conf < 0.45;
  const consider =
    clamp01(0.25 + v.curiosity * 0.2 + (deep ? 0.15 : 0) + (struggle ? 0.12 : 0));
  return {
    suggestThinkingPause: deep || (v.curiosity > 0.7 && !input.isAudioTurn),
    considerationWeight: consider,
  };
}
