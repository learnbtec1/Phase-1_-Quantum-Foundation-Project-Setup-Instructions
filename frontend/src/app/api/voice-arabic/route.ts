/**
 * POST /api/voice-arabic — DEPRECATED
 *
 * OpenAI TTS (e.g. shimmer) is not part of the Jordanian (ar-JO) pipeline.
 * Arabic speech must use the backend: `/api/v1/tts-with-timing` (Edge TTS) or WS agent TTS.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(_req: NextRequest) {
  console.warn(
    '[voice-arabic] OpenAI Arabic TTS disabled — use backend Jordanian pipeline (ar-JO-TaimNeural).',
  );
  return NextResponse.json(
    {
      error: 'Arabic TTS via OpenAI is disabled',
      message:
        'Use the backend /api/v1/tts-with-timing or Cogni WebSocket speech, which enforce ar-JO neural voices.',
      recommendation:
        'POST /api/v1/tts-with-timing with text + emotion; backend TTS_PROVIDER=edge + EDGE_TTS_VOICE (no OpenAI voice here).',
    },
    { status: 410 },
  );
}
