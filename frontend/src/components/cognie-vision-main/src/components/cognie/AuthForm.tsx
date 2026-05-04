import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  type = "text",
  placeholder,
}: {
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-wider uppercase text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        dir="auto"
        className="w-full rounded-lg border bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-[color:var(--neon-cyan)] focus:shadow-[0_0_18px_-4px_var(--neon-cyan)]"
        style={{ borderColor: "var(--glass-border)" }}
      />
    </label>
  );
}

type Glow = "cyan" | "emerald" | "amber";
type Variant = "solid" | "outline" | "ghost";

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  glow?: Glow;
  variant?: Variant;
  fullWidth?: boolean;
}

const glowMap: Record<Glow, string> = {
  cyan: "var(--neon-cyan)",
  emerald: "var(--neon-emerald)",
  amber: "var(--neon-amber)",
};

export function NeonButton({
  children,
  glow = "cyan",
  variant = "solid",
  fullWidth = true,
  className,
  ...rest
}: NeonButtonProps) {
  const c = glowMap[glow];
  const second =
    glow === "cyan" ? "var(--neon-emerald)" : glow === "emerald" ? "var(--neon-amber)" : "var(--neon-cyan)";

  const base =
    "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-lg px-5 py-2.5 text-sm font-semibold tracking-wide transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]";

  const styleSolid = {
    background: `linear-gradient(135deg, ${c}, ${second})`,
    color: "oklch(0.14 0.03 250)",
    boxShadow: `0 0 24px -6px ${c}, inset 0 0 12px color-mix(in oklab, white 20%, transparent)`,
  };
  const styleOutline = {
    background: `color-mix(in oklab, ${c} 8%, transparent)`,
    color: c,
    border: `1px solid ${c}`,
    boxShadow: `0 0 18px -6px ${c}`,
  };
  const styleGhost = { color: c };

  const style =
    variant === "solid" ? styleSolid : variant === "outline" ? styleOutline : styleGhost;

  return (
    <button
      {...rest}
      className={cn(base, fullWidth && "w-full", className)}
      style={style}
    >
      {/* shimmer */}
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full opacity-0 transition group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, white 35%, transparent), transparent)",
          animation: "shimmer 1.4s ease-in-out infinite",
        }}
      />
      <span className="relative z-10">{children}</span>
    </button>
  );
}
