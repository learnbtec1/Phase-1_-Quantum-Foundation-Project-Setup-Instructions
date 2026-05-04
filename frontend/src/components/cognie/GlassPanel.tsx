import { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "neon" | "dark";
type GlowColor = "cyan" | "emerald" | "amber";

interface GlassPanelProps {
  children: ReactNode;
  variant?: Variant;
  glowColor?: GlowColor;
  className?: string;
}

// ⚠ Performance: backdrop-filter is GPU-heavy. Avoid stacking >2 layers
// on low-end devices. Reduce blur from md→sm if you see jank.
const glowMap: Record<GlowColor, string> = {
  cyan: "var(--neon-cyan)",
  emerald: "var(--neon-emerald)",
  amber: "var(--neon-amber)",
};

export function GlassPanel({
  children,
  variant = "default",
  glowColor = "cyan",
  className,
}: GlassPanelProps) {
  const glow = glowMap[glowColor];
  const style: CSSProperties = {
    background: variant === "dark" ? "oklch(0.18 0.03 250 / 0.6)" : "var(--glass-bg)",
    borderColor: variant === "neon" ? glow : "var(--glass-border)",
    boxShadow:
      variant === "neon"
        ? `0 0 24px -4px color-mix(in oklab, ${glow} 60%, transparent), inset 0 0 24px -8px color-mix(in oklab, ${glow} 35%, transparent)`
        : `0 8px 32px -8px oklch(0 0 0 / 0.6)`,
    willChange: "backdrop-filter",
  };
  return (
    <div
      style={style}
      className={cn(
        "rounded-2xl border backdrop-blur-md text-foreground pointer-events-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
