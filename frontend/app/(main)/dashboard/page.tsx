"use client";

import { useEffect, useState } from "react";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import {
  fetchWithSession,
  getApiBase,
  readFastApiDetail,
  shouldSignOutOn401,
  signOutOnUnauthorized,
} from "@/lib/api";
import { fetchUsageMe, formatLimit, type UsageMe, usageProgress } from "@/lib/usage";
import { toast } from "sonner";
import { Activity, BarChart2, Server } from "lucide-react";

type Me = {
  id: number;
  email: string;
  role: string;
  subscription_plan: string;
  totp_enabled: boolean;
  is_verified: boolean;
};

export default function DashboardPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [me, setMe] = useState<Me | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<UsageMe | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithSession("/api/v1/auth/me", { method: "GET" });
        if (r.status === 401) {
          const d401 = await readFastApiDetail(r);
          if (shouldSignOutOn401(d401)) {
            toast.error(ar ? "انتهت الجلسة. سجّل الدخول مجدداً." : "Session expired. Please sign in.");
            signOutOnUnauthorized();
          } else {
            console.warn("401 without session-style detail:", d401);
            toast.error(d401 || (ar ? "غير مصرّح" : "Unauthorized"));
          }
          return;
        }
        if (r.ok) {
          setMe((await r.json()) as Me);
          const u = await fetchUsageMe();
          setUsage(u);
        }
      } catch {
        setMe(null);
        setUsage(null);
      }
    })();
  }, [ar]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${getApiBase()}/health`);
        setApiOk(r.ok);
      } catch {
        setApiOk(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      <p className="text-muted-foreground">
        {ar ? "مسجّل الدخول:" : "Signed in"}{" "}
        <span className="font-medium text-foreground">{me?.email ?? "…"}</span>
        {me && (
          <span className="ms-2 text-xs">
            {ar
              ? ` · ${me.role} · ${me.subscription_plan} خطة الاشتراك${
                  me.totp_enabled ? " · مفعّل التحقق الثنائي" : ""
                }`
              : `· ${me.role} · plan ${me.subscription_plan}${me.totp_enabled ? " · 2FA on" : ""}`}
          </span>
        )}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {usage && (
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {ar ? "📊 الاستخدام" : "📊 Usage"}
              </CardTitle>
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{ar ? "تقييمات BTEC" : "Assessments"}</span>
                  <span className="text-muted-foreground">
                    {usage.assessments_used} / {formatLimit(usage.assessments_limit)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width:
                        usage.assessments_limit >= 0
                          ? `${100 * usageProgress(usage.assessments_used, usage.assessments_limit)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{ar ? "فحص الانتحال" : "Plagiarism"}</span>
                  <span className="text-muted-foreground">
                    {usage.plagiarism_used} / {formatLimit(usage.plagiarism_limit)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width:
                        usage.plagiarism_limit >= 0
                          ? `${100 * usageProgress(usage.plagiarism_used, usage.plagiarism_limit)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
              {usage.assessments_limit >= 0 && (
                <p className="text-sm text-muted-foreground" dir={ar ? "rtl" : "ltr"}>
                  {ar ? (
                    <>
                      <span className="font-medium text-foreground">
                        {usage.remaining_assessments} تقييمات متبقية
                      </span>
                      <span> · {usage.remaining_plagiarism} فحوصات انتحال متبقية</span>
                    </>
                  ) : (
                    <>
                      {usage.remaining_assessments} assessment{usage.remaining_assessments === 1 ? "" : "s"} left this
                      month · {usage.remaining_plagiarism} plagiarism {usage.remaining_plagiarism === 1 ? "check" : "checks"}{" "}
                      left
                    </>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {ar ? "حالة الخادم" : "API status"}
            </CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {apiOk === null ? "…" : apiOk ? (ar ? "متصل" : "Online") : ar ? "غير متصل" : "Offline"}
            </p>
            <CardDescription className="mt-1" dir="ltr">
              {ar ? (
                <>
                  واجهة FastAPI: {process.env.NEXT_PUBLIC_API_URL ?? "—"} (الطلبات عبر /api/v1 ووسيط Next)
                </>
              ) : (
                <>FastAPI: {process.env.NEXT_PUBLIC_API_URL ?? "—"} (requests use /api/v1 via Next proxy)</>
              )}
            </CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {ar ? "ماذا تستخدم؟" : "Pipeline"}
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {ar ? (
                <>
                  استخدم <strong>فحص الانتحال</strong> للمقارنة مع مقاطع BTEC/المرجع في الفهرس، و{" "}
                  <strong>تقييم BTEC</strong> لخدمة RAG + التصحيح.
                </>
              ) : (
                <>
                  Use <strong>Plagiarism Check</strong> for similarity search against ingested BTEC / reference
                  chunks, and <strong>BTEC Assessment</strong> for RAG + grading.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
