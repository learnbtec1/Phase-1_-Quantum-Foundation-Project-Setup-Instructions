import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getBearerTokenFromRequest } from '@/app/api/evaluate/_auth';

/** Python API base for server-side BFF verification (prefer BACKEND_URL over public URL). */
export function backendBaseUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://127.0.0.1:8000'
  ).replace(/\/$/, '');
}

export async function verifyBearerWithBackend(
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number }> {
  const base = backendBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 503 };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 401 };
  }
  if (!res.ok) {
    return { ok: false, status: 503 };
  }

  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  const userId = data?.id;
  if (!userId || typeof userId !== 'string') {
    return { ok: false, status: 503 };
  }
  return { ok: true, userId };
}

export type AuthResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Requires `Authorization: Bearer <JWT>` and validates it against the Python backend `/api/v1/auth/me`.
 */
export async function requireAuthenticatedUser(
  req: NextRequest,
): Promise<AuthResult> {
  const token = getBearerTokenFromRequest(req);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing or invalid Authorization Bearer token' },
        { status: 401 },
      ),
    };
  }

  const v = await verifyBearerWithBackend(token);
  if (!v.ok) {
    const status = v.status === 503 ? 503 : 401;
    const message =
      status === 503
        ? 'Authentication service unavailable'
        : 'Invalid or expired token';
    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status }),
    };
  }

  return { ok: true, token, userId: v.userId };
}

/** In production, AI BFF routes stay off unless ENABLE_PUBLIC_AI_ROUTES=true (still need Bearer). */
export function blockAiBffUnlessEnabledInProduction(): NextResponse | null {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_PUBLIC_AI_ROUTES !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}

/** In production, avatar-config API stays off unless ENABLE_AVATAR_CONFIG_API=true. */
export function blockAvatarConfigUnlessEnabledInProduction(): NextResponse | null {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_AVATAR_CONFIG_API !== 'true'
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
