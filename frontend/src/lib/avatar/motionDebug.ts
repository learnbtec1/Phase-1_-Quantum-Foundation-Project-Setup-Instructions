import { isDebugMotion } from '@/lib/logging/runtimeLog';

/** Motion trace — only when motion debug env is on (avoids useFrame console spam). */
export function motionDebug(...args: unknown[]): void {
  if (!isDebugMotion()) return;
  // eslint-disable-next-line no-console -- gated verbose motion
  console.log('[DEBUG][MOTION]', ...args);
}
