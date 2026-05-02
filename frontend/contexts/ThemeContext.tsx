"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useTheme as useNextTheme } from "next-themes";

export type AppLanguage = "en" | "ar";

interface ThemeContextType {
  language: AppLanguage;
  theme: string | undefined;
  setLanguage: (lang: AppLanguage) => void;
  setTheme: (theme: string) => void;
  toggleTheme: () => void;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<ThemeContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>("ar");
  const { theme, setTheme, systemTheme } = useNextTheme();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedLang = localStorage.getItem("language");
    if (storedLang === "en" || storedLang === "ar") {
      setLanguageState(storedLang);
    }
    setHydrated(true);
  },[]);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem("language", language);
  }, [language, hydrated]);

  const setLanguage = (lang: AppLanguage) => setLanguageState(lang);

  const toggleTheme = () => {
    const currentTheme = theme === "system" ? systemTheme : theme;
    setTheme(currentTheme === "dark" ? "light" : "dark");
  };

  const toggleLanguage = () => {
    setLanguageState((prev) => (prev === "en" ? "ar" : "en"));
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        theme,
        setLanguage,
        setTheme,
        toggleTheme,
        toggleLanguage,
      }}
    >
      <div
        suppressHydrationWarning
        className="min-h-0"
        style={{ visibility: hydrated ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </LanguageContext.Provider>
  );
};

export const useAppTheme = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useAppTheme must be used within a LanguageProvider");
  }
  return context;
};