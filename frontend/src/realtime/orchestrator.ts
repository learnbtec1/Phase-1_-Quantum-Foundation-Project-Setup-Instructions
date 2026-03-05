/**
 * Realtime orchestrator: registry + feature flags + graceful fallback.
 * Reads NEXT_PUBLIC_REALTIME_ENABLED and NEXT_PUBLIC_REALTIME_PROVIDER.
 * Emits avatar:speak with timings or audio; falls back to /api/chat + /api/tts.
 */
import type { RtProvider, RtSession, RtEvent } from './adapter';
import { createRitaSession } from './providers/rita';
import { createGoogleSession } from './providers/google';
import { createGeminiSession } from './providers/gemini';
import { createDockerSession } from './providers/docker';
import { createAzure3DSession } from './providers/azure3d';

const PROVIDER_ORDER: RtProvider[] = ['rita', 'google', 'gemini', 'docker', 'azure3d'];
const FACTORIES: Record<RtProvider, () => RtSession | null> = {
  rita: createRitaSession,
  google: createGoogleSession,
  gemini: createGeminiSession,
  docker: createDockerSession,
  azure3d: createAzure3DSession,
};

function isRealtimeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const v = process.env.NEXT_PUBLIC_REALTIME_ENABLED;
  return v === '1' || v === 'true' || v === 'yes';
}

function getPreferredProvider(): RtProvider | null {
  const p = process.env.NEXT_PUBLIC_REALTIME_PROVIDER as RtProvider | undefined;
  if (p && PROVIDER_ORDER.includes(p)) return p;
  return null;
}

function detectProvider(): RtProvider | null {
  const preferred = getPreferredProvider();
  if (preferred && FACTORIES[preferred]()) return preferred;
  for (const name of PROVIDER_ORDER) {
    if (FACTORIES[name]()) return name;
  }
  return null;
}

export function getRealtimeSession(): RtSession | null {
  if (!isRealtimeEnabled()) return null;
  const provider = detectProvider();
  if (!provider) return null;
  return FACTORIES[provider]();
}

export function emitAvatarSpeak(detail: { timings?: unknown[]; sampleRate?: number; audio?: HTMLAudioElement }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar:speak', { detail }));
}

export function isRealtimeAvailable(): boolean {
  return !!getRealtimeSession();
}
