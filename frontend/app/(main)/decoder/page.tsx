"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Briefcase,
  CheckSquare,
  ClipboardList,
  Edit3,
  FileText,
  Link,
  Loader2,
  type LucideIcon,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/lovable-ui/ui/button";
import { useAppTheme } from "@/contexts/ThemeContext";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { renderPartialSolution } from "@/lib/decoder/renderPartialSolution";
import { cn } from "@/lib/utils";

async function parseFileViaNextRoute(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/parse-file", { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || res.statusText || "Parse failed");
  }
  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(String(data.error));
  return (data.text ?? "").trim();
}

type ScaffoldStepType = "breakdown" | "theory" | "application" | "bridging" | "checklist";

type ApiScaffoldStep = {
  title: string;
  instructions: string;
  partial_solution?: string;
  type: ScaffoldStepType;
};

const stepTypeIcon: Record<ScaffoldStepType, LucideIcon> = {
  breakdown: Search,
  theory: BookOpen,
  application: Briefcase,
  bridging: Link,
  checklist: CheckSquare,
};

const stepTypeBorder: Record<ScaffoldStepType, string> = {
  breakdown: "border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.12)]",
  theory: "border-violet-500/30 shadow-[0_0_20px_rgba(139,92,246,0.12)]",
  application: "border-amber-500/30 shadow-[0_0_24px_rgba(234,179,8,0.12)]",
  bridging: "border-fuchsia-500/30 shadow-[0_0_20px_rgba(217,70,239,0.12)]",
  checklist: "border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.12)]",
};

export default function BriefDecoderPage() {
  const router = useRouter();
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [file, setFile] = useState<File | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<ApiScaffoldStep[]>([]);
  const [extractedHint, setExtractedHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = useCallback(() => inputRef.current?.click(), []);
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setFileLabel(f.name);
      setSteps([]);
      setExtractedHint(null);
    }
  }, []);

  const handleDecode = useCallback(async () => {
    const pasted = pastedText.trim();
    if (!file && pasted.length < 20) {
      toast.error(
        ar
          ? "ارفع ملف الـ Brief أو الصق نصاً كاملاً (20 حرفاً على الأقل)."
          : "Upload a file or paste at least 20 characters of the brief text."
      );
      return;
    }
    setLoading(true);
    setExtractedHint(null);
    setSteps([]);
    try {
      let text = "";
      if (pasted.length >= 20) {
        text = pasted;
        setExtractedHint(
          ar
            ? `استخدام نصٍ مُلصق (${text.length.toLocaleString("ar-EG")} حرف) — جارٍ إنشاء الهيكل…`
            : `Using pasted text (${text.length} chars) — generating scaffold…`
        );
      } else {
        if (!file) {
          throw new Error(ar ? "لا يوجد ملف" : "No file");
        }
        text = await parseFileViaNextRoute(file);
        if (!text || text.length < 20) {
          throw new Error(
            ar
              ? "لم نستخرج نصاً كفاية من الملف. جرّب PDF/Word أقل تعقيداً، أو انسخ النص والصقه في المربع أدناه."
              : "Extracted text is too short. Try another file, or paste the brief text in the box below."
          );
        }
        setExtractedHint(
          ar
            ? `تم استخراج ${text.length.toLocaleString("ar-EG")} حرف — جارٍ إنشاء الهيكل…`
            : `${text.length.toLocaleString()} characters extracted — generating scaffold…`
        );
      }

      const res = await fetchWithSession("/api/v1/assessment/decode-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status === 401) {
        const d = await readFastApiDetail(res);
        if (shouldSignOutOn401(d)) {
          toast.error(ar ? "انتهت الجلسة" : "Session expired");
          signOutOnUnauthorized();
        } else {
          toast.error(d || (ar ? "غير مصرّح" : "Unauthorized"));
        }
        return;
      }
      if (res.status === 503) {
        const d = await readFastApiDetail(res);
        throw new Error(
          d ||
            (ar
              ? "الخادم غير مُهيأ لمفتاح OpenAI. راجع إعدادات المشرف (OPENAI_API_KEY)."
              : "API not configured (OpenAI). Check OPENAI_API_KEY.")
        );
      }
      if (!res.ok) {
        const d = await readFastApiDetail(res);
        throw new Error(d || (ar ? "تعذّر تفكيك الواجب" : "Could not decode the brief"));
      }
      const data = (await res.json()) as { steps?: ApiScaffoldStep[] };
      const list = data.steps ?? [];
      if (list.length === 0) {
        throw new Error(
          ar ? "لم تُرجع الخدمة أيّ خطوات. حاول إعادة الصياغة أو إطالة نص الـ Brief." : "No scaffold steps returned."
        );
      }
      setSteps(list);
      toast.success(ar ? "جاهز: هيكل إرشادي 60/40 مع فراغات [أكمل أنت]" : "Scaffold ready (60/40 with [أكمل أنت] gaps)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [ar, file, pastedText]);

  return (
    <div
      className="relative min-h-0 w-full overflow-x-hidden bg-[#030712] font-sans text-slate-100"
      dir={ar ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div className="absolute -left-1/4 top-0 h-[420px] w-[420px] rounded-full bg-fuchsia-600/20 blur-[120px] animate-pulse" />
        <div
          className="absolute -right-1/4 bottom-0 h-[380px] w-[420px] rounded-full bg-amber-500/10 blur-[100px] animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[90px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 md:py-14">
        <header className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-xs text-amber-200/90">
            <ClipboardList className="h-3.5 w-3.5" />
            {ar ? "أداة الطالب" : "Student tool"}
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
          </div>
          <h1 className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 bg-clip-text text-3xl font-bold text-transparent drop-shadow-[0_0_28px_rgba(234,179,8,0.35)] md:text-4xl">
            {ar ? "مُفكك شيفرة الواجبات" : "BTEC Brief Decoder"}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
            {ar
              ? "منهجية شبه-حل (60/40): نعطيك هيكلاً وأمثلة واضحة، ونترك فراغات بعلامة [أكمل أنت] لتكمل بكلماتك — بلا تسليم جاهز للنسخ."
              : "Scaffolding (60/40): structure and examples, with explicit [أكمل أنت] gaps you must fill in your own words — not a copy-paste submission."}
          </p>
        </header>

        <section className="mb-8">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.txt"
            className="hidden"
            onChange={onFile}
          />
          <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-1 shadow-[0_4px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all duration-500 hover:border-cyan-500/35">
            <div
              onClick={onPick}
              onKeyDown={(e) => e.key === "Enter" && onPick()}
              role="button"
              tabIndex={0}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-cyan-500/25 bg-slate-950/40 px-6 py-10 transition-all duration-500 group-hover:border-cyan-400/50"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/5 text-cyan-300">
                <Upload className="h-7 w-7" />
              </div>
              <p className="text-center text-sm font-medium text-slate-200">
                {ar ? "إسقاط ملف الـ Brief (PDF / Word / PPTX / نص)" : "Drop your assignment brief (file)"}
              </p>
              <p className="text-center text-xs text-slate-500">
                {fileLabel ? <span className="text-cyan-200/80">{fileLabel}</span> : ar ? "انقر للاختيار" : "Click to select"}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-slate-400" htmlFor="decoder-paste">
              {ar
                ? "أو الصق نص الـ Brief / المعايير هنا (مفيد إذا فشل استخراج الـ PDF)"
                : "Or paste the full brief / criteria (if file extraction is poor)"}
            </label>
            <textarea
              id="decoder-paste"
              className="min-h-[7rem] w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              dir="auto"
              placeholder={ar ? "الصق نص وصف الواجب والمعايير (عربي/إنكليزي)…" : "Paste assignment text…"}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              size="lg"
              disabled={loading}
              onClick={() => void handleDecode()}
              className="h-12 min-w-[10rem] border border-amber-400/50 bg-slate-950/80 text-amber-100 shadow-[0_0_32px_rgba(234,179,8,0.2)] transition-all hover:border-amber-300 hover:shadow-[0_0_44px_rgba(234,179,8,0.38)] disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              <span className="ms-2">{ar ? "ابنِ الشبه-حل" : "Build scaffold"}</span>
            </Button>
          </div>
          {extractedHint && !loading && (
            <p className="mt-4 text-center text-xs text-slate-500" role="status">
              {extractedHint}
            </p>
          )}
        </section>

        {loading && (
          <section
            className="mb-10 flex flex-col items-center justify-center gap-4 rounded-2xl border border-amber-500/20 bg-slate-950/60 p-8 text-center shadow-[0_0_40px_rgba(234,179,8,0.08)] backdrop-blur-xl"
            aria-live="polite"
            role="status"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/10">
              <Loader2 className="h-8 w-8 animate-spin text-amber-200" />
            </div>
            <div>
              <p className="text-lg font-semibold text-amber-100/95">
                {ar ? "جارٍ توليد الهيكل الإرشادي…" : "Generating your Scaffold…"}
              </p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-400">
                {ar
                  ? "نحوّل نص الـ Brief إلى خطوات تعليمية وفراغات [أكمل أنت] — قد يستغرق الأمر بضع ثوانٍ."
                  : "Turning your brief into pedagogical steps and [أكمل أنت] gaps — this can take a few seconds."}
              </p>
            </div>
          </section>
        )}

        {steps.length > 0 && !loading && (
          <section className="space-y-6">
            <h2 className="text-center text-lg font-semibold leading-relaxed text-slate-200 md:text-xl">
              {ar ? "هيكل إرشادي — خطوة بخطوة" : "Your scaffold — step by step"}
            </h2>

            <ul className="grid grid-cols-1 gap-4 md:gap-5">
              {steps.map((step, idx) => {
                const st = stepTypeIcon[step.type] ? step.type : "breakdown";
                const Icon = stepTypeIcon[st];
                return (
                  <li key={`${idx}-${step.title}`}>
                    <article
                      className={cn(
                        "overflow-hidden rounded-2xl border bg-slate-950/45 p-4 backdrop-blur-md md:p-6",
                        stepTypeBorder[st]
                      )}
                    >
                      <div className="mb-4 flex flex-wrap items-start gap-3 border-b border-white/5 pb-4">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]"
                          aria-hidden
                        >
                          <Icon className="h-5 w-5 text-amber-200/90" />
                        </div>
                        <div className="min-w-0 flex-1 text-start">
                          <p className="text-[0.7rem] font-mono uppercase tracking-wider text-slate-500" dir="ltr">
                            {step.type}
                          </p>
                          <h3 className="mt-0.5 text-base font-bold leading-relaxed text-slate-50 md:text-lg">
                            {step.title}
                          </h3>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="mb-1.5 text-xs font-bold uppercase text-slate-500">
                            {ar ? "تعليمات" : "Instructions"}
                          </p>
                          <p className="whitespace-pre-wrap rounded-lg border border-white/5 bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-200">
                            {step.instructions}
                          </p>
                        </div>
                        {(step.partial_solution ?? "").trim() ? (
                          <div>
                            <p className="mb-1.5 text-xs font-bold uppercase text-amber-200/70">
                              {ar ? "شبه حل (أكمل الفراغات)" : "Partial scaffold (fill the gaps)"}
                            </p>
                            <p className="whitespace-pre-wrap rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-sm leading-relaxed text-amber-50/95">
                              {renderPartialSolution(step.partial_solution ?? "")}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>

            <p className="mt-6 rounded-xl border border-white/5 bg-slate-950/40 p-4 text-center text-xs leading-relaxed text-slate-500">
              {ar
                ? "هذا النموذج هو هيكل إرشادي. إكمال الفراغات بنسخ ولصق من الإنترنت سيعرضك للرسوب في فحص الانتحال."
                : "This is a guidance scaffold. Pasting from the web into the gaps can still fail plagiarism checks — use your own words."}
            </p>

            <div className="flex justify-center pt-2">
              <Button
                type="button"
                size="lg"
                onClick={() => router.push("/workspace")}
                className="h-12 min-w-[min(100%,20rem)] gap-2 border border-cyan-400/40 bg-cyan-500/15 text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.2)] transition-all hover:border-cyan-300 hover:bg-cyan-500/25 hover:shadow-[0_0_40px_rgba(34,211,238,0.35)]"
              >
                <Edit3 className="h-5 w-5 shrink-0" aria-hidden />
                {ar ? "ابدأ كتابة الواجب في مساحة العمل" : "Start writing in Workspace"}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
