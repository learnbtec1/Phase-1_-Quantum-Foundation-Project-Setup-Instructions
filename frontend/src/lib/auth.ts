/**
 * Cogni Phase A — JWT in localStorage + API helpers.
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
