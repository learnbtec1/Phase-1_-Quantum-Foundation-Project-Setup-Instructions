/**
 * Pro-tier gates (align with backend `User.subscription_plan` and billing).
 * "PRO" product features: `pro` and `unlimited` only — not basic/advanced/free.
 */
export function isProWriterUnlocked(subscriptionPlan: string | null | undefined): boolean {
  const p = (subscriptionPlan || "free").toLowerCase();
  return p === "pro" || p === "unlimited";
}
