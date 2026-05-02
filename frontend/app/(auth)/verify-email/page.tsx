"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { Input } from "@/components/lovable-ui/ui/input";
import { Label } from "@/components/lovable-ui/ui/label";
import { authHeaders, getApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "loading" | "success" | "error" | "missing";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const verifiedQ = searchParams.get("verified");
  const errorQ = searchParams.get("error");
  const [status, setStatus] = useState<Status>("loading");
  const [errorKind, setErrorKind] = useState<"invalid" | "missing" | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);

  const runVerify = useCallback(async (t: string) => {
    if (!t) {
      setErrorKind("missing");
      setStatus("missing");
      return;
    }
    setStatus("loading");
    try {
      const r = await fetch(
        `${getApiBase()}/api/v1/auth/verify-email?token=${encodeURIComponent(t)}&return_json=true`,
        { method: "GET", headers: authHeaders(null) as Record<string, string> },
      );
      if (r.ok) {
        setStatus("success");
        toast.success("تم تفعيل البريد بنجاح");
        return;
      }
      setErrorKind("invalid");
      setStatus("error");
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      toast.error(j.detail || "فشل التحقق");
    } catch {
      setErrorKind("invalid");
      setStatus("error");
      toast.error("تعذّر الاتصال بالخادم");
    }
  }, []);

  useEffect(() => {
    if (verifiedQ === "1") {
      setStatus("success");
      toast.success("تم تفعيل البريد بنجاح");
      return;
    }
    if (errorQ === "invalid") {
      setErrorKind("invalid");
      setStatus("error");
      return;
    }
    if (errorQ === "missing") {
      setErrorKind("missing");
      setStatus("error");
      return;
    }
    if (token) {
      void runVerify(token);
      return;
    }
    setErrorKind("missing");
    setStatus("missing");
  }, [verifiedQ, errorQ, token, runVerify]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    const em = resendEmail.trim();
    if (!em) {
      toast.error("أدخل بريدك الإلكتروني");
      return;
    }
    setResendLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/api/v1/auth/resend-verification`, {
        method: "POST",
        headers: authHeaders(null) as Record<string, string>,
        body: JSON.stringify({ email: em }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      if (!r.ok) {
        throw new Error(j.detail || "Request failed");
      }
      toast.success(j.detail || "تم إرسال الرابط إن وُجد الحساب");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطأ");
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-amber-400" aria-hidden />
          <h1 className="bg-gradient-to-l from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-2xl font-bold text-transparent">
            تفعيل البريد
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">EduVerse — أكمل التحقق للوصول إلى لوحة التحكم</p>
      </div>

      {status === "loading" && (
        <div
          className={cn(
            "flex flex-col items-center gap-4 rounded-2xl border border-amber-500/20 p-10",
            "bg-slate-950/60 shadow-[0_0_40px_rgba(251,191,36,0.12)] backdrop-blur-xl",
          )}
        >
          <Loader2 className="h-10 w-10 animate-spin text-amber-400" aria-hidden />
          <p className="text-sm text-slate-300">جاري التحقق من الرابط…</p>
        </div>
      )}

      {status === "success" && (
        <div
          className={cn(
            "flex flex-col items-center gap-5 rounded-2xl border border-amber-500/25 p-10 text-center",
            "bg-slate-950/70 shadow-[0_0_48px_rgba(251,191,36,0.2)] backdrop-blur-xl",
          )}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold text-amber-100">تم التحقق بنجاح</p>
            <p className="mt-2 text-sm text-slate-400">يمكنك الآن تسجيل الدخول والوصول إلى حسابك.</p>
          </div>
          <Button
            asChild
            className={cn(
              "w-full rounded-xl border-2 border-amber-500/50 py-6 text-base font-bold text-amber-950",
              "bg-gradient-to-l from-amber-200 via-amber-400 to-amber-500",
              "shadow-[0_0_36px_rgba(251,191,36,0.45)] transition hover:scale-[1.02] hover:shadow-[0_0_48px_rgba(245,158,11,0.5)]",
            )}
          >
            <Link href="/login">الانتقال لتسجيل الدخول</Link>
          </Button>
        </div>
      )}

      {(status === "error" || status === "missing") && (
        <div className="space-y-5">
          <div
            className={cn(
              "flex flex-col items-center gap-4 rounded-2xl border border-rose-500/25 p-8 text-center",
              "bg-slate-950/70 shadow-[0_0_32px_rgba(244,63,94,0.12)] backdrop-blur-xl",
            )}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <AlertCircle className="h-8 w-8 text-rose-400" aria-hidden />
            </span>
            <p className="text-sm text-slate-300">
              {errorKind === "missing" || status === "missing"
                ? "لا يوجد رمز في الرابط. افتح الرابط من البريد الإلكتروني، أو اطلب رابطاً جديداً."
                : "الرابط غير صالح أو انتهت صلاحيته. اطلب بريداً جديداً أدناه."}
            </p>
          </div>

          <form
            onSubmit={resend}
            className={cn(
              "space-y-4 rounded-2xl border border-amber-500/20 p-6",
              "bg-slate-950/50 backdrop-blur-xl",
            )}
          >
            <p className="text-sm font-medium text-amber-100/90">إعادة إرسال رابط التحقق</p>
            <div className="space-y-2 text-start" dir="ltr">
              <Label htmlFor="re-email">Email</Label>
              <Input
                id="re-email"
                type="email"
                autoComplete="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="you@school.edu"
                className="border-white/10 bg-slate-900/50"
              />
            </div>
            <Button
              type="submit"
              disabled={resendLoading}
              variant="outline"
              className="w-full rounded-xl border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
            >
              {resendLoading ? "جارٍ الإرسال…" : "إعادة إرسال الرابط"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-amber-500 underline-offset-4 hover:underline">
              رجوع لتسجيل الدخول
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-amber-500/20 p-10">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400" />
          <p className="text-sm text-slate-400">جاري التحميل…</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
