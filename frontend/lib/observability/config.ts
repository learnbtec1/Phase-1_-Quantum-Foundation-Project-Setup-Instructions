/**
 * Opt-in observability — avoids overhead in production unless explicitly enabled.
 * Set NEXT_PUBLIC_COGNI_OBSERVABILITY=true in .env.local
 */
export function isObservabilityEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  return process.env.NEXT_PUBLIC_COGNI_OBSERVABILITY === 'true';
}
