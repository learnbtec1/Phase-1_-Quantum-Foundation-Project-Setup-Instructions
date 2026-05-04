'use client';
/**
 * __avatarErrorTracker.ts
 * ─────────────────────────────────────────────────────────────────────────
 * PHASE 1 – System Hardening  : safeCall, assertOrLog, trackAvatarError
 * PHASE 2 – Behavior Link     : errorState (active, severity, disabledLayers)
 * PHASE 3 – Self-Healing      : health score, retry window, auto-recovery
 *
 * ALL runtime side-effects are gated behind AVATAR_DEBUG or AVATAR_SAFE_MODE.
 * This file MUST NOT import Three.js, React, or any avatar pipeline module.
 */

// ── Gate flags ─────────────────────────────────────────────────────────────
export const AVATAR_DEBUG =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_AVATAR_DEBUG === 'true';

/** AVATAR_SAFE_MODE is always-on: keeps safeCall + layer-disable active without
 *  verbose debug logging.  Set to false only if you need zero overhead. */
export const AVATAR_SAFE_MODE = true;

// ── Phase 2: Error state ────────────────────────────────────────────────────
export const errorState: {
  active:           boolean;
  lastError:        string | null;
  severity:         number;        // 0=none 1=minor 2=major 3=critical
  disabledLayers:   Set<string>;
  lastErrorTimeMs:  number;
} = {
  active:          false,
  lastError:       null,
  severity:        0,
  disabledLayers:  new Set(),
  lastErrorTimeMs: 0,
};

// ── Phase 3: Health internals ───────────────────────────────────────────────
let _errorCount = 0;
const _seen     = new Set<string>();
const _retryMap = new Map<string, number>(); // tag → retryAfterMs timestamp

function _health(): number {
  return Math.max(0.3, Math.min(1.0, 1 - _errorCount * 0.05));
}

export function getErrorCount(): number  { return _seen.size; }
export function getHealthScore(): number { return _health(); }

// ── Phase 1: Core error capture ─────────────────────────────────────────────
export function trackAvatarError(tag: string, err: unknown, ctx?: unknown): void {
  const key = `${tag}:${(err as Error)?.message ?? String(err)}`;
  const isNew = !_seen.has(key);
  if (isNew) {
    _seen.add(key);
    _errorCount++;
    // Always print errors — even in production.
    console.error(`[AVATAR_ERROR:${tag}]`, err, ctx ?? '');
  }

  // Phase 2: update errorState on every error call (not just first occurrence)
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  errorState.active        = true;
  errorState.lastError     = key;
  errorState.lastErrorTimeMs = now;
  errorState.severity      = Math.min(3, errorState.severity + (isNew ? 1 : 0));

  // Disable the faulty layer if severity is major or above
  if (errorState.severity >= 2 && !errorState.disabledLayers.has(tag)) {
    errorState.disabledLayers.add(tag);
    if (AVATAR_DEBUG) {
      console.warn(`[AVATAR_AUDIT:BEHAVIOR_LINK] Layer "${tag}" disabled (severity ${errorState.severity})`);
    }
  }
}

// ── Phase 3: Retry window ───────────────────────────────────────────────────
function _scheduleRetry(tag: string): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  _retryMap.set(tag, now + 500); // retry after 500 ms
}

/** Returns true when the layer should be skipped this frame (still in retry window). */
export function isLayerDisabled(tag: string): boolean {
  if (!errorState.disabledLayers.has(tag)) return false;
  const retryAt = _retryMap.get(tag) ?? 0;
  const now     = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now >= retryAt) {
    // Retry window elapsed — re-enable layer
    errorState.disabledLayers.delete(tag);
    _retryMap.delete(tag);
    if (AVATAR_DEBUG) {
      console.log(`[SELF_HEALING] Layer "${tag}" re-enabled after retry window.`);
    }
    return false;
  }
  return true;
}

// ── Phase 3: Self-healing tick (call once per frame) ───────────────────────
export function tickSelfHealing(): void {
  if (!errorState.active) return;
  const now           = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const msSinceLast   = now - errorState.lastErrorTimeMs;
  if (msSinceLast >= 3000) {
    errorState.active   = false;
    errorState.severity = 0;
    errorState.disabledLayers.clear();
    _retryMap.clear();
    if (AVATAR_DEBUG) {
      console.log('[SELF_HEALING] System fully recovered. Health:', _health().toFixed(2));
    }
  }
}

// ── Phase 1: safeCall — wraps any layer call ────────────────────────────────
export function safeCall<T>(tag: string, fn: () => T, fallback: T): T {
  if (!AVATAR_SAFE_MODE) return fn(); // zero-overhead escape hatch

  // Phase 2: skip disabled layer (pending retry window)
  if (isLayerDisabled(tag)) return fallback;

  try {
    return fn();
  } catch (e) {
    trackAvatarError(tag, e);
    _scheduleRetry(tag);
    return fallback;
  }
}

// ── Phase 1: Non-throwing assertion ─────────────────────────────────────────
/** Logs [AVATAR_ASSERT:<tag>] on failure. Never throws. Always prints. */
export function assertOrLog(condition: boolean, tag: string): void {
  if (!condition) {
    console.warn(`[AVATAR_ASSERT:${tag}]`);
  }
}
