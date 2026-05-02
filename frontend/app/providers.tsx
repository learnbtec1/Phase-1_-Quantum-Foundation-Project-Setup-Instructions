"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import { LanguageProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/lovable-ui/ui/tooltip";

export function AppProviders({ children }: { children: React.ReactNode }) {
  // TooltipProvider must be the outermost client wrapper so Radix Tooltip context
  // is available across next-themes / language boundaries and every route segment.
  return (
    <TooltipProvider delayDuration={200}>
      <NextThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange={false}>
        <LanguageProvider>{children}</LanguageProvider>
      </NextThemeProvider>
    </TooltipProvider>
  );
}