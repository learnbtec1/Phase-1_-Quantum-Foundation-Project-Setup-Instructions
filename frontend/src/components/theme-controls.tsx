"use client";

import { Moon, Sun, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

type Props = { className?: string; compact?: boolean };

export function ThemeControls({ className, compact }: Props) {
  const { language, theme, toggleTheme, toggleLanguage } = useAppTheme();

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
        title={theme === "dark" ? "Light mode" : "Dark mode"}
        aria-label="Toggle color theme"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
