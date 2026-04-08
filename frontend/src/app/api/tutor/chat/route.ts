/**
 * جسر محادثة المعلم — يوجّه الطلبات إلى الباكند (FastAPI).
 * Requires Authorization: Bearer (validated by Python API).
 */
import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/server/bffAuth';
import {
  extractUpstreamDetail,
  requireIncomingBearer,
  resolveUpstreamErrorStatus,
} from '@/lib/server/bffProxy';

export async function POST(req: NextRequest) {
  const bearer = requireIncomingBearer(req);
  if (!bearer.ok) return bearer.response;

  try {
    const body = await req.json();
    const { message, context = {} } = body;
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json(
        { error: 'message is required and must be non-empty' },
        { status: 400 },
      );
    }
    const base = backendBaseUrl();
    const res = await fetch(`${base}/api/v1/tutor/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer.authHeader,
      },
      body: JSON.stringify({ message: message.trim(), context }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = extractUpstreamDetail(text);
      return NextResponse.json(
        { error: 'Tutor request failed', detail },
        { status: resolveUpstreamErrorStatus(res.status) },
      );
    }
    const data = (await res.json().catch(() => ({}))) as { response?: string };
    return NextResponse.json({ response: data.response ?? '' });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('Tutor chat bridge error:', e);
    return NextResponse.json(
      { error: truncateForClient(message) },
      { status: 500 },
    );
  }
}

function truncateForClient(s: string, max = 300): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
