"use client";

import { Moon, Sun, Languages } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/lovable-ui/ui/button";
import { useAppTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

type Props = { className?: string; compact?: boolean };

/**
 * next-themes exposes `theme`/`resolvedTheme` as undefined during SSR first paint.
 * Branching UI on theme before mount causes hydration mismatch (React #418 / #422).
 */
export function ThemeControls({ className, compact }: Props) {
  const { language, toggleTheme, toggleLanguage } = useAppTheme();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      dir="ltr"
    >
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={cn(!compact && "gap-2")}
        onClick={toggleLanguage}
        title={language === "ar" ? "Switch to English" : "التبديل إلى العربية"}
        aria-label="Toggle language"
      >
        <Languages className="h-4 w-4" />
        {!compact && (
          <span className="text-xs font-medium">
            {language === "ar" ? "عربي" : "EN"}
          </span>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={toggleTheme}
        title={isDark ? "Light mode" : "Dark mode"}
        aria-label="Toggle color theme"
      >
        {isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
