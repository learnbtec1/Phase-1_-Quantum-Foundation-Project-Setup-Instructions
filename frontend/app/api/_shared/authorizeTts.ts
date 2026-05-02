import type { NextRequest } from "next/server";

import {
  resolveIncomingBearerOrDevBypass,
  type ResolveBearerResult,
} from "@/lib/server/bffProxy";

/** Opaque token forwarded to FastAPI when emergency freeze is on (matches backend AUTH_DEV_STATIC_TOKEN). */
function emergencyDevOpaqueToken(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_DEV_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_DEV_AUTH_TOKEN?.trim();
  return fromEnv || "test-token-123";
}

/**
 * Resolves how this BFF authenticates to backend TTS.
 * Emergency freeze: always inject `Bearer` with dev opaque token so FastAPI `get_current_user` succeeds.
 */
export function resolveTtsUpstreamAuth(req: NextRequest): ResolveBearerResult {
  if (process.env.NEXT_PUBLIC_EMERGENCY_AUTH_FREEZE === "true") {
    const token = emergencyDevOpaqueToken();
    return { ok: true, authHeader: `Bearer ${token}` };
  }
  return resolveIncomingBearerOrDevBypass(req);
}

/** Align with Next.js env for BFF — guest/anonymous paths must match client COGNI_* flags baked at build. */
export function authorizeTtsRequest(req: NextRequest): boolean {
  return resolveTtsUpstreamAuth(req).ok;
}
