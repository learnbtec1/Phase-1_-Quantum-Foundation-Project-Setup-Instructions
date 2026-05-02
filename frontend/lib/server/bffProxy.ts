import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function truncateUpstreamDetail(s: string, maxLen = 2000): string {
  const t = String(s ?? '').trim();
  if (!t.length) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

export function extractUpstreamDetail(body: string): string {
  if (!body?.trim()) return '';
  try {
    const j = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const d = j.detail ?? j.message ?? j.error;
    if (typeof d === 'string') return truncateUpstreamDetail(d);
    return truncateUpstreamDetail(JSON.stringify(j));
  } catch {
    return truncateUpstreamDetail(body.slice(0, 4000));
  }
}

/** Map upstream HTTP codes to stable BFF statuses for JSON errors. */
export function resolveUpstreamErrorStatus(status: number): number {
  if (status === 408 || status === 429) return status;
  if (status === 503 || status === 502 || status === 504) return status;
  if (status >= 500) return Math.min(Math.max(status, 500), 504);
  if (status >= 400) return 502;
  return 502;
}

export type ResolveBearerResult =
  | { ok: true; authHeader?: string }
  | { ok: false; response: NextResponse };

/** Same opaque token contract as {@link authorizeTts.ts} emergency path (no import — avoids cycles). */
function emergencyDevOpaqueToken(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_DEV_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN?.trim();
  return fromEnv || 'test-token-123';
}

/**
 * Align with `authorizeTtsRequest` (`app/api/_shared/authorizeTts.ts`): dev bypass + guest env + Bearer.
 */
export function resolveIncomingBearerOrDevBypass(
  req: NextRequest,
): ResolveBearerResult {
  if (process.env.NEXT_PUBLIC_EMERGENCY_AUTH_FREEZE === 'true') {
    return { ok: true, authHeader: `Bearer ${emergencyDevOpaqueToken()}` };
  }
  if (process.env.COGNI_BFF_DEV_BYPASS_AUTH === 'true') {
    return { ok: true };
  }
  const guestOk =
    process.env.NEXT_PUBLIC_COGNI_WS_ALLOW_ANONYMOUS === 'true' ||
    process.env.NEXT_PUBLIC_COGNI_WS_GUEST_OK === 'true' ||
    process.env.NEXT_PUBLIC_AUTH_DEV_INJECT === 'true';
  if (guestOk) return { ok: true };

  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ') && auth.length > 12) {
    return { ok: true, authHeader: auth };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  };
}

/** Ref-era `tts-proxy` name — same semantics as {@link resolveIncomingBearerOrDevBypass}. */
export function requireIncomingBearer(req: NextRequest): ResolveBearerResult {
  return resolveIncomingBearerOrDevBypass(req);
}
