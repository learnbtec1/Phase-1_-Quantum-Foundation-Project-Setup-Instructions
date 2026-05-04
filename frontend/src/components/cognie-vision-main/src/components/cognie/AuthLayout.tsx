import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { GlassPanel } from "./GlassPanel";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="cognie relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: "var(--gradient-aurora)" }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "color-mix(in oklab, var(--neon-cyan) 25%, transparent)" }}
      />

      <div className="relative z-10 w-full max-w-md">
        <Link to="/" className="mb-8 block text-center">
          <span
            className="text-3xl font-bold tracking-tight"
            style={{
              background:
                "linear-gradient(135deg, var(--neon-cyan), var(--neon-emerald), var(--neon-amber))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Cognie
          </span>
        </Link>

        <GlassPanel variant="neon" glowColor="cyan" className="p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </GlassPanel>

        {footer && <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}
