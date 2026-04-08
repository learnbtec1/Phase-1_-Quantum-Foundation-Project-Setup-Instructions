import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getBearerTokenFromRequest } from '@/app/api/evaluate/_auth';

/**
 * BFF → Python upstream status policy:
 * - Forward as-is: 400, 401, 403, 404, 408, 409, 422, 429, 502, 503
 * - Other 5xx from upstream: map to 502 (avoid leaking internal error taxonomy)
 * - Response bodies: truncate detail to MAX_DETAIL chars (no full stack traces)
 */
export const MAX_UPSTREAM_DETAIL_CHARS = 300;

export function truncateUpstreamDetail(text: string): string {
  const t = text.trim();
  const m = MAX_UPSTREAM_DETAIL_CHARS;
  return t.length <= m ? t : `${t.slice(0, m)}…`;
}

export function extractUpstreamDetail(bodyText: string): string {
  let detail = truncateUpstreamDetail(bodyText);
  try {
    const j = JSON.parse(bodyText) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    if (typeof j.detail === 'string') {
      detail = truncateUpstreamDetail(j.detail);
    } else if (j.detail != null) {
      detail = truncateUpstreamDetail(String(j.detail));
    } else if (typeof j.message === 'string') {
      detail = truncateUpstreamDetail(j.message);
    } else if (typeof j.error === 'string') {
      detail = truncateUpstreamDetail(j.error);
    }
  } catch {
    /* plain text */
  }
  return detail;
}

export function resolveUpstreamErrorStatus(upstreamStatus: number): number {
  const forward = new Set([
    400, 401, 403, 404, 408, 409, 422, 429, 502, 503,
  ]);
  if (forward.has(upstreamStatus)) return upstreamStatus;
  if (upstreamStatus >= 500) return 502;
  if (upstreamStatus >= 400) return upstreamStatus;
  return 502;
}

export type IncomingBearerResult =
  | { ok: true; authHeader: string }
  | { ok: false; response: NextResponse };

/** Require non-empty Bearer; validation is performed by the Python API. */
export function requireIncomingBearer(req: NextRequest): IncomingBearerResult {
  const token = getBearerTokenFromRequest(req);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing Authorization Bearer token' },
        { status: 401 },
      ),
    };
  }
  return { ok: true, authHeader: `Bearer ${token}` };
}

/**
 * Upstream 2xx JSON response; merges `mergeIntoBody` into parsed object on success.
 */
export async function forwardUpstreamJson(
  upstream: Response,
  options?: { reqId?: string; mergeIntoBody?: Record<string, unknown> },
): Promise<NextResponse> {
  const text = await upstream.text();
  if (upstream.ok) {
    try {
      const data = text ? JSON.parse(text) : {};
      const merged =
        options?.mergeIntoBody &&
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data)
          ? { ...data, ...options.mergeIntoBody }
          : data;
      return NextResponse.json(merged, { status: upstream.status });
    } catch {
      return NextResponse.json(
        {
          error: 'Invalid upstream JSON',
          detail: truncateUpstreamDetail(text),
          ...(options?.reqId ? { reqId: options.reqId } : {}),
        },
        { status: 502 },
      );
    }
  }

  const detail = extractUpstreamDetail(text);
  const status = resolveUpstreamErrorStatus(upstream.status);
  const payload: Record<string, unknown> = {
    error: 'Upstream request failed',
    detail,
  };
  if (options?.reqId) payload.reqId = options.reqId;
  return NextResponse.json(payload, { status });
}
