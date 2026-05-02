"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, LayoutDashboard, FileSearch, GraduationCap, CreditCard,
  ClipboardList, LogOut, User, Settings, Menu, X, PanelLeftClose,
  PanelLeft, Shield, HelpCircle, Edit3, Sparkles, Crown, Bot,
} from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { Separator } from "@/components/lovable-ui/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/lovable-ui/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/lovable-ui/ui/tooltip";
import { cn } from "@/lib/utils";
import { clearStoredToken } from "@/lib/api";
import { ThemeControls } from "@/components/theme-controls";
import { useAppTheme } from "@/contexts/ThemeContext";
import { OnboardingSystem } from "@/components/lovable-ui/OnboardingSystem";

const SIDEBAR_KEY = "eduverse-sidebar-collapsed";

type NavItemConfig = {
  href: string; labelEn: string; labelAr: string; icon: ComponentType<{ className?: string }>; proBadge?: boolean; onboardingId?: string;
};

const nav: NavItemConfig[] =[
  { href: "/", labelEn: "Home", labelAr: "الرئيسية", icon: Home },
  { href: "/dashboard", labelEn: "Dashboard", labelAr: "لوحة التحكم", icon: LayoutDashboard, onboardingId: "nav-dashboard" },
  { href: "/plagiarism", labelEn: "Plagiarism", labelAr: "فحص الانتحال", icon: FileSearch, onboardingId: "nav-plagiarism" },
  { href: "/cognie", labelEn: "Cognie", labelAr: "كوجني", icon: Bot, onboardingId: "nav-cognie" },
  { href: "/assessment", labelEn: "BTEC", labelAr: "تقييم BTEC", icon: GraduationCap, onboardingId: "nav-assessment" },
  { href: "/workspace", labelEn: "Workspace", labelAr: "مساحة العمل", icon: Edit3 },
  { href: "/pro-writer", labelEn: "AI Architect", labelAr: "مساعد البناء", icon: Sparkles, proBadge: true },
  { href: "/decoder", labelEn: "Decoder", labelAr: "المفكك", icon: ClipboardList },
  { href: "/faq", labelEn: "FAQ", labelAr: "الشائعة", icon: HelpCircle },
  { href: "/pricing", labelEn: "Pricing", labelAr: "الأسعار", icon: CreditCard },
  { href: "/settings", labelEn: "Settings", labelAr: "الإعدادات", icon: Settings },
];

export function AppShell({
  children,
  isAdmin = false,
}: {
  children: React.ReactNode;
  /** From middleware JWT → layout (edge); not from client /auth/me. */
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { language } = useAppTheme();
  const ar = language === "ar";

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = useMemo(
    () =>
      isAdmin ? [...nav, { href: "/admin/dashboard", labelEn: "Admin", labelAr: "الإدارة", icon: Shield }] : nav,
    [isAdmin],
  );

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function logout() {
    clearStoredToken();
    router.replace("/");
  }

  const pageTitle = navItems.find((n) => n.href === pathname)?.labelAr || "EDUVERSE";

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header - 16px Padding / 8px Gap System */}
      <header className="glass-nav sticky top-0 z-40 w-full h-16">
        <div className="mx-auto flex h-full max-w-[1920px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <Link href="/" className="flex flex-col">
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-xl font-extrabold text-transparent">EDUVERSE</span>
            </Link>
          </div>
          
          <div className="flex items-center gap-4">
            <ThemeControls compact />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="glass h-10 gap-2 rounded-full px-4">
                  <User className="h-4 w-4" />
                  <span className="hidden text-sm font-medium sm:inline">{ar ? "الحساب" : "Account"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 mt-2">
                <DropdownMenuLabel>{ar ? "إدارة الحساب" : "Account Management"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/settings')}><Settings className="h-4 w-4 me-2" />{ar ? "الإعدادات" : "Settings"}</DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className="text-destructive"><LogOut className="h-4 w-4 me-2" />{ar ? "تسجيل الخروج" : "Log out"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={cn("glass hidden flex-col border-e transition-all duration-300 md:flex", collapsed ? "w-20" : "w-64")}>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const content = (
                <Link key={item.href} href={item.href} className={cn("group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all", isActive ? "bg-primary text-primary-foreground shadow-md" : "hover:bg-muted text-foreground/80 hover:text-foreground", collapsed && "justify-center px-0")}>
                  <item.icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive && "text-primary-foreground")} />
                  {!collapsed && <span className="flex-1 truncate">{ar ? item.labelAr : item.labelEn}</span>}
                </Link>
              );
              return collapsed ? <Tooltip key={item.href}><TooltipTrigger asChild>{content}</TooltipTrigger><TooltipContent side={ar ? "left" : "right"}>{ar ? item.labelAr : item.labelEn}</TooltipContent></Tooltip> : content;
            })}
          </div>
          <div className="p-4 border-t border-border/40">
            <Button variant="ghost" className="w-full" onClick={() => { setCollapsed(!collapsed); localStorage.setItem(SIDEBAR_KEY, !collapsed ? "1" : "0"); }}>
              {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </Button>
          </div>
        </aside>

        {/* Main Content Area - 24px Padding (8px Grid) */}
        <main className="flex-1 overflow-auto bg-background/50 p-4 sm:p-6 md:p-8">
          <div className="glass-card min-h-full p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {children}
          </div>
        </main>
      </div>
      <OnboardingSystem />
    </div>
    </TooltipProvider>
  );
}