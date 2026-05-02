/**
 * Resolve FastAPI base URL for Next.js Route Handlers (server-only).
 * Production image: BACKEND_INTERNAL_URL (e.g. http://backend:8000).
 * Dev on host: NEXT_PUBLIC_API_URL often resolves localhost.
 */

function normalizeBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
}

export function backendBaseUrl(): string {
  const internal = process.env.BACKEND_INTERNAL_URL?.trim();
  const pub = process.env.NEXT_PUBLIC_API_URL?.trim();
  const fallback =
    process.env.TTS_BACKEND_BASE_URL?.trim() || 'http://127.0.0.1:8001';

  const picked =
    process.env.NODE_ENV === 'production'
      ? internal || pub || fallback
      : pub || internal || fallback;

  return normalizeBase(picked || fallback);
}
