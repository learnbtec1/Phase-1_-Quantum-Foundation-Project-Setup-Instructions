"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, FileSearch, GraduationCap, Bot, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { ThemeControls } from "@/components/theme-controls";
import { useAppTheme } from "@/contexts/ThemeContext";
import { authHeaders, getApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

/** كل بطاقة لمسارها الفعلي — التقييم الأكاديمي منفصل عن مسكن كوجني */
const features = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    titleAr: "لوحة التحكم",
    titleEn: "Dashboard",
    descAr: "نظرة عامة على النشاط والاشتراك.",
    descEn: "Workspace overview and subscription.",
  },
  {
    href: "/plagiarism",
    icon: FileSearch,
    titleAr: "فحص الانتحال",
    titleEn: "Plagiarism check",
    descAr: "تحليل التشابه بين الوثائق.",
    descEn: "Document similarity analysis.",
  },
  {
    href: "/assessment",
    icon: GraduationCap,
    titleAr: "تقييم BTEC",
    titleEn: "BTEC assessment",
    descAr: "رفع الملفات والمعايير والنتائج الأكاديمية.",
    descEn: "Uploads, criteria analysis, and grading results.",
  },
  {
    href: "/cognie",
    icon: Bot,
    titleAr: "المساعد كوجني",
    titleEn: "Cognie assistant",
    descAr: "الأفاتار ثلاثي الأبعاد والمحادثة السقراطية.",
    descEn: "3D avatar home — Socratic chat and realtime session.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [hasSession, setHasSession] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    (async () => {
      try {
        const r = await fetch(`${getApiBase()}/api/v1/auth/me`, { headers: authHeaders(null) as Record<string, string> });
        setHasSession(r.ok);
      } catch {
        setHasSession(false);
      }
    })();
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen w-full overflow-hidden font-sans bg-background text-foreground transition-colors duration-500">
      {/* Soft Glow Ambient Lights - Works perfectly in both Dark & Light modes */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/10 blur-[120px] animate-pulse" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-accent/10 blur-[100px] animate-pulse" style={{ animationDuration: '8s' }} />

      <header className="glass-nav sticky top-0 z-50 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="bg-gradient-to-r from-primary to-accent bg-clip-text text-2xl font-extrabold text-transparent">EDUVERSE</p>
          </div>
          <div className="flex items-center gap-4">
            <ThemeControls />
            {hasSession ? (
              <Button className="rounded-full px-6 font-bold" asChild><Link href="/dashboard">{ar ? "دخول لمنصة العمل" : "Go to Dashboard"}</Link></Button>
            ) : (
              <>
                <Button variant="ghost" asChild><Link href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link></Button>
                <Button className="rounded-full shadow-lg hover:shadow-primary/25" asChild><Link href="/register">{ar ? "حساب جديد" : "Register"}</Link></Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-16 px-6 py-20">
        <section className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-8 duration-700">
          <h1 className="mb-6 max-w-4xl text-5xl font-extrabold leading-tight tracking-tight md:text-7xl">
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent drop-shadow-sm">
              {ar ? "ثورة التقييم الأكاديمي بالذكاء الاصطناعي" : "The Future of AI Academic Assessment"}
            </span>
          </h1>
          <p className="mb-10 max-w-2xl text-lg text-muted-foreground">
            {ar ? "منصة احترافية بمعايير عالمية توفر لك بيئة متكاملة." : "An enterprise-grade platform offering you a complete ecosystem."}
          </p>

          <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="h-14 rounded-2xl px-8 text-lg shadow-xl shadow-primary/20 transition-all hover:-translate-y-1"
              onClick={() => router.push("/assessment")}
            >
              {ar ? "مساحة تقييم BTEC" : "BTEC grading workspace"}
              <ArrowRight className={cn("ms-2 h-5 w-5", ar && "rotate-180")} />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 rounded-2xl px-8 text-lg border-primary/30"
              asChild
            >
              <Link href="/cognie?context=btec_evaluator">
                {ar ? "المساعد كوجني (أفاتار)" : "Cognie avatar mentor"}
              </Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ href, icon: Icon, titleAr, titleEn, descAr, descEn }) => (
            <Card key={href} className="glass-card border-none bg-card/50">
              <CardHeader>
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl">{ar ? titleAr : titleEn}</CardTitle>
                <CardDescription className="text-base">{ar ? descAr : descEn}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full rounded-xl border-border/50 hover:bg-primary hover:text-primary-foreground" asChild>
                  <Link href={href}>{ar ? "استكشف" : "Explore"} <ChevronRight className="ms-2 h-4 w-4 shrink-0 rtl:rotate-180" /></Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}