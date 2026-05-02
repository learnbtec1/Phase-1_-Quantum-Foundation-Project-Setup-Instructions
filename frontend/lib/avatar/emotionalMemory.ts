/**
 * Long-term emotional memory (persistent, per-browser).
 * Complements session-scoped `EmotionalMemoryManager` + BrainStore with:
 * decaying emotional salience, relationship band, and adaptation hints.
 *
 * Privacy: no PII — only a short anonymized key derived from a random local id.
 * Storage: localStorage key `cogni:pem` (bounded JSON, trimmed on save).
 */
'use client';

import type { UserMirrorEmotion } from '@/lib/avatar/userEmotionMirror';

const STORAGE_KEY = 'cogni:pem';
const ANON_ID_KEY = 'cogni:anon';
const MAX_HISTORY = 24;
const MAX_TOPIC_SNIPPET = 80;
/** Decay time constant — older impressions fade (avoids permanent bias) */
const DECAY_TAU_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export type RelationshipBand = 'new' | 'familiar' | 'frequent';

export interface EmotionalHistoryEntry {
  ts: number;
  /** Canonical emotion label (user-attributed or mirror) */
  emotion: string;
  /** 0..1 after decay at read time */
  effectiveWeight: number;
  topicSnippet?: string;
}

export interface PersistentEmotionalProfile {
  /** Short anonymized handle (not reversible to identity) */
  userKey: string;
  lastEmotion: string;
  lastEmotionTs: number;
  history: EmotionalHistoryEntry[];
  interactionCount: number;
  firstSeenTs: number;
  lastInteractionTs: number;
  /** 0..1 smoothed engagement */
  engagement: number;
}

export interface EmotionalAdaptationHints {
  /** Multiply TTS rate (e.g. 0.92 = slower when user needed clarity) */
  voiceRateMul: number;
  /** 0..1 — bias toward warmer / more open tone in prompts */
  warmthBias: number;
  /** 0..1 — suggest simpler explanations */
  clarityBias: number;
  /** Optional one-line Arabic hint for LLM to optionally reference past confusion */
  recallHintAr: string | null;
  relationship: RelationshipBand;
}

let _profile: PersistentEmotionalProfile | null = null;
let _dirty = false;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `u${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Stable anonymous id in localStorage — never sent raw to backend; only derived key. */
function getOrCreateAnonId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon-fallback';
  }
}

/** Short non-reversible fingerprint for display / debugging only */
function anonymizedUserKey(): string {
  const raw = getOrCreateAnonId();
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `k${(h >>> 0).toString(16).slice(0, 10)}`;
}

function defaultProfile(): PersistentEmotionalProfile {
  const now = Date.now();
  return {
    userKey: anonymizedUserKey(),
    lastEmotion: 'neutral',
    lastEmotionTs: now,
    history: [],
    interactionCount: 0,
    firstSeenTs: now,
    lastInteractionTs: now,
    engagement: 0.35,
  };
}

function decayWeight(ts: number, now: number): number {
  const age = Math.max(0, now - ts);
  return Math.exp(-age / DECAY_TAU_MS);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function trimHistory(h: EmotionalHistoryEntry[]): EmotionalHistoryEntry[] {
  if (h.length <= MAX_HISTORY) return h;
  return h.slice(-MAX_HISTORY);
}

/** Load from localStorage — call on app init */
export function initPersistentEmotionalMemory(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistentEmotionalProfile> & {
        history?: Array<{ ts: number; emotion: string; topicSnippet?: string }>;
      };
      const base = defaultProfile();
      _profile = {
        userKey: parsed.userKey ?? base.userKey,
        lastEmotion: parsed.lastEmotion ?? base.lastEmotion,
        lastEmotionTs: parsed.lastEmotionTs ?? base.lastEmotionTs,
        interactionCount: Math.max(0, parsed.interactionCount ?? 0),
        firstSeenTs: parsed.firstSeenTs ?? base.firstSeenTs,
        lastInteractionTs: parsed.lastInteractionTs ?? base.lastInteractionTs,
        engagement: clamp01(typeof parsed.engagement === 'number' ? parsed.engagement : base.engagement),
        history: [],
      };
      const now = Date.now();
      const hist = parsed.history ?? [];
      _profile.history = trimHistory(
        hist.map((e) => ({
          ts: e.ts,
          emotion: String(e.emotion || 'neutral').slice(0, 32),
          effectiveWeight: decayWeight(e.ts, now),
          topicSnippet: e.topicSnippet?.slice(0, MAX_TOPIC_SNIPPET),
        })),
      );
    } else {
      _profile = defaultProfile();
    }
  } catch {
    _profile = defaultProfile();
  }
}

export function flushPersistentEmotionalMemory(): void {
  if (typeof window === 'undefined' || !_profile || !_dirty) return;
  try {
    const slim = {
      userKey: _profile.userKey,
      lastEmotion: _profile.lastEmotion,
      lastEmotionTs: _profile.lastEmotionTs,
      interactionCount: _profile.interactionCount,
      firstSeenTs: _profile.firstSeenTs,
      lastInteractionTs: _profile.lastInteractionTs,
      engagement: _profile.engagement,
      history: _profile.history.map((e) => ({
        ts: e.ts,
        emotion: e.emotion,
        topicSnippet: e.topicSnippet,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    _dirty = false;
  } catch {
    /* quota */
  }
}

function ensureProfile(): PersistentEmotionalProfile {
  if (!_profile) initPersistentEmotionalMemory();
  return _profile ?? defaultProfile();
}

/** Recompute effective weights on the timeline (decay) */
export function getProfile(): PersistentEmotionalProfile {
  const p = ensureProfile();
  const now = Date.now();
  p.history = trimHistory(
    p.history.map((e) => ({
      ...e,
      effectiveWeight: decayWeight(e.ts, now),
    })),
  );
  return p;
}

export function getRelationshipBand(): RelationshipBand {
  const p = getProfile();
  const n = p.interactionCount;
  const eng = p.engagement;
  if (n >= 45 || eng >= 0.72) return 'frequent';
  if (n >= 8 || eng >= 0.48) return 'familiar';
  return 'new';
}

/** Salience of an emotion label after decay (sum of matching entries) */
export function getLabelSalience(label: string): number {
  const l = label.toLowerCase();
  return getProfile().history
    .filter((e) => e.emotion.toLowerCase() === l)
    .reduce((s, e) => s + e.effectiveWeight, 0);
}

/**
 * Record a user-side emotional snapshot (e.g. after transcript + mirror inference).
 */
export function recordUserEmotionalSnapshot(
  emotion: string,
  opts?: { topicSnippet?: string; mirror?: UserMirrorEmotion },
): void {
  const p = ensureProfile();
  const now = Date.now();
  const em = String(opts?.mirror ?? emotion ?? 'neutral').slice(0, 32);
  const topic = opts?.topicSnippet?.slice(0, MAX_TOPIC_SNIPPET);

  p.lastEmotion = em;
  p.lastEmotionTs = now;
  p.lastInteractionTs = now;
  p.interactionCount += 1;

  const w = decayWeight(now, now);
  p.history.push({
    ts: now,
    emotion: em,
    effectiveWeight: w,
    topicSnippet: topic,
  });
  p.history = trimHistory(p.history);

  const step = Math.min(0.035, 0.008 + p.interactionCount / 600);
  p.engagement = clamp01(p.engagement * (1 - step) + (0.28 + Math.min(0.62, p.interactionCount / 75)) * step);

  _dirty = true;
}

/** Optional: count agent replies as lightweight continuity (no duplicate emotion) */
export function recordInteractionTick(): void {
  const p = ensureProfile();
  p.lastInteractionTs = Date.now();
  _dirty = true;
}

function confusedSalienceRecent(): number {
  const now = Date.now();
  const windowMs = 48 * 60 * 60 * 1000;
  let s = 0;
  for (const e of getProfile().history) {
    if (now - e.ts > windowMs) continue;
    if (/confus|lost|unsure|محتار|مش فاهم/i.test(e.emotion) || e.emotion === 'confused') {
      s += e.effectiveWeight;
    }
  }
  return clamp01(s / 3);
}

export function getAdaptationHints(): EmotionalAdaptationHints {
  const p = getProfile();
  const rel = getRelationshipBand();
  const confused = Math.max(getLabelSalience('confused'), confusedSalienceRecent());

  let voiceRateMul = 1;
  let warmthBias = 0.42;
  let clarityBias = 0.35;

  if (confused > 0.12) {
    voiceRateMul *= 0.9 - Math.min(0.06, confused * 0.08);
    clarityBias = Math.min(1, clarityBias + 0.22 + confused * 0.15);
  }

  const frustrated = Math.max(
    getLabelSalience('frustrated'),
    getLabelSalience('angry') * 0.65,
  );
  if (frustrated > 0.08) {
    voiceRateMul *= 0.92 - Math.min(0.06, frustrated * 0.06);
    warmthBias = Math.min(1, warmthBias + 0.18 + frustrated * 0.14);
    clarityBias = Math.min(1, clarityBias + 0.08 + frustrated * 0.1);
  }

  if (rel === 'frequent') {
    warmthBias = Math.min(1, warmthBias + 0.18);
    clarityBias = Math.max(0.2, clarityBias - 0.08);
  } else if (rel === 'new') {
    warmthBias = Math.max(0.28, warmthBias - 0.1);
    clarityBias = Math.min(1, clarityBias + 0.12);
  }

  let recallHintAr: string | null = null;
  if (confused > 0.18 && p.history.length >= 2) {
    const lastTopic = [...p.history].reverse().find((e) => e.topicSnippet)?.topicSnippet;
    if (lastTopic && lastTopic.length > 3) {
      recallHintAr =
        `يمكنك عند اللزوم أن تشير بلطف إلى أن الطالب واجه صعوبة سابقاً في موضوع قريب (مثل: "${lastTopic.slice(0, 40)}") دون المبالغة — جملة واحدة كافية.`;
    }
  }

  voiceRateMul = Math.min(1.04, Math.max(0.82, voiceRateMul));

  return {
    voiceRateMul,
    warmthBias: clamp01(warmthBias),
    clarityBias: clamp01(clarityBias),
    recallHintAr,
    relationship: rel,
  };
}

/** One line for EmotionalMemoryManager / WS context */
export function getCompactSummaryForPrompt(): string {
  const p = getProfile();
  const rel = getRelationshipBand();
  const hints = getAdaptationHints();
  return (
    `LTM emotion: last=${p.lastEmotion} | interactions=${p.interactionCount} | ` +
    `engagement=${p.engagement.toFixed(2)} | relationship=${rel} | ` +
    `adapt: warmth~${hints.warmthBias.toFixed(2)} clarity~${hints.clarityBias.toFixed(2)}`
  );
}

/** Subtle embodiment multiplier for gaze connection — avoid large swings */
export function getEmbodimentHints(): { gazeConnectionMul: number } {
  const rel = getRelationshipBand();
  const h = getAdaptationHints();
  const gaze = rel === 'frequent' ? 1.06 : rel === 'new' ? 0.97 : 1.02;
  const warmth = 0.97 + h.warmthBias * 0.06;
  return {
    gazeConnectionMul: Math.min(1.1, Math.max(0.92, gaze * warmth)),
  };
}

export function resetPersistentEmotionalMemory(): void {
  _profile = defaultProfile();
  _dirty = true;
  flushPersistentEmotionalMemory();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
