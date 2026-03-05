/**
 * TTS API — use /api/tts-with-timing for lip-sync support.
 */
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Use /api/tts-with-timing for TTS with word timings' },
    { status: 400 }
  );
}
