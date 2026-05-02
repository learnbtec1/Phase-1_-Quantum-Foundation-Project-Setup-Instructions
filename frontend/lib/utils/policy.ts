import { localPlagiarismPercent, similarityStatus } from "./similarity";

// Re-export POLICY as single source of truth
export const POLICY = {
  maxSimilarity: 25,
  minWords: 150,
} as const;

export function countWords(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export type PolicyResult = {
  pass: boolean;
  reasons: string[];
  localSimilarityPercent: number | null;
  localStatus: "acceptable" | "high" | "n/a";
};

export function validatePreSubmit(unit: string, studentWork: string): { ok: boolean; message?: string } {
  const u = (unit || "").trim();
  if (!u) return { ok: false, message: "Select a BTEC unit / criterion." };
  const w = (studentWork || "").trim();
  if (!w) return { ok: false, message: "Student work is required." };
  const n = countWords(w);
  if (n < POLICY.minWords) {
    return { ok: false, message: `At least ${POLICY.minWords} words required (currently ${n}).` };
  }
  return { ok: true };
}

/**
 * After local similarity is computed, evaluate policy (display + gating).
 */
export function runPolicy(localSimilarityPercent: number | null): PolicyResult {
  const reasons: string[] = [];
  // Loose null/undefined and non-finite (NaN, ±Infinity) — same UX as "not computed"
  const pct =
    typeof localSimilarityPercent === "number" && Number.isFinite(localSimilarityPercent)
      ? localSimilarityPercent
      : null;
  if (pct == null) {
    reasons.push("Local 3-gram score not computed (add criteria/reference or more text).");
    return { pass: true, reasons, localSimilarityPercent: null, localStatus: "n/a" };
  }
  const st = similarityStatus(pct, POLICY.maxSimilarity);
  if (st === "high") {
    reasons.push(
      `Local n-gram overlap is ${pct.toFixed(1)}% (max ${POLICY.maxSimilarity}% before review).`
    );
  } else {
    reasons.push(
      `Local n-gram overlap is ${pct.toFixed(1)}% (within ${POLICY.maxSimilarity}% target).`
    );
  }
  // Pass when local overlap is within maxSimilarity (inclusive); above requires acknowledgement
  const pass = st === "acceptable";
  return { pass, reasons, localSimilarityPercent: pct, localStatus: st };
}

/** Compute local % using student + optional comparison text, else self-split. */
export function computeLocalScore(student: string, comparisonText: string): number | null {
  const c = (comparisonText || "").trim();
  const raw =
    c.length >= 30
      ? localPlagiarismPercent(student, { referenceOrCriteria: c })
      : localPlagiarismPercent(student, { useSplitSelf: true });
  if (raw == null) return null;
  return Number.isFinite(raw) ? raw : null;
}
