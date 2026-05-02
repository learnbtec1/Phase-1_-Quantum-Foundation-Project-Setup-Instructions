"use client";

import { Award, CircleCheck, Loader2, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BtecBriefLadder } from "@/lib/assessment/briefLadder";

type Lang = "ar" | "en";

const COPY: Record<
  Lang,
  {
    title: string;
    subtitle: string;
    aiSubtitle: string;
    enAiNote: string;
    levels: {
      key: keyof BtecBriefLadder;
      label: string;
      short: string;
      bullets: string[];
    }[];
  }
> = {
  ar: {
    title: "سلّم BTEC: Pass و Merit و Distinction",
    subtitle:
      "إطار ذي ثلاث مستويات لكل معيار (P/M/D). المعاين هنا تعليمي — يُستكمل بالوصف الفعلي لواجبك ومعايير P1…D1 في الملفات.",
    aiSubtitle: "مستخرج تلقائياً من موجز الواجب (يُنصح بمطابقته مع نص الـ brief).",
    enAiNote: "",
    levels: [
      {
        key: "pass",
        label: "Pass (ناجح)",
        short: "تحقيق المتطلب الأساسي للمعيار",
        bullets: [
          "إظهار فهم صحيح للمفاهيم ذات الصلة (Describe / state).",
          "ربط مبسّط بين الفكرة والسيناريو أو سؤال المهمة.",
          "تغطية واضحة لحد العدل الأدنى من وصف الواجب عند توفره (PASS0).",
        ],
      },
      {
        key: "merit",
        label: "Merit (جيد)",
        short: "أداء يتجاوز الحد الأدنى بترابط أوضح",
        bullets: [
          "شرح الأسباب والعلائق (Explain) وليس الاكتفاء بالوصف فقط.",
          "ترابط منطقي بين فقرات وشروح متوسطة التعقيد.",
          "استجابة منظّمة تُظهر فهماً أعمق دون بلوغ التحليل التقييمي الكامل لـ Distinction.",
        ],
      },
      {
        key: "distinction",
        label: "Distinction (متميّز)",
        short: "تحليل وتقييم مع أدلة مترابطة",
        bullets: [
          "تحليل (Analyse) و/أو تقييم (Evaluate) — قضايا، مفاضلات، ونتائج مبررة.",
          "حجج متماسكة بأدلة اقتباسية أو مثال يستند إلى نص الحل أو المسموح في المهمة.",
          "لغة تقييمية وعمق يلبّي وصف D في المعيار دون اختزاله إلى “مزيد من الكلمات”.",
        ],
      },
    ],
  },
  en: {
    title: "BTEC ladder: Pass, Merit, Distinction",
    subtitle:
      "Three levels per criterion (P/M/D). This is a teaching overview — your brief and P1…D1 lines in files complete the story.",
    aiSubtitle: "Auto-filled from your assignment brief. Cross-check the original rubric text.",
    enAiNote: "Bullets may be in Arabic (from the decoder) when the brief is analysed in Arabic.",
    levels: [
      {
        key: "pass",
        label: "Pass",
        short: "Meet the essential requirement of the criterion",
        bullets: [
          "Show correct knowledge of relevant ideas (describe / state as required).",
          "A clear, simple link between the idea and the task or scenario.",
          "Where PASS0 is available, meet the fair minimum from the brief.",
        ],
      },
      {
        key: "merit",
        label: "Merit",
        short: "Clear performance beyond the floor",
        bullets: [
          "Explain “why / how” — not only “what” (explanation over plain description).",
          "Coherent structure and sound connections between points.",
          "A stronger response without yet reaching full D-style evaluative depth.",
        ],
      },
      {
        key: "distinction",
        label: "Distinction",
        short: "Analyse and evaluate with tight evidence",
        bullets: [
          "Analyse and/or evaluate: trade-offs, judgements, justified conclusions.",
          "Claims supported with traceable evidence from the learner’s work or allowed sources.",
          "Evaluative language and depth aligned with the D descriptor, not just length.",
        ],
      },
    ],
  },
};

const levelStyles: Record<
  "pass" | "merit" | "distinction",
  { ring: string; glow: string; icon: string; Icon: typeof CircleCheck }
> = {
  pass: {
    ring: "border-amber-500/40",
    glow: "shadow-[0_0_32px_rgba(234,179,8,0.12)]",
    icon: "text-amber-300",
    Icon: CircleCheck,
  },
  merit: {
    ring: "border-sky-500/40",
    glow: "shadow-[0_0_32px_rgba(14,165,233,0.12)]",
    icon: "text-sky-300",
    Icon: Award,
  },
  distinction: {
    ring: "border-violet-500/45",
    glow: "shadow-[0_0_36px_rgba(139,92,246,0.15)]",
    icon: "text-violet-200",
    Icon: Sparkles,
  },
};

export type BtecGradeProps = {
  language: Lang;
  data?: BtecBriefLadder | null;
  loading?: boolean;
  className?: string;
};

/**
 * Visual rubric overview for BTEC P/M/D — optional AI ladder from brief PDF; falls back to copy + defaults.
 */
export function BtecGradeScale({ language, data, loading, className }: BtecGradeProps) {
  const t = COPY[language];
  const isAr = language === "ar";

  const levels = useMemo(() => {
    return t.levels.map((lv) => {
      const fromApi = data?.[lv.key];
      const hasApi = Array.isArray(fromApi) && fromApi.length > 0;
      const bullets = hasApi ? (fromApi as string[]) : lv.bullets;
      return { ...lv, bullets };
    });
  }, [t, data]);

  const useDefaultsOnly = !data && !loading;
  const subtitle = useMemo(() => {
    if (loading) {
      return isAr ? "جارٍ تحليل موجز الواجب وملء السلم…" : "Analysing your brief and filling the ladder…";
    }
    if (data && (data.pass?.length || data.merit?.length || data.distinction?.length)) {
      if (isAr) return t.aiSubtitle;
      return (
        <span>
          {t.aiSubtitle}
          {t.enAiNote ? (
            <span className="mt-1 block text-xs text-slate-500"> {t.enAiNote}</span>
          ) : null}
        </span>
      );
    }
    return t.subtitle;
  }, [data, isAr, loading, t]);

  return (
    <div
      className={cn("relative", className)}
      dir={isAr ? "rtl" : "ltr"}
      id="btec-grade-scale"
    >
      <div
        className="pointer-events-none absolute -inset-1 rounded-3xl bg-gradient-to-br from-amber-500/5 via-transparent to-violet-500/10 blur-xl"
        aria-hidden
      />
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl md:p-8">
        <div className="mb-6 text-center md:mb-8">
          <h2
            id="btec-scale-heading"
            className="mb-2 bg-gradient-to-r from-amber-200 via-yellow-100 to-cyan-200/90 bg-clip-text text-2xl font-bold text-transparent md:text-3xl"
          >
            {t.title}
          </h2>
          <div className="mx-auto max-w-3xl text-sm leading-relaxed text-slate-400 md:text-base">{subtitle}</div>
          {useDefaultsOnly && (
            <p className="mt-2 text-xs text-slate-500">
              {isAr
                ? "بعد رفع PDF موجز الواجب، نملأ هذا السلّم تلقائياً من نص الـ brief."
                : "Upload a PDF assignment brief to auto-fill this ladder from the file."}
            </p>
          )}
        </div>

        {loading ? (
          <ul className="grid list-none grid-cols-1 gap-4 md:grid-cols-3 md:gap-5" role="list">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-8"
              >
                <Loader2 className="h-8 w-8 shrink-0 animate-spin text-cyan-400" aria-hidden />
                <span className="mt-3 text-sm text-slate-400">
                  {isAr ? "Gemini يراجع المعايير…" : "Decoding rubric with Gemini…"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-4 md:grid-cols-3 md:gap-5" role="list">
            {levels.map((lv) => {
              const s = levelStyles[lv.key];
              const Icon = s.Icon;
              return (
                <li
                  key={lv.key}
                  className={cn(
                    "group flex min-h-0 flex-col rounded-2xl border bg-white/[0.02] p-5 transition-all duration-300",
                    s.ring,
                    s.glow,
                    "hover:-translate-y-0.5 hover:border-white/20",
                  )}
                >
                  <div className="mb-3 flex items-center gap-2 border-b border-white/5 pb-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-900/60",
                      )}
                      aria-hidden
                    >
                      <Icon className={cn("h-5 w-5", s.icon)} />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold leading-tight text-slate-100 md:text-base">
                        {lv.label}
                      </h3>
                      <p className="text-xs text-slate-500">{lv.short}</p>
                    </div>
                  </div>
                  <ul className="flex flex-1 flex-col gap-2.5 text-xs leading-relaxed text-slate-300 md:text-sm">
                    {lv.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                          aria-hidden
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
