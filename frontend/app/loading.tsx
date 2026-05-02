import { Loader2 } from "lucide-react";

/**
 * Global route loading UI (App Router). Shown while server segments prepare.
 * Keeps 8px rhythm and glassmorphism.
 */
export default function RootLoading() {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-4"
      role="status"
      aria-label="جاري التحميل"
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-primary/20 blur-xl motion-safe:animate-pulse"
          aria-hidden
        />
        <div className="glass-card flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-card/50 shadow-[0_0_32px_hsl(var(--primary)/0.25)]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
      <p className="mt-6 text-sm font-medium text-muted-foreground">جاري تحميل EDUVERSE…</p>
    </div>
  );
}
