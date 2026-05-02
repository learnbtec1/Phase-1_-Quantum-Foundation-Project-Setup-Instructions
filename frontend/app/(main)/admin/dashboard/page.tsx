"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { AdminGuard } from "@/components/admin-guard";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/lovable-ui/ui/table";
import {
  Users,
  DollarSign,
  GraduationCap,
  Search,
  TrendingUp,
  BarChart3,
  Activity,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type AdminStats = {
  total_users: number;
  active_users: number;
  active_users_window_days: number;
  active_users_definition: string;
  total_assessments: number;
  total_plagiarism_checks: number;
  total_revenue_cents: number;
  total_revenue: number;
  pro_users: number;
  unlimited_users: number;
};

type AdminAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  message_ar: string;
};

type AdminInsights = {
  platform_status: "healthy" | "attention";
  alerts: AdminAlert[];
};

type UsageResponse = {
  daily: { date: string; assessments: number; plagiarism: number; total_requests: number }[];
  monthly: { month: string; assessments: number; plagiarism: number; total_requests: number }[];
  top_users: { email: string; total_usage: number; plan: string; last_active_utc: string | null }[];
  method_note?: string;
};

type RevenueResponse = {
  revenue_by_month: { month: string; revenue_cents: number }[];
  total_invoices: number;
  failed_payments: number;
};

function formatUsd(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

const statTone: Record<"blue" | "emerald" | "violet" | "sky", { ring: string; iconBg: string; icon: string }> = {
  blue: {
    ring: "ring-1 ring-blue-500/15 dark:ring-blue-400/20",
    iconBg: "bg-blue-500/10 dark:bg-blue-500/20",
    icon: "text-blue-600 dark:text-blue-400",
  },
  emerald: {
    ring: "ring-1 ring-emerald-500/15",
    iconBg: "bg-emerald-500/10 dark:bg-emerald-500/20",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  violet: {
    ring: "ring-1 ring-violet-500/15",
    iconBg: "bg-violet-500/10 dark:bg-violet-500/20",
    icon: "text-violet-600 dark:text-violet-400",
  },
  sky: {
    ring: "ring-1 ring-cyan-500/15",
    iconBg: "bg-cyan-500/10 dark:bg-cyan-500/20",
    icon: "text-cyan-600 dark:text-cyan-400",
  },
};

function GlassStat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof statTone;
}) {
  const t = statTone[tone];
  return (
    <div
      className={cn(
        "group rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-lg backdrop-blur-xl transition-all duration-200",
        "hover:-translate-y-1 hover:scale-[1.01] hover:shadow-xl",
        t.ring,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.02]">
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
            t.iconBg,
          )}
        >
          <Icon className={cn("h-6 w-6", t.icon)} />
        </div>
      </div>
      <div className="mt-3 h-1 rounded-full bg-gradient-to-r from-primary/0 via-primary/40 to-sky-500/0 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function PageInner() {
  const { language } = useAppTheme();
  const ar = language === "ar";
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [insights, setInsights] = useState<AdminInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        fetchWithSession("/api/v1/admin/stats", { method: "GET" }),
        fetchWithSession("/api/v1/admin/usage", { method: "GET" }),
        fetchWithSession("/api/v1/admin/revenue", { method: "GET" }),
        fetchWithSession("/api/v1/admin/insights", { method: "GET" }),
      ]);
      if (r1.status === 401 || r2.status === 401 || r3.status === 401 || r4.status === 401) {
        for (const r of [r1, r2, r3, r4]) {
          if (r.status === 401) {
            const d = await readFastApiDetail(r);
            if (shouldSignOutOn401(d)) {
              toast.error("Session expired. Please sign in.");
              signOutOnUnauthorized();
            } else {
              toast.error(d || "Admin access required");
            }
            break;
          }
        }
        return;
      }
      if (r1.status === 403 || r2.status === 403 || r3.status === 403 || r4.status === 403) {
        toast.error("Admin access only");
        return;
      }
      if (!r1.ok || !r2.ok || !r3.ok || !r4.ok) {
        setErr("Failed to load admin data");
        return;
      }
      setStats((await r1.json()) as AdminStats);
      setUsage((await r2.json()) as UsageResponse);
      setRevenue((await r3.json()) as RevenueResponse);
      setInsights((await r4.json()) as AdminInsights);
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void load();
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const lineData = useMemo(() => {
    if (!revenue) return [];
    return revenue.revenue_by_month.map((r) => ({
      month: r.month.slice(0, 7),
      usd: r.revenue_cents / 100,
    }));
  }, [revenue]);

  const barData = useMemo(() => {
    if (!usage) return [];
    return usage.monthly.map((m) => ({
      month: m.month.slice(0, 7),
      assessments: m.assessments,
      plagiarism: m.plagiarism,
    }));
  }, [usage]);

  const dailyActivityData = useMemo(() => {
    if (!usage) return [];
    return usage.daily.map((d) => ({
      day: d.date.slice(5, 10),
      total: d.total_requests,
      assessments: d.assessments,
      plagiarism: d.plagiarism,
    }));
  }, [usage]);

  const tickDim = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

  if (loading && !stats) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 max-w-full rounded-lg bg-white/10" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-white/10" />
          ))}
        </div>
        <div className="h-80 rounded-2xl bg-white/10" />
      </div>
    );
  }

  if (err) {
    return <p className="text-destructive">{err}</p>;
  }

  if (!stats || !usage || !revenue || !insights) {
    return <p className="text-muted-foreground">No data</p>;
  }

  return (
    <div className="space-y-8">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          insights.platform_status === "healthy"
            ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-transparent"
            : "border-amber-500/40 bg-gradient-to-r from-amber-500/15 to-orange-500/5",
        )}
      >
        <div className="flex items-center gap-3">
          {insights.platform_status === "healthy" ? (
            <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-8 w-8 shrink-0 text-amber-500" />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {ar
                ? insights.platform_status === "healthy"
                  ? "🚀 حالة المنصة: جيدة"
                  : "⚠️ حالة المنصة: تتطلب انتباهاً"
                : insights.platform_status === "healthy"
                  ? "🚀 Platform status: Healthy"
                  : "⚠️ Platform status: Attention required"}
            </p>
            <p className="text-xs text-muted-foreground">
              {ar
                ? "مؤشرات تلقائية (مقارنات 7 أيام + فواتير + تسجيلات)"
                : "Automated checks (7d windows, billing, sign-ups)"}
            </p>
          </div>
        </div>
        {insights.alerts.length > 0 && (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {insights.alerts.length} {ar ? "تنبيه" : "alert(s)"}
          </span>
        )}
      </div>

      {insights.alerts.length > 0 && (
        <div className="space-y-2" role="region" aria-label="Admin alerts">
          {insights.alerts.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex gap-3 rounded-xl border px-3 py-2.5 text-sm",
                a.severity === "critical" && "border-rose-500/40 bg-rose-500/10",
                a.severity === "warning" && "border-amber-500/40 bg-amber-500/10",
                a.severity === "info" && "border-sky-500/30 bg-sky-500/5",
              )}
            >
              <AlertTriangle
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  a.severity === "critical" && "text-rose-500",
                  a.severity === "warning" && "text-amber-500",
                  a.severity === "info" && "text-sky-500",
                )}
              />
              <p className="text-foreground/90" dir={ar ? "rtl" : "ltr"}>
                {ar ? a.message_ar : a.message}
              </p>
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-transparent">
          {ar ? "لوحة التحكم" : "Admin dashboard"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "مقاييس مجمّعة · تحديث تلقائي كل 30ث"
            : "Aggregated metrics · auto-refresh 30s"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlassStat
          icon={Users}
          tone="blue"
          label={ar ? "المستخدمون" : "Total users"}
          value={String(stats.total_users.toLocaleString())}
          sub={
            ar
              ? `${stats.active_users} نشط آخر ${stats.active_users_window_days} أيام · pro ${stats.pro_users} · ∞ ${stats.unlimited_users}`
              : `${stats.active_users} active (last ${stats.active_users_window_days}d) · ${stats.pro_users} pro · ${stats.unlimited_users} unlimited`
          }
        />
        <GlassStat
          icon={DollarSign}
          tone="emerald"
          label={ar ? "الإيرادات (فواتير مدفوعة)" : "Revenue (paid invoices)"}
          value={formatUsd(stats.total_revenue)}
        />
        <GlassStat
          icon={GraduationCap}
          tone="violet"
          label={ar ? "التقييمات (الإجمالي)" : "Assessments (all time)"}
          value={stats.total_assessments.toLocaleString()}
        />
        <GlassStat
          icon={Search}
          tone="sky"
          label={ar ? "فحوصات الانتحال" : "Plagiarism checks"}
          value={stats.total_plagiarism_checks.toLocaleString()}
        />
      </div>

      {stats.active_users_definition ? (
        <p className="text-xs text-muted-foreground" title={stats.active_users_definition}>
          {ar ? "المستخدمون النشطون: " : "Active users: "}
          {stats.active_users_definition}
        </p>
      ) : null}

      <div className="glass max-w-xl rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
        Invoices recorded: {revenue.total_invoices} · Failed / void (in DB): {revenue.failed_payments}
      </div>

      <div className="glass rounded-2xl border border-white/10 p-4 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-violet-500" />
          {ar ? "النشاط اليومي (30 يوم) — بيانات فعلية" : "Daily activity (30d) — usage_events"}
        </h3>
        <div className="h-64 w-full min-w-0" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyActivityData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="day" tick={tickDim} />
              <YAxis tick={tickDim} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
              />
              <Bar dataKey="assessments" stackId="a" fill="hsl(262 83% 58%)" name="Assessments" />
              <Bar dataKey="plagiarism" stackId="a" fill="hsl(199 89% 48%)" name="Plagiarism" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl border border-white/10 p-4 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            {ar ? "الإيرادات (دولار / شهر)" : "Revenue (USD / month)"}
          </h3>
          <div className="h-72 w-full min-w-0" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="month" tick={tickDim} />
                <YAxis
                  tick={tickDim}
                  tickFormatter={(v) => formatUsd(typeof v === "number" ? v : Number(v))}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(value) => {
                    const v = typeof value === "number" ? value : Number(value ?? 0);
                    return [formatUsd(Number.isFinite(v) ? v : 0), "Revenue"];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="usd"
                  stroke="hsl(160 84% 40%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass rounded-2xl border border-white/10 p-4 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-sky-500" />
            {ar ? "الاستخدام الشهري (usage_stats)" : "Usage — monthly (usage_stats)"}
          </h3>
          <div className="h-72 w-full min-w-0" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="month" tick={tickDim} />
                <YAxis tick={tickDim} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                />
                <Bar dataKey="assessments" fill="hsl(262 83% 58%)" name="Assessments" radius={[4, 4, 0, 0]} />
                <Bar dataKey="plagiarism" fill="hsl(199 89% 48%)" name="Plagiarism" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {usage.method_note && (
        <p className="text-xs text-muted-foreground" title={usage.method_note}>
          {usage.method_note}
        </p>
      )}

      <div className="glass overflow-hidden rounded-2xl border border-white/10">
        <h3 className="border-b border-white/10 px-4 py-3 text-sm font-semibold">
          {ar ? "أعلى المستخدمين (الإجمالي)" : "Top users by usage (total)"}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Usage (requests)</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Last active (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.top_users.map((u) => (
              <TableRow key={u.email}>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell>{u.total_usage}</TableCell>
                <TableCell className="capitalize">{u.plan}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.last_active_utc
                    ? new Date(u.last_active_utc).toISOString().slice(0, 19).replace("T", " ")
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {loading && (
        <p className="text-center text-xs text-muted-foreground motion-reduce:opacity-0">Refreshing…</p>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <AdminGuard>
      <PageInner />
    </AdminGuard>
  );
}
