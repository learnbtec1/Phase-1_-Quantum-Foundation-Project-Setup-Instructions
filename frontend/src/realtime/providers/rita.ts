/**
 * RITA realtime provider adapter (stub when not configured).
 */
import type { RtSession, RtEvent } from '../adapter';

export function createRitaSession(): RtSession | null {
  const url = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_RITA_URL : undefined;
  if (!url) return null;
  return {
    async connect() {},
    disconnect() {},
    onEvent() {
      return () => {};
    },
    supportsTimings: true,
  };
}
