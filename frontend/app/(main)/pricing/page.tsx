"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { useAppTheme } from "@/contexts/ThemeContext";
import { fetchWithSession, getApiBase } from "@/lib/api";

type PlanRow = {
  key: string;
  name: string;
  price_label: string;
  features: string[];
};

const PAID_PLANS = new Set(["pro", "unlimited"]);

function planTitle(p: PlanRow, ar: boolean): string {
  if (!ar) return p.name;
  const m: Record<string, string> = {
    pro: "برو (Pro)",
    unlimited: "غير محدود (Unlimited)",
    free: "مجاني (Free)",
  };
  return m[p.key] ?? p.name;
}

export default function PricingPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [stripeOk, setStripeOk] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${getApiBase()}/api/v1/billing/plans`);
        if (r.ok) {
          const d = (await r.json()) as { plans?: PlanRow[] };
          setPlans(d.plans ?? []);
        }
      } catch {
        setPlans([]);
      }
      try {
        const c = await fetch(`${getApiBase()}/api/v1/billing/config`);
        if (c.ok) {
          const j = (await c.json()) as { stripe_configured?: boolean };
          setStripeOk(!!j.stripe_configured);
        }
      } catch {
        setStripeOk(false);
      }
    })();
  }, []);

  async function upgrade(plan: "pro" | "unlimited") {
    if (!stripeOk) {
      toast.error(ar ? "الدفع غير مُعدّ" : "Billing is not configured");
      return;
    }
    setLoadingPlan(plan);
    try {
      const res = await fetchWithSession("/api/v1/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_type: plan,
          success_path: "/success",
          cancel_path: "/cancel",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(typeof j.detail === "string" ? j.detail : "Checkout failed");
      }
      const data = (await res.json()) as { url?: string; checkout_url?: string };
      const target = data.url || data.checkout_url;
      if (target) {
        window.location.href = target;
        return;
      }
      throw new Error(ar ? "لا يوجد رابط دفع" : "No checkout URL");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? "خطأ" : "Error");
    } finally {
      setLoadingPlan(null);
    }
  }

  const paid = plans.filter((p) => PAID_PLANS.has(p.key));

  return (
    <div className="space-y-8" dir={ar ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {ar ? "الخطط والأسعار" : "Plans & pricing"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "الترقية عبر Stripe: بعد الدفع تُرفع حدود الاستخدام تلقائياً (عبر الـ webhook)."
            : "Upgrade via Stripe — usage limits update automatically from secure webhooks."}
        </p>
      </div>

      {!stripeOk && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          {ar
            ? "عرّف STRIPE_SECRET_KEY و STRIPE_WEBHOOK_SECRET و STRIPE_PRICE_PRO و STRIPE_PRICE_ID_UNLIMITED"
            : "Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO (or STRIPE_PRICE_ID_PRO), and STRIPE_PRICE_ID_UNLIMITED on the backend."}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {paid.map((p) => (
          <Card key={p.key} className="flex flex-col border-white/10 shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary">
                <CreditCard className="h-5 w-5" />
                <CardTitle>{planTitle(p, ar)}</CardTitle>
              </div>
              <CardDescription>{p.price_label}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-2">
              {p.features.map((f) => (
                <div key={f} className="flex gap-2 text-sm">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{f}</span>
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                disabled={!stripeOk || loadingPlan === p.key}
                onClick={() => upgrade(p.key as "pro" | "unlimited")}
              >
                {loadingPlan === p.key ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {ar ? "جاري…" : "…"}
                  </>
                ) : ar ? (
                  "ترقية"
                ) : (
                  "Upgrade"
                )}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">{ar ? "مجاني" : "Free"}</CardTitle>
          <CardDescription>
            {plans.find((x) => x.key === "free")?.features.join(" · ") ??
              (ar ? "ميزات أساسية" : "Core platform features")}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
