/** Motion trace — only when `NEXT_PUBLIC_DEBUG_MOTION=true` (avoids useFrame console spam). */
export function motionDebug(...args: unknown[]): void {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_MOTION === 'true') {
    // eslint-disable-next-line no-console
    console.log('[MOTION]', ...args);
  }
}
