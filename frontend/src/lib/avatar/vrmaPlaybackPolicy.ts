'use client';

/**
 * When `NEXT_PUBLIC_DISABLE_VRMA` is truthy, all pre-baked `.vrma` mixer playback is bypassed.
 * Procedural layers (breathing, blink, lip-sync, lookAt) stay active — only macro skeleton tracks from VRMA stop.
 */
export function isVrmaPlaybackGloballyDisabled(): boolean {
  const v = (process.env.NEXT_PUBLIC_DISABLE_VRMA ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
