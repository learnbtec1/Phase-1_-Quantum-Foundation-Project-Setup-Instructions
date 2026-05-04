'use client';

import { getMicStreamSafe } from '@/hooks/useVAD';
import { logStep } from '@/utils/diagnostics';

/**
 * Acquire mic with same Edge-safe path as production VAD (strict constraints → `{ audio: true }` fallback).
 * Caller should stop tracks when done (`stream.getTracks().forEach((t) => t.stop())`).
 */
export async function testMic(): Promise<MediaStream> {
  logStep('MIC_ACCESS', 'START');

  try {
    const stream = await getMicStreamSafe();
    logStep('MIC_ACCESS', 'SUCCESS', {
      streamId: stream.id,
      trackCount: stream.getAudioTracks().length,
      label: stream.getAudioTracks()[0]?.label ?? '',
    });
    return stream;
  } catch (err) {
    logStep('MIC_ACCESS', 'FAIL', err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
