import ariaAvatar from "@/assets/aria-avatar.png";
import { cn } from "@/lib/utils";

interface HoloAvatarProps {
  size?: number;
  className?: string;
  showRings?: boolean;
  caption?: string;
}

/**
 * HoloAvatar — أفاتار ARIA الهولوغرافي.
 * حلقات نيون دوّارة + توهج + صورة 3D واقعية مع تأثير عوم.
 */
export function HoloAvatar({
  size = 220,
  className,
  showRings = true,
  caption,
}: HoloAvatarProps) {
  return (
    <div
      className={cn("relative flex flex-col items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {/* حلقات الطاقة */}
      {showRings && (
        <>
          <div
            className="absolute inset-0 rounded-full animate-spin-slow"
            style={{
              border: "1px dashed color-mix(in oklab, var(--neon-cyan) 60%, transparent)",
              boxShadow: "0 0 32px color-mix(in oklab, var(--neon-cyan) 35%, transparent)",
            }}
          />
          <div
            className="absolute rounded-full animate-spin-slow"
            style={{
              inset: 12,
              border: "1px solid color-mix(in oklab, var(--neon-emerald) 50%, transparent)",
              animationDirection: "reverse",
              animationDuration: "26s",
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              inset: -8,
              background: "radial-gradient(circle, color-mix(in oklab, var(--neon-cyan) 30%, transparent) 0%, transparent 70%)",
              filter: "blur(20px)",
            }}
          />
        </>
      )}

      {/* صورة الأفاتار */}
      <div
        className="relative z-10 overflow-hidden rounded-full animate-float-y"
        style={{
          width: size - 32,
          height: size - 32,
          boxShadow:
            "inset 0 0 32px color-mix(in oklab, var(--neon-cyan) 40%, transparent), 0 0 24px color-mix(in oklab, var(--neon-emerald) 30%, transparent)",
          border: "1px solid color-mix(in oklab, var(--neon-cyan) 50%, transparent)",
        }}
      >
        <img
          src={ariaAvatar}
          alt="ARIA — المعلّم الذكي ثلاثي الأبعاد"
          className="h-full w-full object-cover object-top"
          loading="lazy"
        />
        {/* مسح ضوئي */}
        <div
          className="pointer-events-none absolute inset-x-0 h-px"
          style={{
            background: "linear-gradient(90deg, transparent, var(--neon-cyan), transparent)",
            boxShadow: "0 0 12px var(--neon-cyan)",
            animation: "float-y 3s ease-in-out infinite",
            top: "30%",
          }}
        />
      </div>

      {caption && (
        <p
          className="absolute -bottom-6 text-[10px] tracking-[0.3em] uppercase"
          style={{ color: "var(--neon-cyan)" }}
        >
          {caption}
        </p>
      )}
    </div>
  );
}