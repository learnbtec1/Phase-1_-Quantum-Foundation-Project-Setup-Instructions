"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/lovable-ui/ui/button";
import { fetchWithSession } from "@/lib/api";

function SuccessInner() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [verifyState, setVerifyState] = useState<"idle" | "loading" | "done" | "error">("idle");

  useEffect(() => {
    if (!sessionId) {
      setVerifyState("done");
      return;
    }
    setVerifyState("loading");
    (async () => {
      try {
        const r = await fetchWithSession(
          `/api/v1/billing/verify-session?session_id=${encodeURIComponent(sessionId)}`,
          { method: "GET" },
        );
        if (r.ok) {
          const j = (await r.json()) as { verified?: boolean; plan?: string };
          if (j.verified) {
            toast.success(ar ? "تم تفعيل خطتك فوراً" : "Your plan is active now");
          }
        }
      } catch {
        /* webhook may still apply; non-fatal */
      } finally {
        setVerifyState("done");
      }
    })();
  }, [sessionId, ar]);

  return (
    <div className="mx-auto max-w-lg space-y-6 text-center" dir={ar ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
        {ar ? "تم الاشتراك بنجاح" : "Subscription successful"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ar
          ? "تم تفعيل خطتك. إن تأخّر التحديث، نُكمل المزامنة من السيرفر تلقائياً."
          : "Your plan is active. If anything lags, we sync with Stripe automatically."}
      </p>
      {sessionId && verifyState === "loading" && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {ar ? "جاري التحقق من الدفع…" : "Confirming payment…"}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">{ar ? "لوحة التحكم" : "Dashboard"}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/settings">{ar ? "الاشتراك في الإعدادات" : "Subscription in settings"}</Link>
        </Button>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}
