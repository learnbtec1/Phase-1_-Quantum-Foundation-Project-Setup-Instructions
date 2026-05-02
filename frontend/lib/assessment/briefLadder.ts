import { getApiBase, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";

export type BtecBriefLadder = {
  pass: string[];
  merit: string[];
  distinction: string[];
};

/**
 * AI BTEC Decoder: sends assignment brief PDF to the backend; returns P/M/D bullet lines (Arabic).
 */
export async function analyzeAssignmentBrief(file: File): Promise<BtecBriefLadder> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${getApiBase()}/api/v1/assessment/analyze-assignment-brief`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const msg = (await readFastApiDetail(res)) || res.statusText;
    if (res.status === 401 && shouldSignOutOn401(msg)) {
      signOutOnUnauthorized();
    }
    throw new Error(msg || "تعذّر تحليل الموجز");
  }
  return (await res.json()) as BtecBriefLadder;
}
