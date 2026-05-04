import { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Settings,
  Briefcase,
  Sparkles,
  ClipboardCheck,
  ShieldAlert,
  PenLine,
  KeySquare,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HoloAvatar } from "./HoloAvatar";

const nav = [
  { to: "/dashboard", label: "اللوحة الرئيسية", icon: LayoutDashboard },
  { to: "/workspace", label: "مساحة العمل", icon: Briefcase },
  { to: "/cognie", label: "غرفة آريا", icon: Sparkles },
  { to: "/assessment", label: "التقييم التكيّفي", icon: ClipboardCheck },
  { to: "/plagiarism", label: "كاشف الانتحال", icon: ShieldAlert },
  { to: "/pro-writer", label: "الكاتب المحترف", icon: PenLine },
  { to: "/decoder", label: "فاكّ الشيفرة", icon: KeySquare },
  { to: "/settings", label: "الإعدادات", icon: Settings },
  { to: "/admin/dashboard", label: "لوحة الإدارة", icon: ShieldCheck },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="cognie relative flex min-h-screen w-full bg-background text-foreground">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{ background: "var(--gradient-aurora)" }}
      />

      <aside
        className="relative z-10 flex w-64 shrink-0 flex-col border-l p-4 backdrop-blur-md"
        style={{
          borderColor: "var(--glass-border)",
          background: "oklch(0.16 0.03 250 / 0.7)",
        }}
      >
        <Link to="/" className="mb-6 flex flex-col items-center gap-3 px-2">
          <HoloAvatar size={120} caption="آريا" />
          <div className="mt-6 text-center">
            <span
              className="text-2xl font-bold tracking-tight"
              style={{
                background:
                  "linear-gradient(135deg, var(--neon-cyan), var(--neon-emerald), var(--neon-amber))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Cognie
            </span>
            <p className="mt-0.5 text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
              عمّان · 2035
            </p>
          </div>
        </Link>

        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                style={
                  active
                    ? {
                        background: "color-mix(in oklab, var(--neon-cyan) 12%, transparent)",
                        boxShadow:
                          "inset 0 0 0 1px color-mix(in oklab, var(--neon-cyan) 35%, transparent)",
                      }
                    : undefined
                }
              >
                <Icon
                  className="h-4 w-4"
                  style={active ? { color: "var(--neon-cyan)" } : undefined}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6">
          <div
            className="rounded-xl border p-3 text-xs"
            style={{ borderColor: "var(--glass-border)", background: "var(--glass-bg)" }}
          >
            <p className="flex items-center gap-2 font-medium" style={{ color: "var(--neon-emerald)" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full animate-neon-pulse" style={{ background: "var(--neon-emerald)" }} />
              آريا · متصلة
            </p>
            <p className="mt-1 text-muted-foreground">مزامنة عصبية مستقرّة · ٩٢ مللي ثانية</p>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
