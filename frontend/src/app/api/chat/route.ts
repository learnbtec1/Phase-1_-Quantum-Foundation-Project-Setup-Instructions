/**
 * Chat bridge (Pure Proxy): forwards to backend POST /api/v1/chat
 * NO LOCAL PROMPTS. NO SPLIT BRAIN.
 * Requires Authorization: Bearer (validated by Python API). Forwards same header upstream.
 *
 * Upstream errors: see @/lib/server/bffProxy (status passthrough + truncated detail).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  forwardUpstreamJson,
  requireIncomingBearer,
} from '@/lib/server/bffProxy';

const MAX_MESSAGE_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  const reqId = randomUUID();
  const traceHeaders: Record<string, string> = { 'X-Request-ID': reqId };

  const bearer = requireIncomingBearer(req);
  if (!bearer.ok) return bearer.response;

  try {
    const payload = await req.json();
    const raw = typeof payload?.message === 'string' ? payload.message : '';
    const message = raw.trim().slice(0, MAX_MESSAGE_LENGTH);

    if (!message) {
      return NextResponse.json(
        { error: 'Empty message', reqId },
        { status: 400, headers: traceHeaders },
      );
    }

    const base = backendBaseUrl();
    const upstream =
      process.env.CHAT_BACKEND_URL ||
      `${base}/api/v1/chat`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(upstream, {
      method: 'POST',
      headers: {
        Authorization: bearer.authHeader,
        'Content-Type': 'application/json',
        'X-Request-ID': reqId,
      },
      body: JSON.stringify({
        message,
        history: Array.isArray(payload?.history) ? payload.history : [],
        context: payload?.context || {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return forwardUpstreamJson(res, { reqId, mergeIntoBody: { reqId } });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      {
        error: isTimeout
          ? 'Timeout contacting upstream backend'
          : 'Server proxy error',
        reqId,
      },
      { status: isTimeout ? 408 : 503, headers: traceHeaders },
    );
  }
}
