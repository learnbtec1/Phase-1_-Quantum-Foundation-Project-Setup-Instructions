"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Crown, Loader2, Lock, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { fetchWithSession, readFastApiDetail } from "@/lib/api";
import { isProWriterUnlocked } from "@/lib/subscription";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Wire to FastAPI when ready — must return outline/scaffolding only (not full model answers) per product spec. */
const SOLUTION_SCAFFOLD_ENDPOINT = "/api/v1/pro-writer/solution-scaffold";

const BRIEF_STORAGE = "cogni_pro_writer_brief";
const EDITOR_STORAGE = "cogni_pro_writer_editor";
const OUTLINE_STORAGE = "cogni_pro_writer_outline";

export default function ProWriterPage() {
  const [planLoading, setPlanLoading] = useState(true);
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [assignmentBrief, setAssignmentBrief] = useState("");
  const [editorText, setEditorText] = useState("");
  const [outline, setOutline] = useState("");
  const [outlineLoading, setOutlineLoading] = useState(false);

  const hasAccess = isProWriterUnlocked(subscriptionPlan);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithSession("/api/v1/auth/me", { method: "GET" });
        if (cancelled) return;
        if (r.ok) {
          const j = (await r.json()) as { subscription_plan?: string };
          setSubscriptionPlan((j.subscription_plan || "free").toLowerCase());
        } else {
          setSubscriptionPlan("free");
        }
      } catch {
        if (!cancelled) setSubscriptionPlan("free");
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      setAssignmentBrief(localStorage.getItem(BRIEF_STORAGE) || "");
      setEditorText(localStorage.getItem(EDITOR_STORAGE) || "");
      setOutline(localStorage.getItem(OUTLINE_STORAGE) || "");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(BRIEF_STORAGE, assignmentBrief);
    } catch {
      /* ignore */
    }
  }, [assignmentBrief, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(EDITOR_STORAGE, editorText);
    } catch {
      /* ignore */
    }
  }, [editorText, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(OUTLINE_STORAGE, outline);
    } catch {
      /* ignore */
    }
  }, [outline, ready]);

  const requestScaffold = useCallback(async () => {
    if (!hasAccess) return;
    const brief = assignmentBrief.trim();
    if (!brief) {
      toast.error("الصق نص واجهة المطلوب (Brief) يساراً أولاً.");
      return;
    }
    setOutlineLoading(true);

    try {
      const r = await fetchWithSession(SOLUTION_SCAFFOLD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_brief: brief }),
      });

      if (r.status === 404) {
        // Endpoint not deployed yet: dev-friendly placeholder (scaffold only, no full answer).
        await new Promise((x) => setTimeout(x, 600));
        // eslint-disable-next-line no-console
        console.log("[pro-writer] scaffold placeholder — wire FastAPI:", SOLUTION_SCAFFOLD_ENDPOINT, {
          briefLength: brief.length,
        });
        setOutline(
          [
            "هيكل إرشادي (مثال حتى تُفعّل الـ API):",
            "• فهم الـ brief والفعل المطلوب (معلومات/تحليل/تقييم).",
            "• تخطيط فقرات: مقدّمة (النطاق) → تطوير مع معايير P/M/D → خاتمة.",
            "• لكل معيار: نقطة مُلخّصة + أين تجد الأدلة في مذكّرتك (بدون نصٍ جاهز).",
            "• تذكير: المنصة لا تستبدل حكمك الأكاديمي وتلتزم بسياسة النزاهة.",
          ].join("\n"),
        );
        toast.message("وضع التطوير: أضف الـ endpoint لربط الـ FastAPI", { duration: 4_000 });
        return;
      }

      if (!r.ok) {
        const d = await readFastApiDetail(r);
        throw new Error(d || r.statusText);
      }

      const data = (await r.json()) as { outline?: string; scaffolding?: string; detail?: string };
      const o = (data.outline || data.scaffolding || data.detail || "").trim();
      if (o) {
        setOutline(o);
        // eslint-disable-next-line no-console
        console.log("[pro-writer] scaffold received, length:", o.length);
        return;
      }
      throw new Error("empty response");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[pro-writer] scaffold error:", e);
      toast.error("تعذّر توليد المسودة. راجع الـ API أو أعد المحاولة.");
    } finally {
      setOutlineLoading(false);
    }
  }, [hasAccess, assignmentBrief]);

  if (planLoading) {
    return (
      <div
        className="flex min-h-[50vh] items-center justify-center"
        style={{ backgroundColor: "#020617" }}
        dir="rtl"
      >
        <Loader2 className="h-10 w-10 animate-spin text-amber-400" aria-label="جاري التحميل" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div
        className="relative min-h-[calc(100dvh-10rem)] overflow-hidden rounded-2xl p-4 sm:p-8"
        style={{ backgroundColor: "#020617" }}
        dir="rtl"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(245, 158, 11, 0.15), transparent 55%)",
          }}
        />
        <div
          className="relative z-10 mx-auto flex max-w-lg flex-col items-center text-center"
          style={{ marginTop: "8vh" }}
        >
          <div
            className={cn(
              "w-full rounded-2xl border border-amber-500/25 p-8 shadow-2xl",
              "bg-slate-950/70 backdrop-blur-2xl",
              "ring-1 ring-amber-500/20",
            )}
          >
            <div className="mb-4 flex justify-center">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
                <Lock className="h-8 w-8 text-amber-400" aria-hidden />
              </span>
            </div>
            <Crown className="mx-auto mb-2 h-6 w-6 text-amber-400" aria-hidden />
            <h2 className="text-2xl font-bold text-amber-100 sm:text-3xl">مساعد كتابة الحلول <span className="text-amber-500">PRO</span></h2>
            <p className="mt-2 text-balance text-sm text-slate-400">
              هذه المساحة مخصّصة لمشتركي PRO و Unlimited. ترقية سريعة تفتح محرراً ومساعد كوجني للهيكل فقط
              — بما يلتزم بنزاهة المخرجات الأكاديمية.
            </p>
            <Button
              asChild
              className={cn(
                "mt-8 w-full rounded-xl border-2 border-amber-500/50 py-6 text-base font-bold text-amber-950",
                "bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500",
                "shadow-[0_0_40px_rgba(251,191,36,0.45)] transition hover:scale-[1.02] hover:shadow-[0_0_50px_rgba(245,158,11,0.5)]",
              )}
            >
              <Link href="/pricing">الترقية إلى PRO</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-[calc(100dvh-10rem)] overflow-hidden"
      style={{ backgroundColor: "#020617" }}
      dir="rtl"
    >
      <div className="pointer-events-none select-none opacity-50 blur-[2px]" aria-hidden>
      <div
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 50% 50%, rgba(180, 83, 9, 0.12) 0%, transparent 50%),
            #020617
          `,
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-0 opacity-50"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(251, 191, 36, 0.15), transparent 60%)",
        }}
      />

      <div className="relative z-10 flex min-h-0 flex-col gap-3 pb-2 pt-0 sm:gap-4">
        <div className="shrink-0 text-center sm:text-start">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-400" aria-hidden />
            <h1
              className="text-2xl font-bold tracking-tight sm:text-3xl"
              style={{ textShadow: "0 0 28px rgba(251, 191, 36, 0.4)" }}
            >
              <span className="bg-gradient-to-l from-amber-200 via-amber-300 to-amber-600 bg-clip-text text-transparent">
                مساعد كتابة الحلول
              </span>
            </h1>
            <span
              className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200"
            >
              PRO
            </span>
          </div>
          <p className="mt-2 text-pretty text-sm text-slate-400 sm:max-w-3xl">
            بـ RTL: يمين الشاشة = محرّر Pro، يسارها = «كوجني» لهيكل/مسوّدة من الـ brief — دون حلٍ نهائي جاهز
            (نزاهة أكاديمية).
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
          <section
            className={cn(
              "flex min-h-[320px] flex-col rounded-2xl border border-amber-500/20 p-4",
              "bg-white/[0.04] shadow-[0_0_40px_rgba(0,0,0,0.35)] backdrop-blur-3xl sm:min-h-[420px]",
            )}
          >
            <h2 className="mb-2 text-sm font-semibold text-amber-200/90">محرّر Pro</h2>
            <textarea
              disabled
              className={cn(
                "min-h-[60vh] w-full flex-1 resize-none rounded-xl border border-white/10",
                "bg-transparent px-4 py-3 text-lg leading-relaxed text-slate-100",
                "placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
                "selection:bg-cyan-500/25",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
              dir="rtl"
              placeholder="اكتب حلك هنا line-by-line…"
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
            />
          </section>

          <section
            className={cn(
              "flex min-h-[320px] flex-col rounded-2xl border border-amber-500/20 p-4",
              "bg-white/[0.04] shadow-[0_0_40px_rgba(0,0,0,0.35)] backdrop-blur-3xl sm:min-h-[420px]",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200/90">
                <Wand2 className="h-4 w-4" aria-hidden />
                Cogni — مساعد المخطط
              </h2>
            </div>
            <p className="mb-2 text-xs text-slate-500">الصق واجهة المطلوب (Assignment Brief) أدناه</p>
            <textarea
              disabled
              className={cn(
                "mb-3 min-h-[7rem] w-full flex-1 resize-y rounded-xl border border-white/10",
                "bg-slate-950/40 px-3 py-2 text-sm text-slate-100",
                "placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
              dir="rtl"
              placeholder="نص الـ brief من المعلم أو الوحدة…"
              value={assignmentBrief}
              onChange={(e) => setAssignmentBrief(e.target.value)}
            />
            <Button
              type="button"
              onClick={requestScaffold}
              disabled
              className={cn(
                "mb-3 w-full rounded-xl border border-amber-500/30 py-5 font-bold text-amber-950",
                "bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500",
                "shadow-[0_0_24px_rgba(251,191,36,0.35)] transition hover:scale-[1.01] hover:shadow-[0_0_32px_rgba(245,158,11,0.45)]",
                "disabled:opacity-60",
              )}
            >
              {outlineLoading ? (
                <Loader2 className="ms-2 h-5 w-5 animate-spin" />
              ) : (
                <Sparkles className="ms-2 h-4 w-4" />
              )}
              إنشاء مسودة احترافية
            </Button>
            <div
              className={cn(
                "min-h-[10rem] flex-1 overflow-auto rounded-xl border border-white/10 p-3",
                "bg-slate-950/30 text-sm leading-relaxed text-slate-200",
              )}
            >
              {outline ? (
                <pre className="whitespace-pre-wrap font-sans text-start">{outline}</pre>
              ) : (
                <p className="text-slate-500">سيظهر هنا الهيكل المقترح (scaffolding) بعد الضغط على الزر — وليس
                  نص حلٍ جاهز.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      </div>

      <div
        className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center p-4 sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-writer-coming-soon-title"
      >
        <div
          className={cn(
            "w-full max-w-md rounded-2xl border border-amber-500/30 p-6 text-center shadow-2xl",
            "bg-slate-950/80 backdrop-blur-2xl",
            "ring-1 ring-amber-500/20",
          )}
        >
          <div className="mb-3 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
              <Lock className="h-8 w-8 text-amber-400" aria-hidden />
            </span>
          </div>
          <h2
            id="pro-writer-coming-soon-title"
            className="text-lg font-bold text-amber-100 sm:text-xl"
          >
            قيد التطوير
          </h2>
          <p className="mt-2 text-balance text-sm leading-relaxed text-slate-300">
            مساعد بناء الحلول قيد التطوير والتوافق مع معايير Pearson.{" "}
            <span className="font-mono text-amber-200/90">(Coming Soon)</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            تُعطّل المدخلات مؤقتاً لتجنب تجارب الـ placeholder حتى اكتمال الـ API.
          </p>
        </div>
      </div>
    </div>
  );
}
