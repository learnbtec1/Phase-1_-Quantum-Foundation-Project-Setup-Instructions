/**
 * Digital companionship — long-term relationship hints for the tutor (client-side).
 * Non-intrusive: sparse check-ins, light continuity, safety rails (no dependency / manipulation).
 *
 * Builds on `emotionalMemory` (interaction count, engagement, history) + local session visits.
 */
'use client';

import {
  getAdaptationHints,
  getLabelSalience,
  getProfile,
} from '@/lib/avatar/emotionalMemory';

const STORAGE_KEY = 'cogni:comp';
/** Min gap to count a new "visit session" (browser return) */
const VISIT_GAP_MS = 28 * 60 * 1000;
const MAX_CONTEXT_CHARS = 2200;

export type RelationshipLevel = 'new' | 'familiar' | 'regular' | 'close';

export interface CompanionshipSessionSnapshot {
  returningUser: boolean;
  /** Hours since last visit (approx) */
  hoursSinceLastVisit: number;
  level: RelationshipLevel;
  visitSessionCount: number;
}

interface CompanionshipStore {
  userKey: string;
  lastVisitMs: number;
  /** Monotonic when user returns after VISIT_GAP_MS */
  visitSessionCount: number;
  /** Last turn index when we suggested a check-in (avoid spam) */
  lastCheckInAtInteraction: number;
}

let _store: CompanionshipStore | null = null;
let _dirty = false;
let _sessionSnapshot: CompanionshipSessionSnapshot | null = null;
/** Hours between persisted `lastVisitMs` and this page load (set in `initCompanionship` only). */
let _gapHoursSinceLastVisit = 0;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function anonymizedKey(): string {
  const p = getProfile();
  return p.userKey;
}

function defaultStore(): CompanionshipStore {
  return {
    userKey: anonymizedKey(),
    lastVisitMs: Date.now(),
    visitSessionCount: 1,
    lastCheckInAtInteraction: 0,
  };
}

export function initCompanionship(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CompanionshipStore>;
      const prevLast = typeof p.lastVisitMs === 'number' ? p.lastVisitMs : now;
      _gapHoursSinceLastVisit = Math.max(0, (now - prevLast) / 3_600_000);
      let vsc = Math.max(1, p.visitSessionCount ?? 1);
      if (now - prevLast > VISIT_GAP_MS) {
        vsc += 1;
      }
      _store = {
        userKey: p.userKey ?? anonymizedKey(),
        lastVisitMs: now,
        visitSessionCount: vsc,
        lastCheckInAtInteraction: p.lastCheckInAtInteraction ?? 0,
      };
    } else {
      _gapHoursSinceLastVisit = 0;
      _store = defaultStore();
    }
  } catch {
    _gapHoursSinceLastVisit = 0;
    _store = defaultStore();
  }
  _dirty = true;
  _sessionSnapshot = buildSessionSnapshot();
}

export function flushCompanionship(): void {
  if (typeof window === 'undefined' || !_dirty || !_store) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_store));
    _dirty = false;
  } catch {
    /* quota */
  }
}

function ensureStore(): CompanionshipStore {
  if (!_store) initCompanionship();
  return _store ?? defaultStore();
}

/** Map emotional trajectory + volume to four relationship levels */
export function getRelationshipLevel(): RelationshipLevel {
  const p = getProfile();
  const n = p.interactionCount;
  const eng = p.engagement;
  if (n < 5) return 'new';
  if (n < 18) return 'familiar';
  if (n < 42 && eng < 0.68) return 'regular';
  return 'close';
}

function buildSessionSnapshot(): CompanionshipSessionSnapshot {
  const p = getProfile();
  const store = ensureStore();
  const hours = _gapHoursSinceLastVisit;
  const returning =
    store.visitSessionCount > 1 || p.interactionCount > 2 || hours >= 2;
  return {
    returningUser: returning,
    hoursSinceLastVisit: hours,
    level: getRelationshipLevel(),
    visitSessionCount: store.visitSessionCount,
  };
}

export function getCompanionshipSessionSnapshot(): CompanionshipSessionSnapshot {
  if (_sessionSnapshot) return _sessionSnapshot;
  return buildSessionSnapshot();
}

/** Emotional support bias from recent history (no fabricated facts) */
function supportNotes(): string[] {
  const notes: string[] = [];
  const fr = getLabelSalience('frustrated') + getFrustratedSalienceHeuristic();
  const conf = getLabelSalience('confused');
  const eng = getProfile().engagement;

  if (fr > 0.35) {
    notes.push('Patience: user may have felt friction recently — shorter steps, validate effort.');
  }
  if (conf > 0.3) {
    notes.push('Clarity: simplify; define terms; one idea at a time.');
  }
  if (eng > 0.62 && fr < 0.2 && conf < 0.2) {
    notes.push('Engagement is strong — you may go slightly deeper if the question invites it.');
  }
  return notes;
}

function getFrustratedSalienceHeuristic(): number {
  const h = getProfile().history;
  let s = 0;
  const now = Date.now();
  for (const e of h) {
    if (now - e.ts > 72 * 60 * 60 * 1000) continue;
    if (/frustrat|angry|زهق|تعبت|annoyed/i.test(e.emotion)) s += e.effectiveWeight;
  }
  return clamp01(s / 2.5);
}

/**
 * Expanded memory / continuity — not every WS message (keeps prompts light).
 */
function shouldExpandCompanionship(): boolean {
  const p = getProfile();
  const n = p.interactionCount;
  if (n < 8) return true;
  if (_gapHoursSinceLastVisit >= 4) return true;
  if (n % 5 === 0) return true;
  return n % 17 === 3;
}

/** Rare check-in line for LLM (deterministic, only inside expanded block) */
function maybeCheckInInstruction(p: ReturnType<typeof getProfile>): string | null {
  const store = ensureStore();
  const n = p.interactionCount;
  if (n < 8) return null;
  if (n - store.lastCheckInAtInteraction < 14) return null;
  if (n % 17 !== 3) return null;
  store.lastCheckInAtInteraction = n;
  _dirty = true;
  return (
    'OPTIONAL_ONE_LINE_CHECKIN: If the topic allows, you may ask one brief caring follow-up in Arabic ' +
    '(e.g. هل تحسّن الوضع من آخر مرة؟ أو هل صار أوضح؟). Skip if it would feel intrusive or off-topic.'
  );
}

function companionshipMinimalBlock(): string {
  const p = getProfile();
  const snap = getCompanionshipSessionSnapshot();
  const hints = getAdaptationHints();
  return (
    `COMPANIONSHIP: user_key=${p.userKey.slice(0, 12)}… | interactions=${p.interactionCount} | ` +
    `relationship_level=${snap.level} | visits≈${snap.visitSessionCount} | returning=${snap.returningUser} | ` +
    `engagement=${p.engagement.toFixed(2)} | warmth~${hints.warmthBias.toFixed(2)} | ` +
    'SAFETY: professional boundaries; no dependency, guilt, or exaggerated intimacy.'
  );
}

function companionshipExpandedBlock(): string {
  const p = getProfile();
  const snap = getCompanionshipSessionSnapshot();
  const support = supportNotes();
  const cont = continuityHints();
  const check = maybeCheckInInstruction(p);
  const parts: string[] = [];

  if (snap.returningUser && snap.hoursSinceLastVisit > 2) {
    parts.push(
      'RETURNING_USER: If the user has not spoken yet, you may use one short warm Arabic line ' +
        '(e.g. رجعت! كيف كان يومك؟ / مرحباً مجدداً — كيف حالك؟). One sentence; skip if chat already started.',
    );
  }
  if (cont) parts.push(`CONTINUITY: ${cont}`);
  if (support.length) parts.push(`SUPPORT: ${support.join(' ')}`);
  if (check) parts.push(check);
  return parts.join(' | ');
}

/** Continuity from last topics / mood — light */
function continuityHints(): string {
  const p = getProfile();
  const recent = [...p.history].slice(-4).reverse();
  const topics = recent.map((e) => e.topicSnippet).filter(Boolean).slice(0, 2) as string[];
  const moods = [...new Set(recent.map((e) => e.emotion).filter(Boolean))].slice(0, 3);
  const parts: string[] = [];
  if (topics.length) {
    parts.push(`Recent thread keywords (do not over-quote): ${topics.map((t) => t.slice(0, 40)).join(' | ')}`);
  }
  if (moods.length) {
    parts.push(`Recent learner tones: ${moods.join(', ')}`);
  }
  return parts.join(' — ');
}

/**
 * Instruction block for `emotional_context` (bounded length).
 * Minimal line every turn; continuity / check-in / returning greeting only on sparse turns.
 */
export function getCompanionshipContextForPrompt(): string {
  let out = companionshipMinimalBlock();
  if (shouldExpandCompanionship()) {
    const ex = companionshipExpandedBlock();
    if (ex.trim()) out = `${out} || ${ex}`;
  }
  if (out.length > MAX_CONTEXT_CHARS) out = out.slice(0, MAX_CONTEXT_CHARS) + '…';
  return out;
}

/** Identity surface for UI/debug (anonymous key + counts). */
export function getUserIdentitySnapshot(): {
  anonymousUserKey: string;
  interactionCount: number;
  lastVisitMs: number;
} {
  const p = getProfile();
  const store = ensureStore();
  return {
    anonymousUserKey: p.userKey,
    interactionCount: p.interactionCount,
    lastVisitMs: store.lastVisitMs,
  };
}

export function mergeCompanionshipIntoEmotionalContext(emotionalSummary: string): string {
  const c = getCompanionshipContextForPrompt();
  if (!emotionalSummary.trim()) return c;
  return `${emotionalSummary} || ${c}`;
}

export function resetCompanionship(): void {
  _gapHoursSinceLastVisit = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  _store = defaultStore();
  _sessionSnapshot = buildSessionSnapshot();
  _dirty = true;
  flushCompanionship();
}
