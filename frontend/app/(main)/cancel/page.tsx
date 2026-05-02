"use client";

import Link from "next/link";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/lovable-ui/ui/button";

export default function CheckoutCancelPage() {
  const { language } = useAppTheme();
  const ar = language === "ar";

  return (
    <div className="mx-auto max-w-lg space-y-6 text-center" dir={ar ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold tracking-tight">
        {ar ? "تم إلغاء العملية" : "Checkout cancelled"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ar
          ? "لم يُخصم مبلغ. يمكنك العودة إلى الأسعار والمحاولة لاحقاً."
          : "No charge was made. You can return to pricing and try again anytime."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="default">
          <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">{ar ? "لوحة التحكم" : "Dashboard"}</Link>
        </Button>
      </div>
    </div>
  );
}
