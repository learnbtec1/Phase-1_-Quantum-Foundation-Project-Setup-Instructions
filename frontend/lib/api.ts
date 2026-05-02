import { getAccessToken, setAccessToken } from "@/lib/auth";

/** Prefer NEXT_PUBLIC_API_URL; NEXT_PUBLIC_BACKEND_URL; or NEXT_PUBLIC_API_BASE_URL without /api/v1 suffix. */
function resolveConfiguredBackendOrigin(): string {
  const a = process.env.NEXT_PUBLIC_API_URL?.trim();
  const b = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const stripped =
    base?.replace(/\/api\/v1\/?$/i, "").trim() ||
    "";
  return a || b || stripped || "http://localhost:8001";
}

function normalizeOrigin(s: string): string {
  let base = s.trim().replace(/\/+$/, "");
  if (base.endsWith("/api/v1")) base = base.replace("/api/v1", "");
  return base;
}

/**
 * Base URL for JSON API.
 * - In the **browser** return `""` so requests go to same origin (`/api/v1/...`); `next.config.js` rewrites
 *   to FastAPI and **avoids CORS** (cross-port localhost). HttpOnly session cookies are sent.
 * - On the **server** (if ever) use the configured backend origin; Docker uses `BACKEND_INTERNAL_URL`.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  const internal =
    process.env.BACKEND_INTERNAL_URL?.trim() || resolveConfiguredBackendOrigin();
  return normalizeOrigin(internal);
}

/**
 * API URL. In the **browser** always use same origin (path only) so the HttpOnly `eduvor_token`
 * cookie is included; do not call the API host directly on a different port.
 */
export function getBackendUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined") {
    return p;
  }
  const origin = normalizeOrigin(
    process.env.BACKEND_INTERNAL_URL?.trim() || resolveConfiguredBackendOrigin(),
  );
  return `${origin}${p}`;
}

/**
 * API fetch with **HttpOnly session**: always `credentials: "include"` and JSON Accept by default.
 * @param path — must start with `/` (e.g. `/api/v1/auth/me`). Browser `getApiBase()` is `""` so the path is same-origin.
 */
export async function fetchWithSession(path: string, options: RequestInit = {}): Promise<Response> {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;

  const nextHeaders = new Headers(options.headers);
  if (!nextHeaders.has("Accept")) {
    nextHeaders.set("Accept", "application/json");
  }
  if (typeof window !== "undefined" && !nextHeaders.has("Authorization")) {
    const bearer = getAccessToken();
    if (bearer) {
      nextHeaders.set("Authorization", `Bearer ${bearer}`);
    }
  }

  return fetch(url, {
    ...options,
    credentials: "include",
    headers: nextHeaders,
  });
}

/** Legacy localStorage key — cleared once per tab; session uses HttpOnly cookie. */
export const TOKEN_KEY = "eduvor_token";

/** Avoid duplicate POST /auth/logout from Strict Mode double-invoke or rapid redirects (~401 loops). */
let _lastLogoutPostAtMs = 0;
const LOGOUT_POST_DEBOUNCE_MS = 2000;

function postLogoutToClearHttpOnlyCookie(): void {
  if (typeof window === "undefined") {
    return;
  }
  const now = Date.now();
  if (now - _lastLogoutPostAtMs < LOGOUT_POST_DEBOUNCE_MS) {
    return;
  }
  _lastLogoutPostAtMs = now;
  const url = `${getApiBase()}/api/v1/auth/logout`;
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
}

/**
 * HttpOnly login cookie cannot be read by JS — Cogni WS sends `auth` from localStorage only.
 * When cookie session exists but storage is empty/stale, GET this with `credentials: "include"` then store JWT for WS.
 */
export async function fetchWsAccessTokenFromSession(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const url = `${getApiBase()}/api/v1/auth/ws-token`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    const tok = (j.access_token ?? "").trim();
    if (!tok) return null;
    setAccessToken(tok);
    return tok;
  } catch {
    return null;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return null;
}

/** @deprecated Session token is HttpOnly; kept for type compatibility. */
export function setStoredToken(_token: string) {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.warn("setStoredToken is deprecated; session is set via Set-Cookie on login.");
  }
}

/**
 * End session: clear any legacy key and ask the API to clear the HttpOnly cookie.
 */
export function clearStoredToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  postLogoutToClearHttpOnlyCookie();
}

/**
 * When an authenticated request returns 401 (expired token, user removed from DB, etc.),
 * clear the session and go to sign-in. Skips on /login and /register.
 */
export function signOutOnUnauthorized(): void {
  if (typeof window === "undefined") {
    return;
  }
  const path = window.location.pathname;
  if (
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/register" ||
    path.startsWith("/register/") ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/verify-email" ||
    path.startsWith("/verify-email/")
  ) {
    return;
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  postLogoutToClearHttpOnlyCookie();
  const next = encodeURIComponent(path + (typeof window !== "undefined" ? window.location.search || "" : ""));
  window.location.replace(`/login?next=${next}`);
}

/** FastAPI `detail` may be string or list of validation errors */
export function normalizeErrorDetail(detail: unknown): string {
  if (detail == null) {
    return "";
  }
  if (typeof detail === "string") {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    return detail
      .map((x) =>
        typeof x === "object" && x !== null && "msg" in x ? String((x as { msg: unknown }).msg) : String(x),
      )
      .join(" ")
      .trim();
  }
  return String(detail).trim();
}

/** Read JSON `detail` without consuming `res` body (uses clone). */
export async function readFastApiDetail(res: Response): Promise<string> {
  const j = (await res.clone().json().catch(() => ({}))) as { detail?: unknown };
  return normalizeErrorDetail(j.detail);
}

/**
 * Whether 401 should clear the session (stale token / missing user).
 * Do not sign out for patterns that belong to login form or non-session 401s.
 * Aligned with backend `app/api/deps.py` get_current_user messages.
 */
export function shouldSignOutOn401(detail: string): boolean {
  const s = detail.toLowerCase();
  if (!s) {
    return true;
  }
  if (s.includes("incorrect email or password")) {
    return false;
  }
  if (s.includes("two-factor")) {
    return false;
  }
  return (
    s.includes("not authenticated") ||
    s.includes("invalid or expired") ||
    s.includes("expired token") ||
    s.includes("invalid subject") ||
    s.includes("user not found") ||
    s.includes("could not validate credentials") ||
    s.includes("credentials could not be validated")
  );
}

export function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/**
 * Same-origin FastAPI traffic is under `/api/v1` (Next rewrites). Only those calls should default to
 * `credentials: "include"` for HttpOnly cookies. Applying that to every `fetch("/…")` breaks Next.js App
 * Router client navigations (Flight / `_rsc` payloads) → "Failed to fetch RSC payload".
 */
function urlPathnameStartsWithApi(urlStr: string): boolean {
  if (urlStr.startsWith("/api")) return true;
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = urlStr.includes("://") ? new URL(urlStr) : new URL(urlStr, base);
    return u.pathname.startsWith("/api");
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  const w = window as unknown as { __EDUVERSE_FETCH_CREDENTIALS__?: boolean };
  if (!w.__EDUVERSE_FETCH_CREDENTIALS__) {
    w.__EDUVERSE_FETCH_CREDENTIALS__ = true;
    const native = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      let url = "";
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = (input as Request).url;
      }
      if (
        urlPathnameStartsWithApi(url) &&
        init?.credentials === undefined
      ) {
        return native(input, { ...init, credentials: "include" });
      }
      return native(input, init);
    };
  }
}
