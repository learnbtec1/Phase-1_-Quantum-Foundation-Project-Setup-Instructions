// lib/evaluation/compare.ts

/**
 * Compare old and new evaluations:
 * - Previous evaluation (Old)
 * - Current evaluation (New)
 *
 * Returns:
 * - Whether verdict changed (Achieved / Not Achieved)
 * - Whether evidence changed (Quotes + Locations)
 * - Whether reasoning changed
 * - Whether recommendations changed
 *
 * Generates justification for any changes detected.
 */

export type EvaluationCriterion = {
  code: string;
  verdict: "Achieved" | "Not Achieved";
  reasons: string[];
  evidence: {
    quote: string;
    start: number;
    end: number;
  }[];
  recommendations: string[];
};

export type FullEvaluation = {
  summary: {
    totalCriteria: number;
    achievedCount: number;
    achievedPercent: number;
  };
  criteria: EvaluationCriterion[];
  meta: {
    assignmentId: string;
    studentId: string;
    rubricId: string;
    rubricVersion: string;
    createdAt: string;
    model: string;
    prompt_hash: string;
    fingerprint: string;
  };
};

export type CompareResult = {
  changed: boolean;
  overallChanged: boolean;
  criteriaChanges: {
    code: string;
    verdictChanged: boolean;
    verdictOld: string | null;
    verdictNew: string | null;
    evidenceChanged: boolean;
    oldEvidence: string[];
    newEvidence: string[];
    reasonsChanged: boolean;
    recommendationsChanged: boolean;
  }[];
  summaryChange: {
    oldPercent: number | null;
    newPercent: number | null;
    changed: boolean;
  };
};

/**
 * Convert evidence array to text list
 */
function evidenceListToText(arr: { quote: string }[]): string[] {
  return arr.map((e) => e.quote.trim());
}

/**
 * Compare two evaluations
 */
export function compareEvaluations(
  oldEval: FullEvaluation | null,
  newEval: FullEvaluation
): CompareResult {
  if (!oldEval) {
    // No previous evaluation - everything is new
    return {
      changed: true,
      overallChanged: true,
      criteriaChanges: newEval.criteria.map((c) => ({
        code: c.code,
        verdictChanged: false,
        verdictOld: null,
        verdictNew: c.verdict,
        evidenceChanged: false,
        oldEvidence: [],
        newEvidence: evidenceListToText(c.evidence),
        reasonsChanged: false,
        recommendationsChanged: false,
      })),
      summaryChange: {
        oldPercent: null,
        newPercent: newEval.summary.achievedPercent,
        changed: true,
      },
    };
  }

  const changes: CompareResult["criteriaChanges"] = [];
  let anyOverallChange = false;

  for (const crit of newEval.criteria) {
    const oldCrit = oldEval.criteria.find((c) => c.code === crit.code);

    if (!oldCrit) {
      // New criterion added
      changes.push({
        code: crit.code,
        verdictChanged: false,
        verdictOld: null,
        verdictNew: crit.verdict,
        evidenceChanged: false,
        oldEvidence: [],
        newEvidence: evidenceListToText(crit.evidence),
        reasonsChanged: false,
        recommendationsChanged: false,
      });
      anyOverallChange = true;
      continue;
    }

    const verdictChanged = oldCrit.verdict !== crit.verdict;
    const oldEvidence = evidenceListToText(oldCrit.evidence);
    const newEvidence = evidenceListToText(crit.evidence);

    const evidenceChanged =
      JSON.stringify(oldEvidence) !== JSON.stringify(newEvidence);

    const reasonsChanged =
      JSON.stringify(oldCrit.reasons) !== JSON.stringify(crit.reasons);

    const recommendationsChanged =
      JSON.stringify(oldCrit.recommendations) !==
      JSON.stringify(crit.recommendations);

    if (
      verdictChanged ||
      evidenceChanged ||
      reasonsChanged ||
      recommendationsChanged
    ) {
      anyOverallChange = true;
    }

    changes.push({
      code: crit.code,
      verdictChanged,
      verdictOld: oldCrit.verdict,
      verdictNew: crit.verdict,
      evidenceChanged,
      oldEvidence,
      newEvidence,
      reasonsChanged,
      recommendationsChanged,
    });
  }

  // Check if summary changed
  const summaryChanged =
    oldEval.summary.achievedPercent !== newEval.summary.achievedPercent;

  return {
    changed: anyOverallChange || summaryChanged,
    overallChanged: anyOverallChange,
    criteriaChanges: changes,
    summaryChange: {
      oldPercent: oldEval.summary.achievedPercent,
      newPercent: newEval.summary.achievedPercent,
      changed: summaryChanged,
    },
  };
}
