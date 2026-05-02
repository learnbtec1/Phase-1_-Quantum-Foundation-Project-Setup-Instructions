/**
 * Deprecated: ElevenLabs BFF disabled — stack uses Edge TTS via `/api/tts-with-timing`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export async function POST(req: NextRequest) {
  void req;
  const reqId = randomUUID();
  // eslint-disable-next-line no-console
  console.warn('[tts-elevenlabs BLOCKED]', 'Edge-only TTS stack — use POST /api/tts-with-timing.', reqId);
  return NextResponse.json(
    {
      error: 'elevenlabs_route_disabled',
      detail: '[edge_only] Use POST /api/tts-with-timing (Microsoft Edge neural TTS via FastAPI).',
      reqId,
    },
    { status: 410, headers: { 'X-Request-ID': reqId } },
  );
}
