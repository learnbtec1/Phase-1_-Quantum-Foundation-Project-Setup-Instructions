import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAMES = ["eduvor_token", "auth_token"];

const HEADER_USER_ROLE = "x-user-role";

/**
 * Decodes JWT payload (middle segment) at the edge without verify — for UI (nav) only.
 * Authz remains enforced by the API with full signature verification. Role claim
 * is written at login: `create_access_token(..., extra_claims: { role })`.
 */
function jwtPayloadFromAccessToken(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const segment = parts[1] ?? "";
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const padded = b64 + (pad ? "=".repeat(pad) : "");
    const raw = atob(padded);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtRoleFromToken(token: string): string {
  const payload = jwtPayloadFromAccessToken(token);
  if (!payload) return "";
  const r = payload.role;
  if (typeof r !== "string") return "";
  return r.toLowerCase().trim().slice(0, 64);
}

/**
 * Cookie present but JWT `exp` in the past → treat as logged-out at the edge so we don't:
 * - bounce `/login` → `/dashboard` forever with a stale cookie, or
 * - allow access to protected routes with an expired session cookie (AuthGuard spam).
 * Opaque / non-JWT tokens (e.g. dev bypass) pass through unchanged.
 */
function getEffectiveSessionToken(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  const parts = t.split(".");
  if (parts.length !== 3) {
    return t.length > 0 ? t : undefined;
  }
  const payload = jwtPayloadFromAccessToken(t);
  if (!payload) return undefined;
  const exp = payload.exp;
  if (typeof exp !== "number") return t;
  const nowSec = Date.now() / 1000;
  if (exp <= nowSec + 30) return undefined;
  return t;
}

function permissionsPolicyForPath(pathname: string): string {
  const cognieCameraRoutes =
    pathname === "/cognie" ||
    pathname.startsWith("/cognie/") ||
    pathname === "/avatar-agent" ||
    pathname.startsWith("/avatar-agent/");
  // IMPORTANT (SPA / App Router): Permissions-Policy applies to the *document* and does not
  // refresh on client-side navigations. If the first load is e.g. `/` or `/dashboard` with
  // `microphone=()`, getUserMedia stays blocked after navigating to `/cognie` — user hears/sees
  // Cognie fail mic capture even though this middleware would allow `/cognie` on a full reload.
  // Allow microphone for same-origin on all routes; access still requires user gesture + prompt.
  // Camera stays off except avatar/Cognie routes.
  const cameraAndGeo = cognieCameraRoutes
    ? "camera=(self), geolocation=()"
    : "camera=(), geolocation=()";
  return `${cameraAndGeo}, microphone=(self)`;
}

function withSecurityHeaders(res: NextResponse, pathname: string) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", permissionsPolicyForPath(pathname));
  return res;
}

/**
 * Forwards the request and injects `x-user-role` from the session JWT (overwrites any client spoof).
 */
function nextWithRole(request: NextRequest, token: string | undefined) {
  const requestHeaders = new Headers(request.headers);
  const role = token ? decodeJwtRoleFromToken(token) : "";
  requestHeaders.set(HEADER_USER_ROLE, role);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function getSessionCookie(req: NextRequest): string | undefined {
  for (const name of COOKIE_NAMES) {
    const v = req.cookies.get(name)?.value;
    if (v) {
      return v;
    }
  }
  return undefined;
}

function isPublicPath(pathname: string) {
  if (pathname === "/") {
    return true;
  }
  if (pathname.startsWith("/api")) {
    return true;
  }
  if (pathname.startsWith("/_next")) {
    return true;
  }
  if (pathname === "/favicon.ico" || pathname === "/icon.png") {
    return true;
  }
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname.startsWith("/verify-email/")
  ) {
    return true;
  }
  return false;
}

/**
 * Security headers + optional edge redirects using the same HttpOnly session as FastAPI
 * (`AUTH_COOKIE_NAME`, default `eduvor_token`).
 * Set `ENABLE_EDGE_AUTH=false` to apply headers + role header only, and rely on `AuthGuard` in the app.
 */
const ENABLE_EDGE_AUTH = process.env.ENABLE_EDGE_AUTH !== "false";

/** NEXT_PUBLIC_* — inlined at Next build; disables /login redirects for local freeze (never ship true in prod builds). */
const EMERGENCY_AUTH_FREEZE =
  process.env.NEXT_PUBLIC_EMERGENCY_AUTH_FREEZE === "true";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = getEffectiveSessionToken(getSessionCookie(request));
  const authPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname.startsWith("/verify-email/");

  if (!ENABLE_EDGE_AUTH || EMERGENCY_AUTH_FREEZE) {
    return withSecurityHeaders(nextWithRole(request, token), pathname);
  }

  if (!token && !isPublicPath(pathname) && !authPage) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", request.url)), pathname);
  }
  if (token && authPage) {
    const devHome = process.env.NEXT_PUBLIC_AUTH_DEV_REDIRECT?.trim();
    const fallback =
      devHome && devHome.startsWith("/") && !devHome.startsWith("//") ? devHome : "/dashboard";
    return withSecurityHeaders(NextResponse.redirect(new URL(fallback, request.url)), pathname);
  }
  return withSecurityHeaders(nextWithRole(request, token), pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|txt)).*)"],
};
