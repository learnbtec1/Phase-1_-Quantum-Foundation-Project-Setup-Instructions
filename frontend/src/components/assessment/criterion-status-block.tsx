"use client";

import type { ReactNode } from "react";
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
          className="font-mono text-base font-bold text-cyan-300 sm:text-lg"
          id={safeId}
        >
          {row.code}
        </span>
        <span
          role="status"
          aria-label={achieved ? `المعيار ${row.code} متـحقق` : `المعيار ${row.code} لم يتحقق`}
          className={cn(
            "inline-flex items-center rounded-lg border-2 px-3 py-1.5 text-sm font-bold",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
            achieved
              ? "border-emerald-500/80 bg-emerald-600/25 text-emerald-100 focus-visible:ring-emerald-400/80"
              : "border-rose-500/80 bg-rose-600/25 text-rose-100 focus-visible:ring-rose-400/80"
          )}
        >
          {achieved ? "متـحقق" : "لم يتحقق"}
        </span>
        {row.observed_cognitive_level ? (
          <span className="text-xs text-slate-500" title="مستوى تفكير ملاحَظ">
            الملاحَظ: {row.observed_cognitive_level}
          </span>
        ) : null}
      </div>

      <div
        role="region"
        aria-labelledby={safeId}
        className={cn(
          "rounded-xl border-2 p-4 text-sm leading-relaxed shadow-inner sm:p-5",
          achieved
            ? "border-emerald-500/60 bg-gradient-to-b from-emerald-950/70 to-emerald-950/40 text-emerald-50/95"
            : "border-rose-500/60 bg-gradient-to-b from-rose-950/70 to-rose-950/40 text-rose-50/95"
        )}
      >
        {contextLines.length > 0 && (
          <div className="mb-3 space-y-1 border-b border-white/10 pb-3 text-[0.75rem] leading-snug text-white/80">
            {contextLines.map((line, i) => (
              <p key={i} className="text-balance">
                {line}
              </p>
            ))}
          </div>
        )}

        {specMinimum && (
          <p className="mb-3 text-[0.8rem] font-medium text-white/90">
            <span className="me-1 font-bold opacity-80">مطلوب الحد الأدنى (المرجع):</span>
            {specMinimum}
          </p>
        )}

        <p className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-white/70">
          {achieved ? "لماذا وُسِم كمتـحقق" : "لماذا لم يتحقق بعد"}
        </p>
        <p className="whitespace-pre-wrap text-balance text-[0.95rem]">{primary}</p>

        {!achieved && secondary && (
          <div className="mt-4 border-t border-amber-400/30 pt-3">
            <p className="mb-1 text-[0.7rem] font-bold text-amber-200/90">تلميح للتحسين</p>
            <p className="whitespace-pre-wrap text-amber-50/95">{secondary}</p>
          </div>
        )}

        {!achieved && extraNotAchievedNote && (
          <p className="mt-3 border-t border-white/10 pt-3 text-[0.8rem] text-sky-100/90">
            <span className="font-semibold">تقدّم: </span>
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
 * Visual shell for a teacher "criteria_summary" row: start accent + code + status; nest extra UI as children.
 */
export function TeacherCriterionStatusStrip({ row, className, children }: TeacherStripProps) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border-b border-slate-700/40 pb-3 pe-1 last:border-0 last:pb-0",
        "border-s-4 ps-3",
        row.achieved ? "border-s-emerald-500/90 bg-emerald-950/15" : "border-s-rose-500/90 bg-rose-950/15",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>
          {row.achieved ? "✓" : "○"}
        </span>
        <span className="font-mono text-cyan-400">{row.code}</span>
        <span
          role="status"
          className={cn(
            "rounded-md border-2 px-2.5 py-0.5 text-xs font-bold",
            row.achieved
              ? "border-emerald-500/70 bg-emerald-800/30 text-emerald-200"
              : "border-rose-500/70 bg-rose-800/30 text-rose-200"
          )}
        >
          {row.achieved ? "متـحقق" : "لم يتحقق"}
        </span>
      </div>
      {row.minimum_acceptable ? (
        <p className="ms-7 text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-500">الحد الأدنى (من الواجب):</span> {row.minimum_acceptable}
        </p>
      ) : null}
      {children}
    </li>
  );
}
