/**
 * Cogni Phase A — JWT in localStorage + API helpers.
 *
 * Security note (Phase 4): any XSS that executes in this origin can read `localStorage` and
 * exfiltrate the JWT. Mitigations on the frontend include strict CSP (see `next.config.js`),
 * sanitizing untrusted HTML before `dangerouslySetInnerHTML`, and minimizing inline scripts.
 * Long-term, prefer storing the session in HttpOnly + Secure + SameSite cookies (server-side
 * auth), which this codebase does not fully migrate to yet.
 */

const TOKEN_KEY = 'cogni_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
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
