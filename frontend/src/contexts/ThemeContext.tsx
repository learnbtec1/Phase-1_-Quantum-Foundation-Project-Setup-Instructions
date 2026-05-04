"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type AppLanguage = "en" | "ar";
export type AppTheme = "light" | "dark";

interface ThemeContextType {
  language: AppLanguage;
  theme: AppTheme;
  setLanguage: (lang: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  toggleLanguage: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [theme, setThemeState] = useState<AppTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedLang = localStorage.getItem("language");
    if (storedLang === "en" || storedLang === "ar") {
      setLanguageState(storedLang);
    }
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeState(storedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setThemeState("dark");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem("language", language);
  }, [language, hydrated]);

  const setLanguage = (lang: AppLanguage) => {
    setLanguageState(lang);
  };

  const setTheme = (newTheme: AppTheme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const toggleLanguage = () => {
    setLanguageState((prev) => (prev === "en" ? "ar" : "en"));
  };

  return (
    <ThemeContext.Provider
      value={{
        language,
        theme,
        setLanguage,
        setTheme,
        toggleTheme,
        toggleLanguage,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useAppTheme must be used within a ThemeProvider");
  }
  return context;
};
