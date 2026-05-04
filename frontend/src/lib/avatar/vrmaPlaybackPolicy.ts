'use client';

/**
 * HARDCODED KILL SWITCH — env-var reading removed.
 *
 * VRMA mixer playback proved to hijack `motionSource` and suppress procedural
 * motion even when the relevant `.env` flags were set, due to Next.js build-time
 * caching of `process.env` values. Both functions are hard-wired to `true` so
 * the procedural-only policy is guaranteed regardless of the build cache.
 *
 * To re-enable VRMA in future: revert this file and set the env vars.
 */

export function isVrmaPlaybackGloballyDisabled(): boolean {
  return true; // HARDCODED: VRMA permanently off — procedural-only mode
}

export function isProceduralOnlyMotion(): boolean {
  return true; // HARDCODED: procedural-only mode active
}
