import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { toast } from "sonner";

export type UsageMe = {
  assessments_used: number;
  assessments_limit: number;
  plagiarism_used: number;
  plagiarism_limit: number;
  remaining_assessments: number;
  remaining_plagiarism: number;
};

function isUnlimited(n: number): boolean {
  return n < 0;
}

export function formatLimit(n: number): string {
  return isUnlimited(n) ? "∞" : String(n);
}

export function usageProgress(used: number, limit: number): number {
  if (isUnlimited(limit) || limit <= 0) return 0;
  if (used <= 0) return 0;
  return Math.min(1, used / limit);
}

export function isNearLimit(used: number, limit: number): boolean {
  if (isUnlimited(limit) || limit <= 0) return false;
  return used / limit >= 0.8;
}

export function isAtLimit(used: number, limit: number): boolean {
  if (isUnlimited(limit) || limit <= 0) return false;
  return used >= limit;
}

/**
 * GET /api/v1/usage/me — HttpOnly session cookie; returns null on auth failure.
 */
export async function fetchUsageMe(): Promise<UsageMe | null> {
  const r = await fetchWithSession("/api/v1/usage/me", { method: "GET" });
  if (r.status === 401) {
    const d = await readFastApiDetail(r);
    if (shouldSignOutOn401(d)) {
      toast.error("Session expired. Please sign in.");
      signOutOnUnauthorized();
    }
    return null;
  }
  if (!r.ok) return null;
  return (await r.json()) as UsageMe;
}
