/**
 * Avatar debug output — default quiet; set NEXT_PUBLIC_DEBUG_AVATAR=true to enable verbose logs.
 * Does not affect console.error / console.warn (call those directly for failures).
 */
export const DEBUG_AVATAR =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_AVATAR === 'true';

export function avatarDebug(...args: unknown[]): void {
  if (DEBUG_AVATAR) console.log(...args);
}
