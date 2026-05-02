"use client";

/**
 * `AppProviders` = Tooltip (Radix) + `next-themes` + i18n (`LanguageProvider`).
 * Prefer this name in `app/layout` to avoid confusion with `next-themes` alone.
 * `ThemeProvider` remains an alias for legacy imports.
 */
export { AppProviders, AppProviders as ThemeProvider } from "@/app/providers";
