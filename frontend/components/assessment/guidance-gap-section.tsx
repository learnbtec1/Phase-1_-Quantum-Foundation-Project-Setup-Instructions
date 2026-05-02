"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CriterionGapAnalysis } from "@/lib/assessment/guidanceGapPayload";

type Props = {
  analysis: CriterionGapAnalysis | undefined;
  loading: boolean;
  ar: boolean;
};

export function GuidanceGapSection({ analysis, loading, ar }: Props) {
  if (loading) {
    return (
      <div
        className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-slate-950/40 px-3 py-2 text-xs text-slate-500"
        aria-live="polite"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-cyan-400/80" />
        {ar ? "جارٍ تحليل فجوة التوجيه…" : "Loading guidance analysis…"}
      </div>
    );
  }
  if (!analysis) {
    return null;
  }
  const cov = (analysis.coverage || "").toLowerCase();
  const covLabel = ar
    ? cov === "complete"
      ? "تغطية: كاملة"
      : cov === "missing"
        ? "تغطية: ناقصة"
        : "تغطية: جزئية"
    : `Coverage: ${analysis.coverage}`;

  return (
    <div
      className="mt-4 space-y-3 rounded-xl border border-cyan-500/20 bg-slate-950/50 p-4 shadow-[0_0_20px_rgba(6,182,212,0.08)]"
      dir={ar ? "rtl" : "ltr"}
    >
      <h5 className="flex items-center gap-2 text-sm font-bold text-cyan-200/90">
        <Sparkles className="h-4 w-4 text-cyan-400" />
        {ar ? "كيف تطوّر إجابتك؟" : "How to improve"}
        <span className="ms-auto text-[0.65rem] font-normal text-slate-500">{covLabel}</span>
      </h5>
      {analysis.strengths ? (
        <p className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-2 text-sm leading-relaxed text-emerald-100/90">
          <span className="me-1 font-semibold text-emerald-400/90">{ar ? "نقاط قوة: " : "Strengths: "}</span>
          {analysis.strengths}
        </p>
      ) : null}
      {analysis.gaps ? (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-sm leading-relaxed",
            cov === "missing"
              ? "border-rose-500/30 bg-rose-950/20 text-rose-100/90"
              : "border-amber-500/30 bg-amber-950/20 text-amber-100/90",
          )}
        >
          <span className="me-1 font-semibold text-amber-300/90">{ar ? "فجوات: " : "Gaps: "}</span>
          {analysis.gaps}
        </p>
      ) : null}
      {analysis.improvement_direction ? (
        <p className="rounded-lg border border-slate-500/20 bg-slate-900/40 px-3 py-2 text-sm leading-relaxed text-slate-200">
          <span className="me-1 font-semibold text-slate-400">{ar ? "اتجاه التحسين: " : "Improvement direction: "}</span>
          {analysis.improvement_direction}
        </p>
      ) : null}
    </div>
  );
}
