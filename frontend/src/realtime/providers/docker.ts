/**
 * Avatar_Docker realtime provider adapter (stub when not configured).
 */
import type { RtSession } from '../adapter';

export function createDockerSession(): RtSession | null {
  const url = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_AVATAR_DOCKER_URL : undefined;
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
