/**
 * Azure3D realtime provider adapter (stub when not configured).
 */
import type { RtSession } from '../adapter';

export function createAzure3DSession(): RtSession | null {
  const url = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_AZURE3D_URL : undefined;
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
