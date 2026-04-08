/**
 * POST /api/voice-arabic — DEPRECATED
 *
 * OpenAI TTS (e.g. shimmer) is not part of the Jordanian (ar-JO) Azure/edge pipeline.
 * Arabic speech must use the backend: `/api/v1/tts-with-timing` or WebSocket TTS from Cogni.
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
      recommendation: 'POST /api/v1/tts-with-timing with text + emotion; configure AZURE_SPEECH_* on the API.',
    },
    { status: 410 },
  );
}
