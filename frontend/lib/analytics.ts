import type { FormEvent } from "react";

/**
 * Google Analytics 4 (gtag) — optional. Safe no-op when gtag is missing or in SSR.
 */
export type AssessmentCtaSource = "primary" | "footer" | "sticky";

export type AssessmentCtaBlockReason =
  | "missing_answer"
  | "academic_incomplete"
  | "uploading"
  | "needs_confirmation"
  | "limit"
  | "none";

declare global {
  interface Window {
    gtag?: (command: string, target: string, config?: Record<string, unknown>) => void;
  }
}

function gtagEvent(name: string, params: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!id) return;
  try {
    window.gtag?.("event", name, params);
  } catch {
    /* ignore */
  }
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[analytics] ${name}`, params);
  }
}

export function trackAssessmentCtaClick(args: {
  source: AssessmentCtaSource;
  blocked: boolean;
  reason: AssessmentCtaBlockReason | "loading" | null;
}): void {
  gtagEvent("assessment_cta_click", {
    source: args.source,
    blocked: args.blocked,
    reason: args.reason ?? "none",
  });
}

export function getSubmitSourceFromFormEvent(
  e: FormEvent<HTMLFormElement>,
): AssessmentCtaSource {
  const ne = (e as unknown as { nativeEvent?: SubmitEvent }).nativeEvent;
  const sub = (ne as SubmitEvent | undefined)?.submitter as HTMLButtonElement | undefined;
  const n = sub?.getAttribute("name");
  if (n === "assessment_submit_footer") return "footer";
  if (n === "assessment_submit_sticky") return "sticky";
  return "primary";
}
