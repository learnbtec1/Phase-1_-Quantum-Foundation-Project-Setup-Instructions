/**
 * Cogni Phase A — JWT in localStorage + API helpers.
 *
 * Security note (Phase 4): any XSS that executes in this origin can read `localStorage` and
 * exfiltrate the JWT. Mitigations on the frontend include strict CSP (see `next.config.js`),
 * sanitizing untrusted HTML before `dangerouslySetInnerHTML`, and minimizing inline scripts.
 * Long-term, prefer storing the session in HttpOnly + Secure + SameSite cookies (server-side
 * auth), which this codebase does not fully migrate to yet.
 */

/** Canonical localStorage key for the access JWT (legacy fallback: `token`). */
export const COGNI_ACCESS_TOKEN_KEY = 'cogni_access_token';

const TOKEN_KEY = COGNI_ACCESS_TOKEN_KEY;

/**
 * Dev-only: set `NEXT_PUBLIC_AUTH_DEV_INJECT=true` and optionally `NEXT_PUBLIC_DEV_AUTH_TOKEN`
 * (must match backend dev bypass if used). Never enable in production builds.
 */
export function bootstrapAuthLifecycle(): void {
  if (typeof window === 'undefined') return;

  const devInject =
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_AUTH_DEV_INJECT === 'true';

  if (devInject) {
    const existing = (localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem('token') ?? '').trim();
    if (!existing) {
      const placeholder = (process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN ?? '').trim();
      if (placeholder) {
        localStorage.setItem(TOKEN_KEY, placeholder);
        // eslint-disable-next-line no-console
        console.warn('[AUTH] ⚠️ Injected dev token from NEXT_PUBLIC_DEV_AUTH_TOKEN');
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '[AUTH] NEXT_PUBLIC_AUTH_DEV_INJECT is true but NEXT_PUBLIC_DEV_AUTH_TOKEN is empty — not injecting a dummy token (use real login JWT).',
        );
      }
    }
  }

  const raw = localStorage.getItem(TOKEN_KEY);
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log('[AUTH INIT]', raw ?? '(empty)');
  } else {
    // eslint-disable-next-line no-console
    console.log('[AUTH INIT]', raw ? `present (${raw.length} chars)` : '(empty)');
  }
}

function readRawTokenFromStorage(): string {
  if (typeof window === 'undefined') return '';
  const raw = localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem('token');
  return (raw ?? '').trim();
}

/** True if a non-empty string exists under `cogni_access_token` or legacy `token` (before expiry/parse checks). */
export function hasStoredAccessToken(): boolean {
  return readRawTokenFromStorage().length > 0;
}

/** Seconds since epoch from JWT `exp`, or null if not a standard JWT / no exp. */
function jwtExpirySeconds(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const json = JSON.parse(atob(b64)) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

const CLOCK_SKEW_SEC = 60;

let _lastEmptyLogMs = 0;

/**
 * Returns the active access token, or `null` if missing / expired / malformed JWT.
 * Opaque (non-JWT) tokens are returned as-is when they do not look like a broken JWT.
 */
export function getAccessToken(): string | null {
  const t = readRawTokenFromStorage();
  if (!t) {
    const now = Date.now();
    if (now - _lastEmptyLogMs > 8000) {
      console.error('[Auth] ❌ Token missing or invalid', { reason: 'empty' });
      _lastEmptyLogMs = now;
    }
    return null;
  }

  const parts = t.split('.');
  if (parts.length === 3) {
    const exp = jwtExpirySeconds(t);
    if (exp !== null && Date.now() / 1000 >= exp - CLOCK_SKEW_SEC) {
      console.error('[Auth] ❌ Token missing or invalid', { reason: 'expired' });
      return null;
    }
    if (exp === null) {
      try {
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);
        JSON.parse(atob(b64));
      } catch {
        console.error('[Auth] ❌ Token missing or invalid', { reason: 'malformed_jwt' });
        return null;
      }
    }
  }

  return t;
}

export function setAccessToken(token: string): void {
  const tok = token.trim();
  if (!tok) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, tok);
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function notifyAuthChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('cogni:auth-changed'));
}

export function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}
