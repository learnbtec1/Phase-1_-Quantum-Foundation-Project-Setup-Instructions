/**
 * Cogni Phase A — JWT in localStorage + API helpers.
 *
 * Security note (Phase 4): any XSS that executes in this origin can read `localStorage` and
 * exfiltrate the JWT. Mitigations on the frontend include strict CSP (see `next.config.js`),
 * sanitizing untrusted HTML before `dangerouslySetInnerHTML`, and minimizing inline scripts.
 * Long-term, prefer storing the session in HttpOnly + Secure + SameSite cookies (server-side
 * auth), which this codebase does not fully migrate to yet.
 */

import { cogniVerbose, cogniVerboseWarn } from '@/lib/cogniVerbose';

/** Canonical localStorage key for the access JWT (legacy fallback: `token`). */
export const COGNI_ACCESS_TOKEN_KEY = 'cogni_access_token';

/** Optional JSON blob for tooling — not used by AuthGuard (session is cookie/API). */
export const DEV_USER_STORAGE_KEY = 'eduvor_dev_user_json';

const TOKEN_KEY = COGNI_ACCESS_TOKEN_KEY;

/**
 * When NEXT_PUBLIC_EMERGENCY_AUTH_FREEZE=true, edge + guards skip enforced login — dev only,
 * bundled at build time. Pair with backend AUTH_DEV_BYPASS.
 */
export function isEmergencyAuthFreeze(): boolean {
  return typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EMERGENCY_AUTH_FREEZE === 'true';
}

/**
 * True when emergency dev bypass may run: NEXT_PUBLIC_AUTH_DEV_INJECT=true and host is
 * localhost / loopback OR NODE_ENV is development (never rely on hostname alone for prod builds).
 */
export function isAuthDevBypassAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_AUTH_DEV_INJECT !== 'true') return false;
  const h = window.location.hostname;
  const loopback =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]';
  const devEnv = process.env.NODE_ENV === 'development';
  return loopback || devEnv;
}

/**
 * Shared opaque dev/demo token baked at build (`NEXT_PUBLIC_DEV_TOKEN` preferred).
 * Fallback: `NEXT_PUBLIC_DEV_AUTH_TOKEN` (legacy alias). Must match backend
 * `AUTH_DEV_STATIC_TOKEN` when `AUTH_DEV_BYPASS=true`.
 */
export function getPublicDevOpaqueToken(): string {
  const t =
    (process.env.NEXT_PUBLIC_DEV_TOKEN ?? process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN ?? '')
      .trim();
  return t || 'test-token-123';
}

/**
 * Golden Ticket: writes opaque token to localStorage + non-HttpOnly session cookie so Next.js
 * middleware and FastAPI both see the same session id. Backend must enable AUTH_DEV_BYPASS +
 * AUTH_DEV_STATIC_TOKEN for opaque tokens (see README.md).
 */

export function applyDevAuthGoldenTicket(): boolean {
  if (!isAuthDevBypassAllowed()) return false;
  const token = getPublicDevOpaqueToken();
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('token', token);
    localStorage.setItem(
      DEV_USER_STORAGE_KEY,
      JSON.stringify({ email: 'admin@example.com', role: 'admin' }),
    );
    const maxAgeSec = 60 * 60 * 24 * 7;
    const cookieName =
      (process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME ?? 'eduvor_token').trim() || 'eduvor_token';
    document.cookie = `${cookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
    cogniVerboseWarn('[AUTH] ⚠️ Dev Golden Ticket applied — localhost / dev only');
    notifyAuthChanged();
    return true;
  } catch {
    return false;
  }
}

/**
 * Dev-only: set `NEXT_PUBLIC_AUTH_DEV_INJECT=true`. Never enable on public deployments.
 */
export function bootstrapAuthLifecycle(): void {
  if (typeof window === 'undefined') return;

  if (isAuthDevBypassAllowed()) {
    applyDevAuthGoldenTicket();
  }

  const raw = localStorage.getItem(TOKEN_KEY);
  cogniVerbose(
    '[AUTH INIT]',
    process.env.NODE_ENV === 'development'
      ? raw ?? '(empty)'
      : raw
        ? `present (${raw.length} chars)`
        : '(empty)',
  );
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
    if (!isEmergencyAuthFreeze()) {
      const now = Date.now();
      if (now - _lastEmptyLogMs > 8000) {
        console.error('[Auth] ❌ Token missing or invalid', { reason: 'empty' });
        _lastEmptyLogMs = now;
      }
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

/** Absolute backend origin for legacy fetch paths — MUST align with NEXT_PUBLIC_API_URL (default :8001). */
export function apiBase(): string {
  const explicit =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const stripped = base?.replace(/\/api\/v1\/?$/i, "").trim() || "";
  const origin = explicit || stripped || "http://127.0.0.1:8001";
  return origin.replace(/\/+$/, "");
}
