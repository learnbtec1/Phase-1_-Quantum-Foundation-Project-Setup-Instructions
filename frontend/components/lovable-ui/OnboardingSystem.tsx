"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/lovable-ui/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, Lightbulb, Loader2, Sparkles, X } from "lucide-react";

export const ONBOARDING_DONE_KEY = "eduverse_onboarding_done";
const RESTART_EVENT = "eduverse:restart-onboarding";

const DEMO_SAMPLE_AR = `مثال قصير لنص طالب (للتجربة فقط):
«تُظهر الإجابة فهمًا أساسيًا لمتطلبات المهمة مع ربط بسيط بالمعايير. يمكن تعميق التحليل بربط أوضح بالأدلة من الملفات.»`;

const TOUR_STEPS = [
  {
    id: "nav-assessment",
    title: "التقييم",
    body: "هنا تُقيّم واجبات BTEC: أدخِل المعايير ونص الطالب ثم شغّل التقييم.",
  },
  {
    id: "nav-plagiarism",
    title: "فحص الانتحال",
    body: "اطّلع على التشابه مع المخزون المرجعي قبل اعتماد الدرجة النهائية.",
  },
  {
    id: "nav-dashboard",
    title: "لوحة التحكم",
    body: "مختصر لحسابك واستخدامك — نقطتك السريعة بعد تسجيل الدخول.",
  },
  {
    id: "assessment-run",
    title: "تشغيل التقييم",
    body: "بعد تعبئة الحقول، هذا الزر يشغّل المحرك — انتظر قليلًا حتى تظهر النتيجة.",
    needsPath: "/assessment",
  },
] as const;

function useMediaMd() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const fn = () => setOk(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return ok;
}

function markDone() {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, "true");
  } catch {
    /* ignore */
  }
}

type Flow = "welcome" | "tour" | "demo" | "explain";

export function OnboardingSystem() {
  const router = useRouter();
  const pathname = usePathname();
  const isMd = useMediaMd();
  const [active, setActive] = useState(false);
  const [flow, setFlow] = useState<Flow>("welcome");
  const [tourStep, setTourStep] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoDone, setDemoDone] = useState(false);

  const phase = flow === "welcome" || flow === "tour" ? 1 : flow === "demo" ? 2 : 3;

  const measure = useCallback(() => {
    const step = TOUR_STEPS[tourStep];
    if (!step) return;
    const el = document.querySelector(`[data-onboarding="${step.id}"]`) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - 10,
      left: r.left - 10,
      width: r.width + 20,
      height: r.height + 20,
    });
  }, [tourStep]);

  useLayoutEffect(() => {
    if (flow !== "tour" || !active) return;
    const step = TOUR_STEPS[tourStep];
    if (step && "needsPath" in step && step.needsPath && pathname !== step.needsPath) {
      router.push(step.needsPath);
    }
  }, [flow, tourStep, pathname, router, active]);

  useLayoutEffect(() => {
    if (flow !== "tour" || !active || !isMd) return;
    const t = window.setTimeout(() => measure(), 380);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [flow, tourStep, pathname, measure, active, isMd]);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem("eduverse_onboarding_v1_complete")) {
        localStorage.setItem(ONBOARDING_DONE_KEY, "true");
      }
      if (!localStorage.getItem(ONBOARDING_DONE_KEY)) {
        setActive(true);
        setFlow("welcome");
      }
    } catch {
      setActive(true);
    }
  }, []);

  useEffect(() => {
    const onRestart = () => {
      setTourStep(0);
      setDemoDone(false);
      setDemoLoading(false);
      setFlow("welcome");
      setActive(true);
    };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, []);

  function skipAll() {
    markDone();
    setActive(false);
  }

  function startTour() {
    setFlow("tour");
    setTourStep(0);
  }

  function tourNext() {
    if (tourStep < TOUR_STEPS.length - 1) {
      setTourStep((s) => s + 1);
    } else {
      setFlow("demo");
      setDemoDone(false);
    }
  }

  function tourPrev() {
    if (tourStep > 0) setTourStep((s) => s - 1);
  }

  function runDemo() {
    setDemoLoading(true);
    window.setTimeout(() => {
      setDemoLoading(false);
      setDemoDone(true);
    }, 1400);
  }

  function afterDemoContinue() {
    setFlow("explain");
  }

  function finishExplain() {
    markDone();
    setActive(false);
  }

  if (!mounted || !active) return null;

  return (
    <>
      {active && (
        <div
          className="pointer-events-none fixed start-0 top-0 z-[200] w-full px-4 pt-3"
          dir="rtl"
        >
          <div
            className={cn(
              "mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-amber-500/25",
              "bg-slate-950/90 px-4 py-2 shadow-lg backdrop-blur-xl",
            )}
          >
            <span className="text-xs font-medium text-amber-200/95">
              المرحلة {phase} / 3
            </span>
            <div className="flex gap-1">
              {[1, 2, 3].map((p) => (
                <span
                  key={p}
                  className={cn(
                    "h-1.5 w-8 rounded-full transition-all",
                    p <= phase ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]" : "bg-white/15",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {flow === "welcome" && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          role="dialog"
          aria-modal
          dir="rtl"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            aria-label="خلفية"
            onClick={skipAll}
          />
          <div
            className={cn(
              "relative z-10 w-full max-w-md animate-in zoom-in-95 duration-300 rounded-2xl border border-white/10 p-6 shadow-2xl",
              "bg-gray-900/85 backdrop-blur-xl",
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <Sparkles className="h-6 w-6 text-amber-400" />
              <span className="text-[10px] text-slate-500">1 / 3</span>
            </div>
            <h2 className="mb-2 text-2xl font-bold text-white">مرحباً بك في EDUVERSE 👋</h2>
            <p className="text-sm leading-relaxed text-slate-200/95">
              دعنا نريك كيف تستخدم المنصة خلال دقيقة واحدة
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="text-slate-300" onClick={skipAll}>
                تخطي
              </Button>
              <Button
                type="button"
                onClick={startTour}
                className={cn(
                  "rounded-xl font-semibold text-slate-950",
                  "bg-gradient-to-l from-amber-400 to-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.4)]",
                )}
              >
                ابدأ الجولة
              </Button>
            </div>
          </div>
        </div>
      )}

      {flow === "tour" && isMd && (
        <div className="pointer-events-auto fixed inset-0 z-[150]" dir="rtl">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" />
          {rect && (
            <div
              className="pointer-events-none fixed z-[152] rounded-xl ring-2 ring-amber-400/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.65)]"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                transition: "top 0.2s, left 0.2s, width 0.2s, height 0.2s",
              }}
            />
          )}
          <div
            className="fixed start-1/2 z-[153] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-amber-500/20 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl"
            style={{
              top: (() => {
                if (typeof window === "undefined") return 120;
                const pad = 12;
                const cardH = 200;
                if (rect) {
                  const below = rect.top + rect.height + pad;
                  if (below + cardH < window.innerHeight - 16) return below;
                  return Math.max(80, rect.top - cardH - pad);
                }
                return 120;
              })(),
            }}
          >
            <p className="mb-1 text-xs text-amber-200/80">
              {tourStep + 1} / {TOUR_STEPS.length}
            </p>
            <h3 className="text-lg font-bold text-white">{TOUR_STEPS[tourStep].title}</h3>
            <p className="mt-2 text-sm text-slate-200/90">{TOUR_STEPS[tourStep].body}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={skipAll} className="text-slate-400">
                تخطي الكل
              </Button>
              <div className="flex gap-2">
                {tourStep > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={tourPrev}>
                    <ArrowLeft className="h-4 w-4" />
                    السابق
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="bg-amber-500/90 text-slate-950 hover:bg-amber-400"
                  onClick={tourNext}
                >
                  {tourStep < TOUR_STEPS.length - 1 ? "التالي" : "متابعة"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {flow === "tour" && !isMd && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center p-4 sm:items-center" dir="rtl">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={skipAll} aria-hidden />
          <div
            className={cn(
              "relative z-10 w-full max-w-md animate-in slide-in-from-bottom-4 rounded-2xl border border-amber-500/20 p-5",
              "bg-slate-950/95 shadow-2xl backdrop-blur-xl",
            )}
          >
            <h3 className="text-lg font-bold text-white">{TOUR_STEPS[tourStep].title}</h3>
            <p className="mt-2 text-sm text-slate-200/90">{TOUR_STEPS[tourStep].body}</p>
            <div className="mt-4 flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={skipAll}>
                تخطي
              </Button>
              <div className="flex gap-2">
                {tourStep > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={tourPrev}>
                    السابق
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="bg-amber-500/90"
                  onClick={tourNext}
                >
                  {tourStep < TOUR_STEPS.length - 1 ? "التالي" : "متابعة"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {flow === "demo" && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={skipAll} />
          <div
            className={cn(
              "relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-amber-500/20 shadow-2xl",
              "bg-slate-950/90 p-5 backdrop-blur-xl animate-in zoom-in-95",
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-amber-100">جرب تقييم سريع</h3>
              <span className="text-xs text-amber-200/60">2 / 3</span>
            </div>
            <p className="mb-2 text-xs text-slate-400">نص تجريبي — لا يُرسل لخادم الدرجات</p>
            <div className="mb-4 min-h-[7rem] rounded-xl border border-white/10 bg-slate-900/50 p-3 text-sm text-slate-200">
              {DEMO_SAMPLE_AR}
            </div>
            {!demoDone ? (
              <Button
                type="button"
                className="w-full bg-gradient-to-l from-amber-400 to-amber-500 font-semibold text-slate-950"
                onClick={runDemo}
                disabled={demoLoading}
              >
                {demoLoading ? (
                  <>
                    <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                    جاري المحاكاة…
                  </>
                ) : (
                  "تشغيل التقييم"
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-300">ناجح (Pass)</p>
                  <p className="mt-1 text-sm text-slate-300">مثال: تحقق أساسي في المعيار</p>
                </div>
                <Button type="button" className="w-full" onClick={afterDemoContinue}>
                  متابعة — فهم الدرجات
                </Button>
              </div>
            )}
            <p className="mt-3 text-center text-xs text-slate-500">هذا عرض فقط لمساعدتك على فهم المسار</p>
          </div>
        </div>
      )}

      {flow === "explain" && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <div
            className={cn(
              "relative z-10 w-full max-w-md rounded-2xl border border-amber-500/25 p-5 shadow-2xl",
              "bg-slate-950/92 backdrop-blur-xl animate-in fade-in",
            )}
          >
            <div className="mb-1 flex items-center justify-between text-xs text-amber-200/70">
              <span>3 / 3</span>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-500 hover:text-white"
                onClick={skipAll}
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-amber-100">
              <Lightbulb className="h-5 w-5 text-amber-400" />
              ماذا تفهم من النتيجة؟
            </h3>
            <ul className="space-y-3 text-sm leading-relaxed text-slate-200/95">
              <li>
                <strong className="text-amber-200">P / M / D</strong> — نجاح، جيد بامتياز، متميّز: كلٌّ يعكس عمق
                الاستجابة للمعيار.
              </li>
              <li>التقييم يرتبط بمعايير المهمة والأدلة — ليس «رأيًا عامًا».</li>
              <li>إذا بدا الاقتباس أو الدليل ضعيفًا، قد يبقى التقدير عادلًا لكن الاقتراحات توضح أين تُعزَز جودة الإثبات.</li>
            </ul>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                asChild
                className="w-full border border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                variant="outline"
              >
                <Link href="/faq">الأسئلة الشائعة</Link>
              </Button>
              <Button
                type="button"
                onClick={finishExplain}
                className="w-full bg-gradient-to-l from-amber-400 to-amber-500 font-semibold text-slate-950"
              >
                ابدأ استخدام المنصة
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function requestOnboardingRestart() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(RESTART_EVENT));
}
