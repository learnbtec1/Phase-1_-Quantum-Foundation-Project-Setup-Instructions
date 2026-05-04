'use client';
/**
 * __errorSniper.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Targeted per-call error catcher with optional debugger breakpoint.
 *
 * Usage:
 *   sniper("applyIntent", () => applyIntentMotionState(...));
 *   sniper("finalPose",   () => applyFinalPoseToVrm(...));
 *
 * On throw:  prints [SNIPER_HIT] tag + error, then hits `debugger` so DevTools
 *            pauses at the exact throw site (only when DevTools is open).
 *
 * Control flags (set in browser console):
 *   window.__sniperActive = true   // enable sniper globally
 *   window.__sniperTags   = ['applyIntent']   // only snipe specific tags
 */

function _isSniperActive(tag: string): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w.__sniperActive) return false;
  if (Array.isArray(w.__sniperTags) && w.__sniperTags.length > 0) {
    return (w.__sniperTags as string[]).includes(tag);
  }
  return true; // no filter → all tags
}

/**
 * Wraps fn() with a targeted try/catch.
 * - Prints [SNIPER_HIT] on first catch.
 * - Fires `debugger` (pauses DevTools) on the throwing frame.
 * - Returns undefined on failure (does not re-throw so frame continues).
 */
export function sniper(tag: string, fn: () => void): void {
  if (!_isSniperActive(tag)) {
    fn(); // zero-overhead when sniper is off
    return;
  }
  try {
    fn();
  } catch (e) {
    console.error('[SNIPER_HIT]', tag, e);
    // eslint-disable-next-line no-debugger
    debugger;
  }
}

/**
 * Activate / deactivate sniper from the browser console:
 *   activateSniper()               // all tags
 *   activateSniper(['finalPose'])  // only these tags
 *   deactivateSniper()
 */
export function activateSniper(tags?: string[]): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__sniperActive = true;
  if (tags) w.__sniperTags = tags;
  console.log('[SNIPER] activated', tags ? `for tags: ${tags.join(', ')}` : '(all tags)');
}

export function deactivateSniper(): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__sniperActive = false;
  console.log('[SNIPER] deactivated');
}
