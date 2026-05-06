/**
 * brainPersistence.ts
 * ──────────────────────────────────────────────────────────────
 * Persists Cogni's long-term memory and emotional context across
 * page reloads and sessions using localStorage.
 *
 * Stored keys:
 *   cogni:ltm   — longTermMemory (interests, importantMoments)
 *   cogni:ctx   — last session context (lastTopic, lastEmotion, ts)
 *
 * Usage:
 *   Call initBrainPersistence() once on app start to rehydrate.
 *   Call flushBrainPersistence() to save manually (also auto-saves
 *   on beforeunload and every 60 s).
 */

import { useBrainStore } from '@/store/useBrainStore';
import type { LongTermMemory } from '@/types/ai';
import {
  flushPersistentEmotionalMemory,
  initPersistentEmotionalMemory,
  resetPersistentEmotionalMemory,
} from '@/lib/avatar/emotionalMemory';
import {
  flushPersonalityEvolution,
  initPersonalityEvolution,
  resetPersonalityEvolution,
} from '@/lib/avatar/personalityEvolution';
import { flushOpinionEngine, initOpinionEngine, resetOpinionEngine } from '@/lib/avatar/opinionEngine';
import {
  flushCompanionship,
  initCompanionship,
  resetCompanionship,
} from '@/lib/avatar/companionship';
import {
  flushPersonalityMemory,
  initPersonalityMemory,
} from '@/ai/avatar/personalityMemory';
import { initCogniPersonalityResolverSideChannel } from '@/lib/avatar/resolveCogniPersonality';

const KEY_LTM = 'cogni:ltm';
const KEY_CTX = 'cogni:ctx';
const MAX_INTERESTS   = 40;
const MAX_MOMENTS     = 15;
const AUTO_SAVE_MS    = 60_000; // 1 minute

// ─── Session context ──────────────────────────────────────────────────────────

export interface PersistedSessionContext {
  lastTopic:   string;
  lastEmotion: string;
  /** ISO date string of last interaction */
  lastSeen:    string;
  /** Dominant emotion from last session trajectory */
  lastMood:    string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParse<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSave(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — silent */
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Rehydrate BrainStore from localStorage. Call once on mount. */
export function initBrainPersistence(): void {
  if (typeof window === 'undefined') return;

  initPersistentEmotionalMemory();
  initPersonalityEvolution();
  initPersonalityMemory();
  initCogniPersonalityResolverSideChannel();
  initOpinionEngine();

  // 1. Restore longTermMemory
  const savedLtm = safeParse<LongTermMemory>(KEY_LTM);
  if (savedLtm) {
    const store = useBrainStore.getState();
    // Merge: add any saved interests not currently in store
    const existing = new Set(store.longTermMemory.userInterests);
    const merged   = [...store.longTermMemory.userInterests];
    for (const kw of (savedLtm.userInterests ?? [])) {
      if (!existing.has(kw) && kw?.trim()) merged.push(kw);
    }
    // Restore important moments (latest MAX_MOMENTS)
    const moments = [
      ...(savedLtm.importantMoments ?? []),
      ...store.longTermMemory.importantMoments,
    ].slice(-MAX_MOMENTS);

    // Bulk-set via learnInterest + addImportantMoment path is too slow;
    // instead write directly using internal action
    for (const kw of merged.slice(0, MAX_INTERESTS)) {
      useBrainStore.getState().learnInterest(kw);
    }
    for (const m of moments) {
      useBrainStore.getState().addImportantMoment(m.description);
    }

    console.log(
      `[BrainPersist] Rehydrated: ${merged.length} interests, ${moments.length} moments`,
    );
  }

  // 2. Log last session context for debugging / future greeting
  const ctx = safeParse<PersistedSessionContext>(KEY_CTX);
  if (ctx) {
    const daysSince = (Date.now() - new Date(ctx.lastSeen).getTime()) / 86_400_000;
    console.log(
      `[BrainPersist] Last session: ${ctx.lastSeen}` +
      ` (${daysSince.toFixed(1)} days ago)` +
      ` | topic: "${ctx.lastTopic}"` +
      ` | mood: ${ctx.lastMood}`,
    );
    // Expose on window for AgentDirector to build a contextual greeting
    (window as unknown as Record<string, unknown>).__cogniLastSession = ctx;
  }

  if (process.env.NODE_ENV === 'development') {
    (window as unknown as Record<string, unknown>).__cogniResetPersistentEmotion = (): void => {
      resetPersistentEmotionalMemory();
      console.log('[BrainPersist] Persistent emotional memory cleared');
    };
    (window as unknown as Record<string, unknown>).__cogniResetPersonalityEvolution = (): void => {
      resetPersonalityEvolution();
      console.log('[BrainPersist] Personality evolution reset to baseline');
    };
    (window as unknown as Record<string, unknown>).__cogniResetOpinionEngine = (): void => {
      resetOpinionEngine();
      console.log('[BrainPersist] Opinion engine topic memory cleared');
    };
    (window as unknown as Record<string, unknown>).__cogniResetCompanionship = (): void => {
      resetCompanionship();
      console.log('[BrainPersist] Companionship session/visit counters reset');
    };
  }

  // 3. Auto-save every 60 s
  const intervalId = setInterval(flushBrainPersistence, AUTO_SAVE_MS);
  // 4. Save on tab close
  window.addEventListener('beforeunload', flushBrainPersistence);
  // Cleanup on HMR in dev — safe guard: module is not defined in browser ESM bundles
  // (Next.js Turbopack/Webpack both handle this differently; skip HMR dispose to avoid crash)
  try {
    // Only attempt if running inside a CommonJS/Webpack bundle that exposes `module`
    const mod = (typeof module !== 'undefined' ? module : null) as
      | { hot?: { dispose?: (cb: () => void) => void } }
      | null;
    if (typeof mod?.hot?.dispose === 'function') {
      mod.hot.dispose(() => {
        clearInterval(intervalId);
        window.removeEventListener('beforeunload', flushBrainPersistence);
      });
    }
  } catch {
    /* module not available in ESM/browser context — safe to ignore */
  }
}

/** Save current BrainStore longTermMemory → localStorage. */
export function flushBrainPersistence(): void {
  if (typeof window === 'undefined') return;
  const { longTermMemory, emotionLabel, emotionalMemory } =
    useBrainStore.getState();

  // Trim before saving to stay within quota
  const trimmed: LongTermMemory = {
    userInterests:    longTermMemory.userInterests.slice(-MAX_INTERESTS),
    importantMoments: longTermMemory.importantMoments.slice(-MAX_MOMENTS),
  };
  safeSave(KEY_LTM, trimmed);

  // Build session context from last emotional entry
  const last = emotionalMemory[emotionalMemory.length - 1];
  const ctx: PersistedSessionContext = {
    lastTopic:   last?.topic ?? '',
    lastEmotion: emotionLabel,
    lastSeen:    new Date().toISOString(),
    lastMood:    last?.userMood ?? 'neutral',
  };
  safeSave(KEY_CTX, ctx);
  flushPersistentEmotionalMemory();
  flushPersonalityEvolution();
  flushPersonalityMemory();
  flushOpinionEngine();
  flushCompanionship();
}

/** Returns last-session context (null if first ever session). */
export function getLastSessionContext(): PersistedSessionContext | null {
  return safeParse<PersistedSessionContext>(KEY_CTX);
}
