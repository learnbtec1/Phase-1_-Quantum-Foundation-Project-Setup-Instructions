"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, Fingerprint, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AIIntegrityWarning } from "@/components/assessment/ai-integrity-warning";
import { RubricPreview } from "@/components/assessment/rubric-preview";
import { BtecExportDialog } from "@/components/workspace/btec-export-dialog";
import { fetchWithSession } from "@/lib/api";
import { setEduverseDraftText } from "@/lib/eduverseDraft";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cogni_workspace_draft";

type RewriteApiPayload = {
  improved?: string;
  notes?: string[];
  style_guard_triggered?: boolean;
  target_level?: string;
};

function detailFromErrorBody(body: unknown): string {
  if (!body || typeof body !== "object") return "تعذّر إكمال الطلب.";
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length > 0 && typeof d[0] === "object" && d[0] && "msg" in d[0]) {
    return String((d[0] as { msg: string }).msg);
  }
  return "تعذّر إكمال الطلب.";
}

const MIN_HANDOFF_CHARS = 20;

export default function WorkspacePage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteAllowed, setRewriteAllowed] = useState(true);
  const [improvedBlock, setImprovedBlock] = useState<RewriteApiPayload | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved != null) setText(saved);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {
      /* ignore */
    }
  }, [text, ready]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const r = await fetchWithSession("/api/v1/student-rewrite/allowed");
        if (!r.ok) return;
        const j = (await r.json()) as { allowed?: boolean };
        if (!cancel) setRewriteAllowed(!!j.allowed);
      } catch {
        if (!cancel) setRewriteAllowed(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const handoffToRoute = useCallback(
    (path: "/plagiarism" | "/assessment") => {
      const t = text.trim();
      if (t.length < MIN_HANDOFF_CHARS) {
        toast.error(
          `الصق أو اكتب نص حلّك أولاً (على الأقل ${MIN_HANDOFF_CHARS} حرفاً) لنقله إلى ${path === "/plagiarism" ? "فحص الانتحال" : "تقييم BTEC"}.`
        );
        return;
      }
      setEduverseDraftText(t);
      router.push(path);
    },
    [text, router]
  );

  const runRewriteAfterConsent = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      toast.error("الصق أو اكتب نص حلّك أولاً.");
      return;
    }
    if (!rewriteAllowed) {
      toast.error("ميزة التحسين غير مفعّلة لسياسة المؤسسة.");
      return;
    }
    setRewriteLoading(true);
    setImprovedBlock(null);
    try {
      const r = await fetchWithSession("/api/v1/student-rewrite/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t,
          target_level: "Merit",
        }),
      });
      const raw = await r.json().catch(() => ({}));
      if (r.status === 401) {
        toast.error("سجّل الدخول لاستخدام التحسين الإرشادي.");
        return;
      }
      if (!r.ok) {
        toast.error(detailFromErrorBody(raw));
        return;
      }
      const p = raw as RewriteApiPayload;
      setImprovedBlock(p);
      toast.success("تم توليد نسخة إرشادية — راجعها دون نسخها حرفياً كتسليم نهائي.");
    } catch {
      toast.error("تعذّر الاتصال بالخادم.");
    } finally {
      setRewriteLoading(false);
    }
  }, [text, rewriteAllowed]);

  const canUseRewrite = ready && rewriteAllowed;
  const rewriteDisabled = !canUseRewrite || !text.trim();

  return (
    <div
      className="relative flex min-h-[calc(100dvh-12rem)] flex-col"
      style={{ backgroundColor: "#030712" }}
      dir="rtl"
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(34, 211, 238, 0.12), transparent 50%), radial-gradient(ellipse 50% 30% at 100% 100%, rgba(251, 191, 36, 0.08), transparent 45%)",
        }}
      />

      <div className="relative z-0 flex min-h-0 flex-1 flex-col px-3 pb-28 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-4 max-w-2xl shrink-0 self-center text-center sm:mb-6">
          <div className="inline-flex items-center justify-center gap-2">
            <Edit3 className="h-6 w-6 text-amber-400/90 sm:h-7 sm:w-7" aria-hidden />
            <h1
              className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl"
              style={{
                textShadow: "0 0 32px rgba(251, 191, 36, 0.35), 0 0 64px rgba(34, 211, 238, 0.12)",
              }}
            >
              <span className="bg-gradient-to-l from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
                مساحة عمل الطالب
              </span>
            </h1>
          </div>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-400 sm:text-base">
            مُحرّر مباشر لكتابة أو لصق حل واجبك (BTEC) داخل المنصة — دون رفع ملف. يُحفظ تلقائياً في
            متصفحك.
          </p>
        </header>

        <RubricPreview className="max-w-4xl self-center" />

        <div
          className={cn(
            "flex min-h-[60vh] flex-1 flex-col rounded-2xl border border-white/10",
            "bg-white/[0.02] backdrop-blur-2xl",
            "shadow-[0_0_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]",
          )}
        >
          <textarea
            className={cn(
              "min-h-[50vh] w-full flex-1 resize-none rounded-2xl",
              "bg-transparent px-4 py-5 sm:px-6 sm:py-6",
              "text-lg leading-relaxed text-slate-100 placeholder:text-slate-500",
              "outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 focus:ring-offset-[#030712]",
              "selection:bg-cyan-500/30",
            )}
            dir="rtl"
            spellCheck
            placeholder="اكتب أو الصق نص حلّك هنا…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!ready}
            aria-label="محرر نص الواجب"
          />

          {improvedBlock && (
            <div className="border-t border-amber-500/20 bg-amber-950/10 px-4 py-4 sm:px-6 sm:py-5">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-200/90">
                <Wand2 className="h-3.5 w-3.5" aria-hidden />
                نسخة إرشادية (وليست تسليماً نهائياً) — باتجاه {improvedBlock.target_level ?? "Merit"}
              </p>
              {improvedBlock.style_guard_triggered ? (
                <p className="mb-2 text-xs text-amber-200/80">
                  تم تعليق التعديل تلقائياً (Style Guard) أو الاسترجاع محدودٌ. راجع نصك الأصلي أعلاه.
                </p>
              ) : null}
              <div className="max-h-64 overflow-y-auto rounded-lg border border-amber-800/30 bg-slate-950/40 p-3 text-sm leading-relaxed text-slate-200">
                <p className="whitespace-pre-wrap">{improvedBlock.improved || "—"}</p>
              </div>
              {Array.isArray(improvedBlock.notes) && improvedBlock.notes.length > 0 ? (
                <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-400">
                  {improvedBlock.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-20 border-t border-white/10",
          "bg-slate-950/75 backdrop-blur-2xl",
          "px-3 py-3 sm:px-6 sm:py-4",
        )}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        dir="rtl"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
          <button
            type="button"
            onClick={() => handoffToRoute("/plagiarism")}
            className={cn(
              "group relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden",
              "rounded-xl border border-violet-400/30 px-5 py-3 text-sm font-semibold text-violet-100",
              "bg-gradient-to-l from-violet-900/80 to-fuchsia-900/50",
              "shadow-[0_0_24px_rgba(139,92,246,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]",
              "transition duration-200 ease-out",
              "hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(168,85,247,0.4)]",
              "active:scale-[0.98]",
            )}
          >
            <Fingerprint className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
            فحص البصمة الرقمية
          </button>

          <div className="flex min-w-0 flex-1 justify-center sm:flex-none sm:justify-stretch">
            <span title={!rewriteAllowed ? "ميزة التحسين معطّلة بسياسة المؤسسة" : undefined}>
              <AIIntegrityWarning
                isLoading={rewriteLoading}
                disabled={rewriteDisabled}
                buttonText="تحسين النص ذكياً"
                onAccept={() => {
                  void runRewriteAfterConsent();
                }}
              />
            </span>
          </div>

          <button
            type="button"
            onClick={() => handoffToRoute("/assessment")}
            className={cn(
              "group relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden",
              "rounded-xl border border-amber-500 px-5 py-3 text-sm font-semibold text-amber-950",
              "bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500",
              "shadow-[0_0_28px_rgba(251,191,36,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]",
              "transition duration-200 ease-out",
              "hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(250,204,21,0.55)]",
              "active:scale-[0.98]",
            )}
          >
            <Sparkles className="h-5 w-5 shrink-0 text-amber-900/90 transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6" />
            تقييم الواجب
          </button>

          <BtecExportDialog text={text} className="min-w-0 sm:min-w-[10rem] sm:max-w-xs" />
        </div>
      </div>
    </div>
  );
}
