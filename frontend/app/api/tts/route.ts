/**
 * Canonical TTS is **`POST /api/tts-with-timing`** (BFF → FastAPI Edge neural).
 * This route rejects calls so callers get a deterministic contract (aligned with `/api/tts-proxy`).
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export async function POST() {
  const reqId = randomUUID();
  return NextResponse.json(
    {
      ok: false,
      error: 'tts_entrypoint_deprecated',
      detail:
        '[edge_primary] Use POST /api/tts-with-timing (Microsoft Edge neural TTS via FastAPI).',
      reqId,
    },
    { status: 410, headers: { 'X-Request-ID': reqId, 'Cache-Control': 'no-store' } },
  );
}
