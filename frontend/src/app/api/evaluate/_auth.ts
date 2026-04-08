import type { NextRequest } from 'next/server';

/** Bearer token from the incoming request (browser must forward JWT for server → backend calls). */
export function getBearerTokenFromRequest(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  if (h?.startsWith('Bearer ')) {
    const t = h.slice(7).trim();
    return t.length ? t : null;
  }
  return null;
}
