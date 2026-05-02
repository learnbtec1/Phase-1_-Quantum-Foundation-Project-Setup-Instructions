/**
 * Legacy TTS proxy — use **`POST /api/tts-with-timing`** instead (Edge neural TTS BFF → FastAPI).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export async function POST(req: NextRequest) {
  void req;
  const reqId = randomUUID();
  // eslint-disable-next-line no-console
  console.warn('[tts-proxy] legacy route — redirect clients to POST /api/tts-with-timing', reqId);
  return NextResponse.json(
    {
      ok: false,
      error: 'tts_proxy_legacy',
      detail: '[edge_primary] Use POST /api/tts-with-timing.',
      reqId,
    },
    { status: 410, headers: { 'X-Request-ID': reqId, 'Cache-Control': 'no-store' } },
  );
}
