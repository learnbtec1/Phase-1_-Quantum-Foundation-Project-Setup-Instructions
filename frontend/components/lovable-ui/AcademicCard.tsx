import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AcademicCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  color: "blue" | "purple" | "green" | "orange" | "pink" | "cyan";
  className?: string;
  onClick?: () => void;
}

const colorStyles = {
  blue: {
    surface: "bg-white/[0.02] backdrop-blur-xl",
    icon: "text-blue-600 dark:text-blue-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-blue-500/15 dark:ring-blue-400/20",
    accent: "bg-blue-500/10 dark:bg-blue-500/20",
  },
  purple: {
    surface: "bg-white/[0.02] backdrop-blur-xl",
    icon: "text-purple-600 dark:text-purple-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-purple-500/15 dark:ring-purple-400/20",
    accent: "bg-purple-500/10 dark:bg-purple-500/20",
  },
  green: {
    surface: "bg-card/60 dark:bg-card/50",
    icon: "text-green-600 dark:text-green-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-green-500/15 dark:ring-green-400/20",
    accent: "bg-green-500/10 dark:bg-green-500/20",
  },
  orange: {
    surface: "bg-white/[0.02] backdrop-blur-xl",
    icon: "text-orange-600 dark:text-orange-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-orange-500/15 dark:ring-orange-400/20",
    accent: "bg-orange-500/10 dark:bg-orange-500/20",
  },
  pink: {
    surface: "bg-white/[0.02] backdrop-blur-xl",
    icon: "text-pink-600 dark:text-pink-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-pink-500/15 dark:ring-pink-400/20",
    accent: "bg-pink-500/10 dark:bg-pink-500/20",
  },
  cyan: {
    surface: "bg-white/[0.02] backdrop-blur-xl",
    icon: "text-cyan-600 dark:text-cyan-400",
    border: "border-white/10 dark:border-white/10",
    ring: "ring-cyan-500/15 dark:ring-cyan-400/20",
    accent: "bg-cyan-500/10 dark:bg-cyan-500/20",
  },
};

export const AcademicCard: React.FC<AcademicCardProps> = ({
  icon: Icon,
  title,
  description,
  color,
  className = "",
  onClick,
}) => {
  const styles = colorStyles[color];

  return (
    <div
      onClick={onClick}
      className={cn(
        "group p-6 rounded-xl border shadow-lg transition-all duration-200 cursor-pointer backdrop-glass",
        "backdrop-blur-md hover:-translate-y-1 hover:scale-[1.01] hover:shadow-xl hover:shadow-[0_0_30px_rgba(99,102,241,0.15)] active:scale-[0.99]",
        styles.surface,
        styles.border,
        styles.ring,
        "ring-1",
        className,
      )}
    >
      {/* Icon Container */}
      <div
        className={cn(
          "w-14 h-14 rounded-lg flex items-center justify-center mb-4 transition-all duration-300",
          "group-hover:scale-110",
          styles.accent,
        )}
      >
        <Icon className={cn("w-7 h-7", styles.icon)} />
      </div>

      {/* Title */}
      <h3 className="font-bold text-lg mb-2 text-foreground">{title}</h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>

      {/* Hover indicator */}
      <div className="mt-4 h-1 bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-all duration-300 rounded-full"
        style={{
          backgroundImage: `linear-gradient(to right, var(--color-start), var(--color-end))`,
          "--color-start": color === "blue" ? "#3b82f6" : 
                           color === "purple" ? "#a855f7" : 
                           color === "green" ? "#10b981" : 
                           color === "orange" ? "#f97316" : 
                           color === "pink" ? "#ec4899" : 
                           "#06b6d4",
          "--color-end": color === "blue" ? "#1e40af" : 
                         color === "purple" ? "#7c3aed" : 
                         color === "green" ? "#059669" : 
                         color === "orange" ? "#ea580c" : 
                         color === "pink" ? "#be185d" : 
                         "#0891b2",
        } as React.CSSProperties}
      />
    </div>
  );
};

export default AcademicCard;
