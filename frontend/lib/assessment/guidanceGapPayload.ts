import type { CriterionResult, ExtractedCriterion, StoredGrade } from "@/lib/types/assessmentResult";

function normCode(a: string, b: string): boolean {
  return a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();
}

function getSpecForCode(code: string, spec: StoredGrade["assignment_spec"]) {
  if (!spec?.criteria || typeof spec.criteria !== "object") return undefined;
  const c = spec.criteria as Record<string, { requirement?: string; minimum_acceptable?: string } | undefined>;
  if (c[code]) return c[code];
  for (const k of Object.keys(c)) {
    if (normCode(k, code)) return c[k];
  }
  return undefined;
}

function getExtractedForCode(code: string, list: ExtractedCriterion[] | undefined) {
  return list?.find((x) => normCode(x.code, code));
}

function levelFromCode(code: string): "pass" | "merit" | "distinction" {
  const L = (code || "P1").trim().toUpperCase().charAt(0);
  if (L === "M") return "merit";
  if (L === "D") return "distinction";
  return "pass";
}

/**
 * Builds the guidance-gap request from the current student text + stored grade
 * (PASS0 + extracted criteria + context fill guidance when decode-brief JSON is absent).
 */
export type GapCriterionPayload = {
  criterion: string;
  level: "pass" | "merit" | "distinction";
  guidance: { what: string; how: string; link_to_scenario: string };
  achieved: boolean;
  confidence?: number;
};

export function buildGuidanceGapPayload(
  studentWork: string,
  result: StoredGrade
): { submission: string; criteria: GapCriterionPayload[] } {
  const submission = (studentWork || "").trim();
  const critList = (result.criteria_results || []) as CriterionResult[];
  const criteria = critList.map((row) => {
    const spec = getSpecForCode(row.code, result.assignment_spec);
    const ex = getExtractedForCode(row.code, result.criteria_extracted);
    const what = (
      spec?.requirement ||
      (spec as { skill?: string } | undefined)?.skill ||
      ex?.description ||
      ""
    ).trim();
    const how = (spec?.minimum_acceptable || "").trim();
    const linkParts = [result.assignment_context?.scenario, result.assignment_context?.task, result.assignment_spec?.task]
      .map((s) => (typeof s === "string" ? s : ""))
      .filter(Boolean);
    const link_to_scenario = linkParts.join("\n\n").slice(0, 4000);
    return {
      criterion: row.code,
      level: levelFromCode(row.code),
      guidance: {
        what: what || `معيار ${row.code} حسب وصف الواجب.`,
        how: how || "اتبع متطلبات هذا السطر في الواجب والتوجيه.",
        link_to_scenario: link_to_scenario,
      },
      achieved: row.achieved,
      confidence: row.confidence,
    };
  });
  return { submission, criteria };
}

export type CriterionGapAnalysis = {
  criterion: string;
  coverage: string;
  strengths: string;
  gaps: string;
  improvement_direction: string;
};
