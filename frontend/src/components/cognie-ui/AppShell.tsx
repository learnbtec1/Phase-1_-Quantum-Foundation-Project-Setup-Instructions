'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  Sparkles,
  ClipboardCheck,
  Home,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HoloAvatar } from './HoloAvatar';

const nav: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/', label: 'الرئيسية', icon: Home },
  { href: '/dashboard', label: 'اللوحة', icon: LayoutDashboard },
  { href: '/avatar-agent', label: 'غرفة Cognie', icon: Sparkles },
  { href: '/assessment', label: 'التقييم التكيّفي', icon: ClipboardCheck },
  { href: '/settings/privacy', label: 'الخصوصية', icon: Settings },
];

/** Cognie Vision — غلاف UI فقط؛ روابط Next.js؛ بدون تأثير على WebSocket / VAD / TTS. */
export function CognieAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';

  return (
    <div className="cognie relative flex min-h-screen w-full bg-transparent text-foreground">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.14]"
        style={{ background: 'var(--gradient-aurora)' }}
      />

      <aside
        className="relative z-10 flex w-64 shrink-0 flex-col border-l p-4 backdrop-blur-md"
        style={{
          borderColor: 'var(--glass-border)',
          background: 'oklch(0.16 0.03 250 / 0.7)',
        }}
      >
        <Link href="/" className="mb-6 flex flex-col items-center gap-3 px-2">
          <HoloAvatar size={120} caption="آريا" />
          <div className="mt-6 text-center">
            <span
              className="text-2xl font-bold tracking-tight"
              style={{
                background:
                  'linear-gradient(135deg, var(--neon-cyan), var(--neon-emerald), var(--neon-amber))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Cognie
            </span>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              عمّان · 2035
            </p>
          </div>
        </Link>

        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/' || pathname === ''
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                style={
                  active
                    ? {
                        background:
                          'color-mix(in oklab, var(--neon-cyan) 12%, transparent)',
                        boxShadow:
                          'inset 0 0 0 1px color-mix(in oklab, var(--neon-cyan) 35%, transparent)',
                      }
                    : undefined
                }
              >
                <Icon
                  className="h-4 w-4"
                  style={active ? { color: 'var(--neon-cyan)' } : undefined}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6">
          <div
            className="rounded-xl border p-3 text-xs"
            style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}
          >
            <p
              className="flex items-center gap-2 font-medium"
              style={{ color: 'var(--neon-emerald)' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-neon-pulse rounded-full"
                style={{ background: 'var(--neon-emerald)' }}
              />
              آريا · متصلة
            </p>
            <p className="mt-1 text-muted-foreground">
              الواجهة Cognie Vision — طبقة عرض؛ المنطق في الوكيل منفصل
            </p>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto bg-[oklch(0.12_0.03_250_/0.35)] p-8 backdrop-blur-[2px]">
        {children}
      </main>
    </div>
  );
}
