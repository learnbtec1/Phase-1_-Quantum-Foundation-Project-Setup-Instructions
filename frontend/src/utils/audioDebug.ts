'use client';

import { getSharedAudioContext, resumeSharedAudioContext } from '@/lib/audio/avatarAudioContext';
import { logStep } from '@/utils/diagnostics';

/**
 * Validates the shared app AudioContext (same instance as LipSync/TTS graphs).
 */
export async function testAudioContext(): Promise<AudioContext | null> {
  logStep('AUDIO_CONTEXT', 'START');

  try {
    const ctx = getSharedAudioContext();
    if (!ctx) {
      throw new Error('getSharedAudioContext() returned null (unsupported environment?)');
    }
    await resumeSharedAudioContext();
    logStep('AUDIO_CONTEXT', 'SUCCESS', {
      state: ctx.state,
      sampleRate: ctx.sampleRate,
    });
    return ctx;
  } catch (err) {
    logStep('AUDIO_CONTEXT', 'FAIL', err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
