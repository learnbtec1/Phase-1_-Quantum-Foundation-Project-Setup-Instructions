import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/bffAuth';
import { clientIpFromRequest, takeRateLimit } from '@/lib/server/simpleRateLimit';

/** Per-IP cap for Azure token minting (abuse protection on the BFF). */
const SPEECH_TOKEN_MAX_PER_WINDOW = 40;
const SPEECH_TOKEN_WINDOW_MS = 60_000;

/**
 * Short-lived Azure Speech authorization token for browser SDK (never ship the subscription key to the client).
 * Requires Authorization: Bearer <JWT> validated via Python GET /api/v1/auth/me.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) {
    return auth.response;
  }

  const ip = clientIpFromRequest(req);
  if (!takeRateLimit(`speech-token:${ip}`, SPEECH_TOKEN_MAX_PER_WINDOW, SPEECH_TOKEN_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim() || 'eastus';
  if (!key) {
    return NextResponse.json(
      { error: 'AZURE_SPEECH_KEY is not configured on the server' },
      { status: 503 },
    );
  }

  const res = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: body || res.statusText || String(res.status) },
      { status: res.status === 401 || res.status === 403 ? res.status : 502 },
    );
  }

  const token = await res.text();
  return NextResponse.json({ token, region });
}
