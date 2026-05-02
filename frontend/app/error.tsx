"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Global error boundary:", error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4 sm:p-6"
      dir="rtl"
    >
      <div className="glass-card max-w-md space-y-6 p-6 text-center sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-foreground sm:text-xl">حدث خطأ في التطبيق</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            تعذّر عرض هذه الصفحة. جرّب مرة أخرى؛ إن استمر العطل، أعد تحميل الموقع أو راجع الاتصال.
          </p>
          {error?.digest ? (
            <p className="text-xs text-muted-foreground/80" suppressHydrationWarning>
              <span className="font-mono">ref: {error.digest}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            type="button"
            className="gap-2"
            onClick={() => {
              reset();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            أعد المحاولة
          </Button>
        </div>
      </div>
    </div>
  );
}
