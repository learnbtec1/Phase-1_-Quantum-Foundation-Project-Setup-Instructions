/**
 * Google/Whisper realtime provider adapter (stub when not configured).
 */
import type { RtSession } from '../adapter';

export function createGoogleSession(): RtSession | null {
  const key = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_GOOGLE_REALTIME_KEY : undefined;
  if (!key) return null;
  return {
    async connect() {},
    disconnect() {},
    onEvent() {
      return () => {};
    },
    supportsTimings: false,
  };
}
