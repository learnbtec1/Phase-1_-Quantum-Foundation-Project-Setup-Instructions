"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Award, Map, MessageCircle, Sparkles, Target, TrendingUp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/lovable-ui/ui/accordion";
import { cn } from "@/lib/utils";

const LEVELS: {
  id: string;
  title: string;
  short: string;
  border: string;
  icon: LucideIcon;
  body: ReactNode;
}[] = [
  {
    id: "pass",
    title: "Pass (ناجح — P)",
    short: "الوصف والشرح",
    border: "border-amber-500/30",
    icon: Target,
    body: (
      <>
        تُقارَن إجابتك بمعيار <strong className="text-amber-200/90">Pass</strong> عندما تُظهر فهماً أساسياً: صف{" "}
        <strong className="text-amber-200/90">ما</strong> يحدث، <strong className="text-amber-200/90">لماذا</strong>{" "}
        بسيطة، وربط مباشر بالمهمة. الأسلوب ممكن يكون مباشر — المهم{" "}
        <strong className="text-amber-200/90">أدلة</strong> من عملك/الملفات تدعم كل معيار P.
      </>
    ),
  },
  {
    id: "merit",
    title: "Merit (جيد — M)",
    short: "التحليل والعلائق",
    border: "border-sky-500/35",
    icon: TrendingUp,
    body: (
      <>
        مستوى <strong className="text-amber-200/90">Merit</strong> يتطلب{" "}
        <strong className="text-amber-200/90">تحليلاً</strong>: تربط عاملين أو أكثر (سبب-نتيجة، مقارنة،
        عواقب)، مو بس وصف. لازم تبان <strong className="text-amber-200/90">كيف</strong> الأفكار تتصل، مع
        أمثلة أو إشارة واضحة للمعيار في النص.
      </>
    ),
  },
  {
    id: "distinction",
    title: "Distinction (متميّز — D)",
    short: "التقييم المبرّر",
    border: "border-cyan-500/35",
    icon: Award,
    body: (
      <>
        لـ <strong className="text-amber-200/90">Distinction</strong> يلزم{" "}
        <strong className="text-amber-200/90">تقييماً مبرراً</strong>: تناقش بدائل أو قيود، توزن نقاط قوة/ضعف،
        وتقدّم <strong className="text-amber-200/90">حكماً</strong> مدعوماً بأدلة. التسمية «تقييم» وحدها لا تكفي
        — لازم يبان <strong className="text-amber-200/90">الحكم</strong> و
        <strong className="text-amber-200/90">الدليل</strong> في إجابتك.
      </>
    ),
  },
];

/**
 * BTEC P/M/D roadmap before submission — read-only, educational (not assignment-specific).
 */
export function RubricPreview({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "mb-4 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/25 to-sky-950/15 p-4 shadow-[0_0_32px_rgba(251,191,36,0.06)] backdrop-blur-sm sm:mb-6 sm:p-5",
        className,
      )}
      dir="rtl"
      aria-labelledby="rubric-preview-title"
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/10 text-amber-200">
          <Map className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <h2
            id="rubric-preview-title"
            className="text-sm font-bold leading-tight text-amber-100 sm:text-base"
          >
            خريطة التقيّم (BTEC) قبل ما تسلّم
          </h2>
          <p className="text-xs leading-relaxed text-slate-400 sm:text-sm">
            المعايير الفعلية تجي من **واجبك** (الملف/المعلّم). هذا ملخص **كيف** يفكّر المقيّم: Pass
            = أساسٌ، Merit = ربط وتحليل، Distinction = حكمٌ مبرّر.
          </p>
        </div>
        <span className="ms-auto hidden h-7 items-center gap-1 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2 text-[0.65rem] font-medium text-sky-200/90 sm:flex">
          <Sparkles className="h-3 w-3" />
          مرجع سريع
        </span>
      </div>

      <Accordion type="single" collapsible className="w-full" defaultValue="pass">
        {LEVELS.map((level) => {
          const Icon = level.icon;
          return (
            <AccordionItem
              key={level.id}
              value={level.id}
              className={cn("border-b border-white/5 last:border-0", level.border, "border-s-2 ps-2")}
            >
              <AccordionTrigger className="py-3 text-right hover:no-underline [&[data-state=open]]:text-amber-100">
                <div className="flex w-full items-center justify-between gap-2 text-right">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-amber-300/90" />
                    <span className="truncate text-sm font-semibold text-slate-100 sm:text-base">
                      {level.title}
                    </span>
                  </div>
                  <span className="shrink-0 text-[0.7rem] text-slate-500">{level.short}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="text-slate-300">
                <p className="flex gap-2 text-xs leading-relaxed sm:text-sm">
                  <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                  <span className="[&_strong]:font-semibold [&_strong]:text-amber-200/90">{level.body}</span>
                </p>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </section>
  );
}
