"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CreditCard, Loader2, Palette, Languages, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { Button } from "@/components/lovable-ui/ui/button";
import { Input } from "@/components/lovable-ui/ui/input";
import { Label } from "@/components/lovable-ui/ui/label";
import { ThemeControls } from "@/components/theme-controls";
import { useAppTheme } from "@/contexts/ThemeContext";
import { fetchWithSession } from "@/lib/api";
import { requestOnboardingRestart } from "@/components/lovable-ui/OnboardingSystem";

export default function SettingsPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [totpOn, setTotpOn] = useState(false);
  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [disPwd, setDisPwd] = useState("");
  const [disTotp, setDisTotp] = useState("");

  const [billing, setBilling] = useState<{
    plan: string;
    subscription_status: string;
    renewal_date: string | null;
    cancel_at_period_end: boolean;
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);

  const load2fa = useCallback(async () => {
    try {
      const r = await fetchWithSession("/api/v1/auth/2fa/status", { method: "GET" });
      if (r.ok) {
        const j = (await r.json()) as { enabled?: boolean };
        setTotpOn(!!j.enabled);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    try {
      const r = await fetchWithSession("/api/v1/billing/me", { method: "GET" });
      if (r.ok) {
        const j = (await r.json()) as {
          plan?: string;
          subscription_status?: string;
          renewal_date?: string | null;
          cancel_at_period_end?: boolean;
        };
        setBilling({
          plan: (j.plan || "free").toLowerCase(),
          subscription_status: (j.subscription_status || "none").toLowerCase(),
          renewal_date: j.renewal_date ?? null,
          cancel_at_period_end: !!j.cancel_at_period_end,
        });
      } else {
        setBilling(null);
      }
    } catch {
      setBilling(null);
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    void load2fa();
  }, [load2fa]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  async function startSetup() {
    try {
      const r = await fetchWithSession("/api/v1/auth/2fa/setup", { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || "Failed");
      }
      const d = (await r.json()) as { provisioning_uri?: string; secret?: string };
      setSetupUri(d.provisioning_uri || null);
      setSetupSecret(d.secret || null);
      toast.success(ar ? "أضف المفتاح في التطبيق" : "Add the key in your authenticator app");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  async function enable2fa() {
    try {
      const r = await fetchWithSession("/api/v1/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: enableCode.replace(/\s/g, "") }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || "Invalid code");
      }
      setTotpOn(true);
      setSetupUri(null);
      setSetupSecret(null);
      setEnableCode("");
      toast.success(ar ? "تم تفعيل التحقق الثنائي" : "Two-factor enabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  async function cancelSubscription(atPeriodEnd: boolean) {
    const ok = window.confirm(
      atPeriodEnd
        ? ar
          ? "إلغاء الاشتراك في نهاية الفترة الحالية؟"
          : "Cancel subscription at the end of the current period?"
        : ar
          ? "إلغاء الاشتراك فوراً؟ قد تفقد الوصول للمزايا المدفوعة مباشرة."
          : "Cancel immediately? You may lose paid access right away."
    );
    if (!ok) return;
    setCanceling(true);
    try {
      const r = await fetchWithSession("/api/v1/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at_period_end: atPeriodEnd }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || "Failed");
      }
      toast.success(
        atPeriodEnd
          ? ar
            ? "سيتم إنهاء الاشتراك في نهاية الفترة"
            : "Subscription will end after this period"
          : ar
            ? "تم إلغاء الاشتراك"
            : "Subscription cancelled"
      );
      await loadBilling();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setCanceling(false);
    }
  }

  async function disable2fa() {
    try {
      const r = await fetchWithSession("/api/v1/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: disPwd,
          totp_code: disTotp.replace(/\s/g, ""),
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail || "Failed");
      }
      setTotpOn(false);
      setDisPwd("");
      setDisTotp("");
      toast.success(ar ? "تم إيقاف التحقق الثنائي" : "Two-factor disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500" dir={ar ? "rtl" : "ltr"}>
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {ar ? "الإعدادات" : "Settings"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "المظهر واللغة. الإشعارات تظهر تلقائياً عبر شريط التنبيهات (Sonner) عند التقييم أو الانتحال."
            : "Theme and language. Toasts (Sonner) show assessment and plagiarism notifications."}
        </p>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Palette className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "المظهر واللغة" : "Appearance & language"}</CardTitle>
            </div>
            <CardDescription>
              {ar ? "نمط واجهة فاتح/داكن، واتجاه عربي/إنجليزي" : "Dark / light and Arabic / English"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeControls />
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Languages className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "اتجاه الواجهة" : "Interface direction"}</CardTitle>
            </div>
            <CardDescription>
              {ar ? "مفعّل من السياق — استخدم تبديل اللغة بجانب السمة" : "RTL follows Arabic selection"}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="glass-card md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "جولة التعريف" : "Product tour"}</CardTitle>
            </div>
            <CardDescription>
              {ar
                ? "أعد عرض شرح سريع للمنصة (دقيقة واحدة) في أي وقت."
                : "Replay the short guided tour of the main areas any time."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="secondary"
              className="border border-amber-500/30 bg-amber-500/5 text-amber-100 hover:bg-amber-500/15"
              onClick={() => {
                requestOnboardingRestart();
                toast.success(ar ? "ستظهر الجولة بعد لحظات" : "The tour will open shortly");
              }}
            >
              {ar ? "إعادة شرح المنصة" : "Replay platform tour"}
            </Button>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Shield className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "الأمان" : "Security"}</CardTitle>
            </div>
            <CardDescription>
              {ar
                ? "التحقق الثنائي (TOTP) عبر تطبيق مثل Google Authenticator."
                : "Time-based one-time passwords (TOTP) with an authenticator app."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {totpOn
                ? ar
                  ? "التحقق الثنائي مفعّل."
                  : "Two-factor authentication is on."
                : ar
                  ? "يُنصح بتفعيل 2FA لحسابات المعلمين."
                  : "2FA is recommended, especially for teacher accounts."}
            </p>
            {!totpOn && !setupUri && (
              <Button type="button" variant="secondary" onClick={() => void startSetup()}>
                {ar ? "إعداد 2FA" : "Set up 2FA"}
              </Button>
            )}
            {!totpOn && setupUri && (
              <div className="space-y-3">
                {setupSecret && (
                  <div className="space-y-1">
                    <Label>{ar ? "مفتاح سري" : "Secret"}</Label>
                    <p className="font-mono text-xs break-all rounded border p-2">{setupSecret}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>{ar ? "رابط الربط" : "Setup link (mobile)"}</Label>
                  <a href={setupUri} className="text-sm text-primary underline break-all">
                    {setupUri}
                  </a>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="e2fa">{ar ? "أول رمز" : "First code from app"}</Label>
                  <Input
                    id="e2fa"
                    inputMode="numeric"
                    value={enableCode}
                    onChange={(e) => setEnableCode(e.target.value)}
                    placeholder="123456"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void enable2fa()}>
                    {ar ? "تفعيل" : "Enable"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setSetupUri(null); setSetupSecret(null); }}>
                    {ar ? "إلغاء" : "Cancel"}
                  </Button>
                </div>
              </div>
            )}
            {totpOn && (
              <div className="space-y-3 max-w-sm">
                <div className="space-y-2">
                  <Label htmlFor="dpwd">{ar ? "كلمة المرور" : "Password"}</Label>
                  <Input
                    id="dpwd"
                    type="password"
                    value={disPwd}
                    onChange={(e) => setDisPwd(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dtotp">{ar ? "رمز 2FA" : "2FA code"}</Label>
                  <Input
                    id="dtotp"
                    inputMode="numeric"
                    value={disTotp}
                    onChange={(e) => setDisTotp(e.target.value)}
                  />
                </div>
                <Button type="button" variant="destructive" onClick={() => void disable2fa()}>
                  {ar ? "تعطيل 2FA" : "Disable 2FA"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="glass-card md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <CreditCard className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "الاشتراك والفوترة" : "Subscription & billing"}</CardTitle>
            </div>
            <CardDescription>
              {ar
                ? "الحالة من Stripe — لا يمكن تغيير الخطة يدوياً من الواجهة."
                : "Status comes from Stripe; plan cannot be changed manually in the app."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {billingLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {ar ? "جاري التحميل…" : "Loading…"}
              </p>
            )}
            {!billingLoading && billing && (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">{ar ? "الخطة: " : "Plan: "}</span>
                  <span className="font-medium uppercase">{billing.plan}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">
                    {ar ? "حالة الاشتراك: " : "Subscription status: "}
                  </span>
                  <span className="font-medium">{billing.subscription_status}</span>
                </p>
                {billing.renewal_date && (
                  <p>
                    {billing.cancel_at_period_end
                      ? ar
                        ? `الوصول ينتهي بتاريخ: ${billing.renewal_date}`
                        : `Access through: ${billing.renewal_date}`
                      : ar
                        ? `اشتراكك نشط حتى تاريخ: ${billing.renewal_date}`
                        : `Renews or rolls over on: ${billing.renewal_date}`}
                  </p>
                )}
                {billing.plan !== "free" &&
                  ["active", "trialing", "past_due"].includes(billing.subscription_status) &&
                  !billing.cancel_at_period_end && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={canceling}
                        onClick={() => void cancelSubscription(true)}
                      >
                        {ar ? "إلغاء نهاية الفترة" : "Cancel at period end"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={canceling}
                        onClick={() => void cancelSubscription(false)}
                      >
                        {ar ? "إلغاء فوري" : "Cancel now"}
                      </Button>
                    </div>
                  )}
                {billing.cancel_at_period_end && (
                  <p className="text-amber-600 dark:text-amber-400">
                    {ar
                      ? "تمت جدولة إلغاء الاشتراك — يبقى الوصول حتى تاريخ انتهاء الفترة."
                      : "Cancellation is scheduled — you keep access until the end of the period."}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="glass-card md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Bell className="h-5 w-5" />
              <CardTitle className="text-lg">{ar ? "الإشعارات" : "Notifications"}</CardTitle>
            </div>
            <CardDescription>
              {ar
                ? "تنبيهات مدمجة: نجاح التقييم، تحذيرات الانتحال، وأخطاء الشبكة."
                : "Built-in: grading success, similarity warnings, and network errors."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
