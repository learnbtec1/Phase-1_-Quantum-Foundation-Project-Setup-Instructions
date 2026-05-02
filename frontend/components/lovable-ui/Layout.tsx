"use client";

import * as React from "react";
import Link from "next/link";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/lovable-ui/ui/button";
import { Switch } from "@/components/lovable-ui/ui/switch";
import { Moon, Sun, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/lovable-ui/ui/dropdown-menu";

interface LayoutProps {
  children: React.ReactNode;
}

const LovableLayout: React.FC<LayoutProps> = ({ children }) => {
  const { language, theme, toggleTheme, toggleLanguage } = useAppTheme();

  const translations = {
    en: {
      home: "Home",
      dashboard: "Dashboard",
      courses: "Courses",
      resources: "Resources",
      about: "About",
      darkMode: "Dark Mode",
      language: "Language",
      english: "English",
      arabic: "العربية",
      lightMode: "Light Mode",
    },
    ar: {
      home: "الرئيسية",
      dashboard: "لوحة التحكم",
      courses: "الدورات",
      resources: "الموارد",
      about: "حول",
      darkMode: "الوضع الليلي",
      language: "اللغة",
      english: "English",
      arabic: "العربية",
      lightMode: "الوضع الفاتح",
    },
  };

  const t = translations[language];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header
        className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        dir={language === "ar" ? "rtl" : "ltr"}
      >
        <div className="container flex h-16 items-center justify-between px-4 md:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-xl text-primary hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
              E
            </div>
            <span className="hidden sm:inline">EduPlatform</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link href="/">
              <Button variant="ghost" className="text-sm">
                {t.home}
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost" className="text-sm">
                {t.dashboard}
              </Button>
            </Link>
            <Link href="/courses">
              <Button variant="ghost" className="text-sm">
                {t.courses}
              </Button>
            </Link>
            <Link href="/resources">
              <Button variant="ghost" className="text-sm">
                {t.resources}
              </Button>
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30">
              {theme === "light" ? (
                <Sun className="w-4 h-4 text-amber-500" />
              ) : (
                <Moon className="w-4 h-4 text-blue-400" />
              )}
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
                className="scale-75"
                aria-label={theme === "dark" ? t.lightMode : t.darkMode}
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="w-10 h-10"
                  aria-label={t.language}
                >
                  <Globe className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={language === "ar" ? "end" : "start"}
                className="w-40"
              >
                <DropdownMenuItem
                  onClick={() => {
                    if (language !== "en") toggleLanguage();
                  }}
                  className="cursor-pointer"
                >
                  <span className="text-sm">{t.english}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    if (language !== "ar") toggleLanguage();
                  }}
                  className="cursor-pointer"
                >
                  <span className="text-sm">{t.arabic}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="md:hidden">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={language === "ar" ? "end" : "start"}>
                <DropdownMenuItem asChild>
                  <Link href="/" className="cursor-pointer">
                    {t.home}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer">
                    {t.dashboard}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/courses" className="cursor-pointer">
                    {t.courses}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/resources" className="cursor-pointer">
                    {t.resources}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full" dir={language === "ar" ? "rtl" : "ltr"}>
        {children}
      </main>

      <footer
        className="border-t border-border bg-secondary/20 py-8"
        dir={language === "ar" ? "rtl" : "ltr"}
      >
        <div className="container px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-bold mb-4 text-primary">EduPlatform</h3>
              <p className="text-sm text-muted-foreground">
                {language === "en"
                  ? "Empowering education through innovative technology"
                  : "تمكين التعليم من خلال التكنولوجيا المبتكرة"}
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.courses}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Web Development" : "تطوير الويب"}
                  </span>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Data Science" : "علم البيانات"}
                  </span>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Mobile Apps" : "تطبيقات الجوال"}
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.resources}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Documentation" : "التوثيق"}
                  </span>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Tutorials" : "الدروس"}
                  </span>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Community" : "المجتمع"}
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.about}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/" className="hover:text-primary transition-colors">
                    {language === "en" ? "About Us" : "من نحن"}
                  </Link>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Contact" : "تواصل"}
                  </span>
                </li>
                <li>
                  <span className="hover:text-primary transition-colors">
                    {language === "en" ? "Privacy" : "الخصوصية"}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {language === "en"
                ? "© 2024 EduPlatform. All rights reserved."
                : "© 2024 EduPlatform. جميع الحقوق محفوظة."}
            </p>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span className="text-muted-foreground">
                {language === "en" ? "Privacy Policy" : "سياسة الخصوصية"}
              </span>
              <span className="text-muted-foreground">
                {language === "en" ? "Terms" : "الشروط"}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LovableLayout;
