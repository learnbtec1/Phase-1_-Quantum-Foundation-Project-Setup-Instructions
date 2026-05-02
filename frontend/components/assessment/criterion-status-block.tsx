"use client";

import type { ReactNode } from "react";
import { CheckCircle2, XCircle, Lightbulb } from "lucide-react";
import type { AssignmentContext, AssignmentSpecPayload, CriterionResult } from "@/lib/types/assessmentResult";
import { cn } from "@/lib/utils";

const SYS_MARKERS = [
  " [Balance:",
  " [Gate:",
  " [Note:",
  " [PASS",
  " [EVIDENCE",
  " [تنسيق",
];

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function stripSystemSuffix(justification: string): string {
  let t = (justification || "").trim();
  for (const m of SYS_MARKERS) {
    const i = t.indexOf(m);
    if (i >= 0) t = t.slice(0, i).trim();
  }
  return t.replace(/\s+/g, " ").trim();
}

function getSpecMinimumForCode(
  code: string,
  spec: AssignmentSpecPayload | null | undefined
): string | undefined {
  if (!spec?.criteria || typeof spec.criteria !== "object") return undefined;
  const c = spec.criteria as Record<string, { minimum_acceptable?: string } | undefined>;
  const raw = (code || "").trim();
  if (c[raw]?.minimum_acceptable) return String(c[raw]!.minimum_acceptable).trim();
  const u = raw.toUpperCase().replace(/\s/g, "");
  for (const k of Object.keys(c)) {
    if (k.toUpperCase().replace(/\s/g, "") === u) {
      const m = c[k]?.minimum_acceptable;
      return m != null && String(m).trim() ? String(m).trim() : undefined;
    }
  }
  return undefined;
}

function buildContextLines(ctx: AssignmentContext | null | undefined): string[] {
  if (!ctx) return [];
  const scenario = (ctx.scenario || "").trim();
  const task = (ctx.task || "").trim();
  const out: string[] = [];
  if (scenario) out.push(clip(`السيناريو: ${scenario}`, 320));
  if (task) out.push(clip(`المهمة: ${task}`, 320));
  return out;
}

/**
 * Composes a concise, student- and teacher-friendly explanation
 * (scenario/task + PASS0 bar + grader reason + fallback to cleaned justification).
 */
export function buildCriterionNarrativeParts(
  row: CriterionResult,
  assignmentContext?: AssignmentContext | null,
  assignmentSpec?: AssignmentSpecPayload | null
): { contextLines: string[]; specMinimum?: string; primary: string; secondary?: string } {
  const contextLines = buildContextLines(assignmentContext ?? undefined);
  const specMinimum = getSpecMinimumForCode(row.code, assignmentSpec);
  const cleaned = stripSystemSuffix(row.justification || "");

  let primary = "";
  let secondary: string | undefined;

  if (row.achieved) {
    primary = (row.why_achieved || "").trim() || (cleaned ? clip(cleaned, 520) : "تم استيفاء متطلبات المعيار وفق تبرير المقيّم.");
  } else {
    primary = (row.why_not_achieved || "").trim() || (cleaned ? clip(cleaned, 400) : "لم يتبيّن بعد استيفاء المطلوب لهذا المعيار.");
    const hint = (row.improvement_hint || "").trim();
    if (hint) secondary = hint;
  }

  return { contextLines, specMinimum, primary, secondary };
}

type CriterionStatusBlockProps = {
  row: CriterionResult;
  assignmentContext?: AssignmentContext | null;
  assignmentSpec?: AssignmentSpecPayload | null;
  extraNotAchievedNote?: string | null;
  className?: string;
};

/**
 * Criterion code + "متـحقق" / "لم يتحقق" badge and a green/red summary box
 * aligned with task/scenario and PASS0 minimums when available.
 */
export function CriterionStatusBlock({
  row,
  assignmentContext,
  assignmentSpec,
  extraNotAchievedNote,
  className,
}: CriterionStatusBlockProps) {
  const achieved = row.achieved;
  const { contextLines, specMinimum, primary, secondary } = buildCriterionNarrativeParts(
    row,
    assignmentContext,
    assignmentSpec
  );
  const safeId = `crit-${(row.code || "x").replace(/[^\w\u0600-\u06FF-]/g, "-")}`;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="font-mono text-base font-bold tracking-tight text-primary sm:text-lg"
          id={safeId}
        >
          {row.code}
        </span>
        <span
          role="status"
          aria-label={achieved ? `المعيار ${row.code} متـحقق` : `المعيار ${row.code} لم يتحقق`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            achieved
              ? "status-achieved"
              : "status-not-achieved"
          )}
        >
          {achieved ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden />}
          {achieved ? "متـحقق" : "لم يتحقق"}
        </span>
        {row.observed_cognitive_level ? (
          <span className="text-xs text-muted-foreground" title="مستوى تفكير ملاحَظ">
            الملاحَظ: {row.observed_cognitive_level}
          </span>
        ) : null}
      </div>

      <div
        role="region"
        aria-labelledby={safeId}
        className={cn(
          "rounded-xl border p-4 text-sm leading-relaxed shadow-sm transition-shadow duration-200 sm:p-5",
          "backdrop-blur-md",
          achieved
            ? "border-green-500/20 bg-green-500/10 hover:shadow-md"
            : "border-red-500/20 bg-red-500/10 hover:shadow-md"
        )}
      >
        {contextLines.length > 0 && (
          <div className="mb-3 space-y-1 border-b border-border/50 pb-3 text-[0.75rem] leading-snug text-muted-foreground">
            {contextLines.map((line, i) => (
              <p key={i} className="text-balance">
                {line}
              </p>
            ))}
          </div>
        )}

        {specMinimum && (
          <p className="mb-3 text-[0.8rem] font-medium text-foreground">
            <span className="me-1 font-semibold text-muted-foreground">مطلوب الحد الأدنى (المرجع):</span>
            {specMinimum}
          </p>
        )}

        <p
          className={cn(
            "mb-2 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide",
            achieved ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
          )}
        >
          {achieved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {achieved ? "لماذا وُسِم كمتـحقق" : "لماذا لم يتحقق بعد"}
        </p>
        <p className="whitespace-pre-wrap text-balance text-foreground [font-size:0.95rem]">{primary}</p>

        {!achieved && secondary && (
          <div className="status-warning mt-4 rounded-lg border p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden />
              تلميح للتحسين
            </p>
            <p className="whitespace-pre-wrap text-foreground/95">{secondary}</p>
          </div>
        )}

        {!achieved && extraNotAchievedNote && (
          <p className="mt-3 border-t border-border/40 pt-3 text-[0.8rem] text-muted-foreground">
            <span className="font-semibold text-foreground">تقدّم: </span>
            {extraNotAchievedNote}
          </p>
        )}
      </div>
    </div>
  );
}

type TeacherSummaryRow = {
  code: string;
  achieved: boolean;
  minimum_acceptable?: string;
};

type TeacherStripProps = { row: TeacherSummaryRow; className?: string; children?: ReactNode };

/**
 * Visual shell for a teacher “criteria_summary” row: start accent + code + status; nest extra UI as children.
 */
export function TeacherCriterionStatusStrip({ row, className, children }: TeacherStripProps) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border-b border-border/30 pb-3 pe-1 last:border-0 last:pb-0",
        "border-s-2 ps-3 transition-colors",
        row.achieved
          ? "border-s-green-500/50 bg-green-500/5"
          : "border-s-red-500/50 bg-red-500/5",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base" aria-hidden>
          {row.achieved ? "✓" : "○"}
        </span>
        <span className="font-mono text-sm font-semibold text-foreground">{row.code}</span>
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
            row.achieved ? "status-achieved" : "status-not-achieved"
          )}
        >
          {row.achieved ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {row.achieved ? "متـحقق" : "لم يتحقق"}
        </span>
      </div>
      {row.minimum_acceptable ? (
        <p className="ms-6 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">الحد الأدنى (من الواجب):</span> {row.minimum_acceptable}
        </p>
      ) : null}
      {children}
    </li>
  );
}
