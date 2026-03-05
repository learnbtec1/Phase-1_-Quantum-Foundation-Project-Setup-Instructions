// lib/evaluation/report.ts

/**
 * Report generation:
 * - Generate full BTEC text report (ministry-ready)
 * - Include all evaluation details
 * - Show criteria results and evidence
 * - Include change log from previous evaluation
 */

import { FullEvaluation } from "./compare";
import { CompareResult } from "./compare";

export function generateTextReport(
  evaluation: FullEvaluation,
  compare: CompareResult | null
): string {
  let lines: string[] = [];

  // ============================
  // HEADER
  // ============================
  lines.push("===========================================");
  lines.push("   BTEC Evaluation Report - Ministry Ready");
  lines.push("===========================================");
  lines.push(`Created: ${evaluation.meta.createdAt}`);
  lines.push(`Student ID: ${evaluation.meta.studentId}`);
  lines.push(`Assignment ID: ${evaluation.meta.assignmentId}`);
  lines.push(`Rubric: ${evaluation.meta.rubricId} (v${evaluation.meta.rubricVersion})`);
  lines.push("");
  lines.push("");

  // ============================
  // SUMMARY
  // ============================
  lines.push("=== SUMMARY ===");
  lines.push(`Total Criteria: ${evaluation.summary.totalCriteria}`);
  lines.push(`Achieved: ${evaluation.summary.achievedCount}`);
  lines.push(`Percentage: ${evaluation.summary.achievedPercent}%`);
  lines.push("");
  lines.push("");

  // ============================
  // CRITERIA DETAILS
  // ============================
  lines.push("===========================================");
  lines.push("   CRITERION DETAILS");
  lines.push("===========================================");
  lines.push("");

  for (const c of evaluation.criteria) {
    lines.push(`--- Criterion ${c.code} ---`);
    lines.push(`Verdict: ${c.verdict}`);
    lines.push("");

    if (c.reasons.length > 0) {
      lines.push("Reasons:");
      c.reasons.forEach((r) => lines.push(` - ${r}`));
      lines.push("");
    }

    if (c.evidence.length > 0) {
      lines.push("Evidence:");
      c.evidence.forEach((ev) =>
        lines.push(` - "${ev.quote}" (position ${ev.start} to ${ev.end})`)
      );
      lines.push("");
    }

    if (c.recommendations.length > 0) {
      lines.push("Recommendations:");
      c.recommendations.forEach((r) => lines.push(` - ${r}`));
      lines.push("");
    }

    lines.push("-------------------------------------------");
    lines.push("");
  }

  // ============================
  // CHANGE LOG (if compare provided)
  // ============================
  if (compare) {
    lines.push("");
    lines.push("");
    lines.push("===========================================");
    lines.push("        CHANGE LOG");
    lines.push("===========================================");
    lines.push("");

    if (!compare.changed) {
      lines.push("No changes detected from previous evaluation.");
      return lines.join("\n");
    }

    lines.push(`Overall changed: ${compare.changed}`);
    if (compare.summaryChange.changed) {
      lines.push(
        `Achievement percentage: ${compare.summaryChange.oldPercent}% -> ${compare.summaryChange.newPercent}%`
      );
    }

    lines.push("");
    lines.push("Criterion Changes:");
    for (const change of compare.criteriaChanges) {
      if (
        change.verdictChanged ||
        change.evidenceChanged ||
        change.reasonsChanged
      ) {
        lines.push(`  ${change.code}:`);
        if (change.verdictChanged) {
          lines.push(
            `    Verdict: ${change.verdictOld} -> ${change.verdictNew}`
          );
        }
        if (change.evidenceChanged) {
          lines.push(
            `    Evidence: ${change.oldEvidence.length} -> ${change.newEvidence.length} items`
          );
        }
      }
    }
  }

  return lines.join("\n");
}
