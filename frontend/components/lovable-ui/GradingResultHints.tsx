"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Lightbulb } from "lucide-react";

type Props = {
  gradeBand?: string;
  language: "en" | "ar";
  /** When vector/corpus similarity was not used */
  corpusDegraded?: boolean;
};

/**
 * Short, educational hints next to results — not judgmental; explains levers to improve.
 */
export function GradingResultHints({ gradeBand, language, corpusDegraded }: Props) {
  const ar = language === "ar";

  const lines = useMemo(() => {
    const b = (gradeBand || "Pass").toLowerCase();
    if (ar) {
      if (b.includes("distinction")) {
        return {
          why: "تميّز يعني أن أدلتك قوية ومترابطة مع المعيار عند أعلى مستوى للوصف.",
          improve: "للحفاظ على المستوى: وضّح الصياغة التقييمية واربط كل فقرة بدليل صريح.",
        };
      }
      if (b.includes("merit")) {
        return {
          why: "جيد (Merit) يعني تجاوزت الحدّ الأدنى بأداء واضح يفوق التوقع الأساسي.",
          improve: "للاقتراب من التميّز: زِد عمق التحليل واربط النتائج بالأدلة حرفيًا من النص.",
        };
      }
      if (b.includes("not yet") || b.includes("fail")) {
        return {
          why: "المستوى لا يزال دون الحدّ المطلوب في المعيار — يمكن إعادة البناء مع أدلة أوضح.",
          improve: "ركّز على تغطية نقاط المعيار واحدًا واحدًا، واقتبس من إجابتك أو من المصادر المسموحة.",
        };
      }
      return {
        why: "ناجح (Pass) يعني استيفاء المتطلب الأساسي للمعيار كما وُصف في المهمة.",
        improve: "للصعود نحو Merit: أضف تحليلًا يشرح «لماذا» وليس فقط «ماذا»، مع مثال أو ربط أوضح بالمعيار.",
      };
    }
    if (b.includes("distinction")) {
      return {
        why: "Distinction reflects strong, well-linked evidence at the highest descriptor.",
        improve: "Keep evaluative language explicit and tie each paragraph to a concrete proof point.",
      };
    }
    if (b.includes("merit")) {
      return {
        why: "Merit means you clearly went beyond the minimum expectation.",
        improve: "To move up: deepen analysis and anchor claims with tighter citations to the work.",
      };
    }
    if (b.includes("not yet") || b.includes("fail")) {
      return {
        why: "The work has not yet met the required threshold—this is a roadmap, not a label.",
        improve: "Address each criterion explicitly and use clearer evidence from the response or allowed sources.",
      };
    }
    return {
      why: "Pass means the basic requirement of the criterion is met.",
      improve: "For Merit: add more ‘why it matters’ reasoning, with clearer links to the criterion text.",
    };
  }, [gradeBand, ar]);

  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-start",
        "shadow-[0_0_24px_rgba(6,182,212,0.08)]",
      )}
      role="status"
    >
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-200">
        <Lightbulb className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
        {ar ? "نصائح مفيدة" : "Helpful context"}
      </p>
      <p className="text-sm leading-relaxed text-slate-200/95">
        <span className="text-amber-200/90">💡 {ar ? "لماذا وصلتَ لهذه النتيجة: " : "Why this band: "}</span>
        {lines.why}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-200/90">
        <span className="text-emerald-200/85">{ar ? "للتطوير: " : "To improve: "}</span>
        {lines.improve}
      </p>
      {corpusDegraded && (
        <p className="mt-3 text-xs text-amber-200/80">
          {ar
            ? "تنبيه: واجهة المقارنة النصية كانت بسيطة في هذه الجولة — راجع الاقتباسات يدويًا عند الاعتماد."
            : "Note: text similarity was limited this run—double-check quotes before finalising."}
        </p>
      )}
    </div>
  );
}
